import crypto from 'node:crypto';
import {
  AuditEventWriter,
  DatabaseTransactionManager,
  evaluateMinedecPerfilMatrix,
  MinedecPerfilInput,
  SqlQueryExecutor,
} from '@minedec/shared';
import {
  DeactivatePersonCascadeParams,
  DeactivatePersonCascadeResult,
  ISyncIdentityRepositoryPort,
  IUpsertDirectoryIdentityDelegate,
  ReconcileHotIdentityParams,
  ReconcileHotIdentityResult,
  UpsertSyncedIdentityParams,
  UpsertSyncedIdentityResult,
} from '../../domain/ports/sync-ports';

/**
 * Repositorio de escritura transaccional de sincronización sobre `persona_identidad`,
 * `cuenta_institucional` (con `hash_payload_gws`), `anomalia_identidad` y `auditoria_evento`,
 * incluyendo la operación transaccional `reconcileOrMergeHotIdentity` (`T027` y `T041`).
 * 100% SQL parametrizado (`$1, $2`) conforme al Principio IX de la Constitución v2.8.0.
 */
export class AlloyDbSyncIdentityRepository implements ISyncIdentityRepositoryPort {
  constructor(
    private readonly txManager: DatabaseTransactionManager,
    private readonly auditWriter: AuditEventWriter = new AuditEventWriter(),
    private readonly upsertDirectoryIdentityUseCase?: IUpsertDirectoryIdentityDelegate,
  ) {}

  public async isDomainActive(
    dominio: string,
    tx: SqlQueryExecutor = this.txManager,
  ): Promise<boolean> {
    const res = await tx.query<{ activo: boolean }>(
      `SELECT activo
       FROM dominio_institucional
       WHERE dominio = $1`,
      [dominio.trim().toLowerCase()],
    );
    return Boolean(res.rows[0]?.activo);
  }

  public async listActiveDomains(
    tx: SqlQueryExecutor = this.txManager,
  ): Promise<string[]> {
    const res = await tx.query<{ dominio: string }>(
      `SELECT dominio
       FROM dominio_institucional
       WHERE activo = true
       ORDER BY dominio ASC`,
      [],
    );
    return res.rows.map((r) => String(r.dominio).toLowerCase());
  }

  public async findAccountSyncMetadata(
    googleSubId: string,
    emailPrincipal?: string | null,
    tx: SqlQueryExecutor = this.txManager,
  ): Promise<{
    cuentaId: string;
    idInterno: string;
    googleSubId: string;
    emailPrincipal: string;
    dominio: string;
    estadoSincronizacion: string;
    hashPayloadGws: string | null;
    ultimaSincronizacionEn: string;
  } | null> {
    let res = await tx.query<Record<string, unknown>>(
      `SELECT cuenta_id, id_interno, google_sub_id, email_principal, dominio,
              estado_sincronizacion, hash_payload_gws, ultima_sincronizacion_en
       FROM cuenta_institucional
       WHERE google_sub_id = $1`,
      [googleSubId],
    );
    if (!res.rows[0] && emailPrincipal) {
      res = await tx.query<Record<string, unknown>>(
        `SELECT cuenta_id, id_interno, google_sub_id, email_principal, dominio,
                estado_sincronizacion, hash_payload_gws, ultima_sincronizacion_en
         FROM cuenta_institucional
         WHERE email_principal = $1`,
        [emailPrincipal.trim().toLowerCase()],
      );
    }
    if (!res.rows[0]) {
      return null;
    }
    const row = res.rows[0];
    return {
      cuentaId: String(row.cuenta_id),
      idInterno: String(row.id_interno),
      googleSubId: String(row.google_sub_id),
      emailPrincipal: String(row.email_principal),
      dominio: String(row.dominio),
      estadoSincronizacion: String(row.estado_sincronizacion),
      hashPayloadGws: row.hash_payload_gws ? String(row.hash_payload_gws) : null,
      ultimaSincronizacionEn:
        row.ultima_sincronizacion_en instanceof Date
          ? row.ultima_sincronizacion_en.toISOString()
          : String(row.ultima_sincronizacion_en ?? new Date(0).toISOString()),
    };
  }

  public async countActiveAccountsForPerson(
    idInterno: string,
    excludeCuentaId?: string,
    tx: SqlQueryExecutor = this.txManager,
  ): Promise<number> {
    const res = await tx.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM cuenta_institucional
       WHERE id_interno = $1
         AND ($2::uuid IS NULL OR cuenta_id <> $2::uuid)
         AND suspended_en_gws = false
         AND estado_sincronizacion NOT IN ('SUSPENDIDA_GWS', 'ELIMINADA_GWS', 'VIGENCIA_VENCIDA', 'BLOQUEADA_ANOMALIA')`,
      [idInterno, excludeCuentaId ?? null],
    );
    return Number(res.rows[0]?.count ?? 0);
  }

  public async upsertSyncedIdentity(
    params: UpsertSyncedIdentityParams,
  ): Promise<UpsertSyncedIdentityResult> {
    const { gwsUser } = params;
    const googleSubId = (gwsUser.googleSubId || gwsUser.id).trim();
    const emailPrincipal = (gwsUser.emailPrincipal || gwsUser.primaryEmail)
      .trim()
      .toLowerCase();
    const dominio = emailPrincipal.split('@')[1] ?? '';

    const existingMeta = await this.findAccountSyncMetadata(googleSubId, emailPrincipal);
    if (
      existingMeta &&
      !params.forceUpsert &&
      existingMeta.hashPayloadGws &&
      existingMeta.hashPayloadGws === params.hashPayloadGws
    ) {
      const otherActiveAccountsCount = await this.countActiveAccountsForPerson(
        existingMeta.idInterno,
        existingMeta.cuentaId,
      );
      return {
        outcome: 'SIN_CAMBIOS_HASH',
        idInternoPersona: existingMeta.idInterno,
        cuentaId: existingMeta.cuentaId,
        googleSubId: existingMeta.googleSubId,
        emailPrincipal: existingMeta.emailPrincipal,
        dominio: existingMeta.dominio,
        estadoPersona: 'ACTIVA',
        estadoCuenta: existingMeta.estadoSincronizacion,
        otherActiveAccountsCount,
        requiresCacheInvalidation: false,
        anomaliasGeneradasIds: [],
      };
    }

    const rawProfile = (gwsUser.customSchemas?.MINEDEC_Perfil ??
      gwsUser.minedecPerfil ??
      {}) as MinedecPerfilInput & { idInterno?: string };

    const rawTipoUsuarioStr = String(rawProfile.tipoUsuario ?? 'DOCENTE').trim().toUpperCase();
    const normalizedTipoUsuario = (
      ['ESTUDIANTE', 'DOCENTE', 'ADMINISTRATIVO', 'EXTERNO'].includes(rawTipoUsuarioStr)
        ? rawTipoUsuarioStr
        : rawTipoUsuarioStr.includes('ESTUDIANTE')
          ? 'ESTUDIANTE'
          : rawTipoUsuarioStr.includes('ADMIN') && !rawTipoUsuarioStr.includes('DOCENTE')
            ? 'ADMINISTRATIVO'
            : 'DOCENTE'
    ) as MinedecPerfilInput['tipoUsuario'];

    if (this.upsertDirectoryIdentityUseCase) {
      try {
        const pipResult = await this.upsertDirectoryIdentityUseCase.execute({
          googleSubId,
          emailPrincipal,
          nombreCompleto:
            gwsUser.nombreCompleto || gwsUser.name?.fullName || emailPrincipal,
          orgUnitPath: gwsUser.orgUnitPath || '/',
          suspendedEnGws: Boolean(gwsUser.suspendedEnGws ?? gwsUser.suspended),
          origenSincronizacion:
            params.origenCanal === 'SYNC_BATCH_JOB'
              ? 'CONCILIACION_DIARIA'
              : 'EVENTO_AUDIT_LOG',
          minedecPerfil: {
            ...rawProfile,
            tipoUsuario: rawProfile.tipoUsuario ? normalizedTipoUsuario : undefined,
          },
        });

        await this.txManager.query(
          `UPDATE cuenta_institucional
           SET hash_payload_gws = $2, actualizado_en = NOW()
           WHERE cuenta_id = $1`,
          [pipResult.cuentaId, params.hashPayloadGws],
        );

        const otherActiveAccountsCount = await this.countActiveAccountsForPerson(
          pipResult.idInterno,
          pipResult.cuentaId,
        );

        let effectiveEstadoPersona = pipResult.estadoPersona;
        const isSuspendedOrDeleted =
          Boolean(gwsUser.suspendedEnGws ?? gwsUser.suspended) || Boolean(params.deletedEnGws);
        if (isSuspendedOrDeleted && pipResult.anomaliasAbiertas.length === 0) {
          effectiveEstadoPersona = otherActiveAccountsCount > 0 ? 'ACTIVA' : 'INACTIVA';
          if (effectiveEstadoPersona !== pipResult.estadoPersona) {
            await this.txManager.query(
              `UPDATE persona_identidad
               SET estado_persona = $2, actualizado_en = NOW()
               WHERE id_interno = $1`,
              [pipResult.idInterno, effectiveEstadoPersona],
            );
          }
        }

        const hasAnomaly = pipResult.anomaliasAbiertas.length > 0;
        return {
          outcome: hasAnomaly ? 'ANOMALIA_REGISTRADA' : 'APLICADO',
          idInternoPersona: pipResult.idInterno,
          cuentaId: pipResult.cuentaId,
          googleSubId,
          emailPrincipal,
          dominio,
          estadoPersona: effectiveEstadoPersona,
          estadoCuenta: pipResult.estadoSincronizacion,
          otherActiveAccountsCount,
          requiresCacheInvalidation: pipResult.cacheInvalidated,
          anomaliasGeneradasIds: pipResult.anomaliasAbiertas.map((a) => a.anomaliaId),
        };
      } catch (err) {
        const errName = err instanceof Error ? err.name : '';
        if (
          errName !== 'CedulaImmutabilityConflictError' &&
          errName !== 'IdentifierCollisionConflictError'
        ) {
          throw err;
        }
        // Caer al bloque transaccional directo para registrar la anomalía BLOQUEANTE
        // preservando intacta la CEDULA original en persona_identidad.
      }
    }

    // Ejecución transaccional directa sobre AlloyDB
    return this.txManager.withTransaction(async (tx) => {
      const nowIso = new Date().toISOString();
      const matrixEval = evaluateMinedecPerfilMatrix(rawProfile);

      const existingAccRes = await tx.query<Record<string, unknown>>(
        `SELECT cuenta_id, id_interno, google_sub_id, email_principal, dominio, estado_sincronizacion
         FROM cuenta_institucional
         WHERE google_sub_id = $1 OR email_principal = $2
         LIMIT 1`,
        [googleSubId, emailPrincipal],
      );
      const existingAcc = existingAccRes.rows[0];

      let existingPersonByDocId: string | null = null;
      if (!existingAcc && matrixEval.validDocument && matrixEval.numeroIdentificacionNormalizado) {
        const personByDocRes = await tx.query<{ id_interno: string }>(
          `SELECT id_interno
           FROM persona_identidad
           WHERE numero_identificacion = $1
           LIMIT 1`,
          [matrixEval.numeroIdentificacionNormalizado],
        );
        if (personByDocRes.rows[0]) {
          existingPersonByDocId = String(personByDocRes.rows[0].id_interno);
        }
      }

      const idInterno = existingAcc
        ? String(existingAcc.id_interno)
        : (existingPersonByDocId ?? rawProfile.idInterno ?? crypto.randomUUID());
      const cuentaId = existingAcc ? String(existingAcc.cuenta_id) : crypto.randomUUID();

      let estadoPersona = 'ACTIVA';
      let estadoCuenta = params.deletedEnGws
        ? 'ELIMINADA_GWS'
        : gwsUser.suspended || gwsUser.suspendedEnGws
          ? 'SUSPENDIDA_GWS'
          : 'SINCRONIZADA';

      const anomaliasGeneradasIds: string[] = [];
      const pendingAnomalies: Array<{
        anomaliaId: string;
        codigoCausal: string;
        efectoAcceso: string;
        detalleTecnico: string;
      }> = [];

      // Verificar inmutabilidad de CEDULA consolidada
      if (existingAcc && matrixEval.validDocument && matrixEval.numeroIdentificacionNormalizado) {
        const personRes = await tx.query<{
          tipo_identificacion: string;
          numero_identificacion: string;
        }>(
          `SELECT tipo_identificacion, numero_identificacion
           FROM persona_identidad
           WHERE id_interno = $1`,
          [idInterno],
        );
        const currentPerson = personRes.rows[0];
        if (
          currentPerson &&
          currentPerson.tipo_identificacion === 'CEDULA' &&
          currentPerson.numero_identificacion !== matrixEval.numeroIdentificacionNormalizado
        ) {
          estadoPersona = 'BLOQUEADA_ANOMALIA';
          estadoCuenta = 'BLOQUEADA_ANOMALIA';
          const anomaliaId = crypto.randomUUID();
          anomaliasGeneradasIds.push(anomaliaId);
          pendingAnomalies.push({
            anomaliaId,
            codigoCausal: 'COLISION_IDENTIFICADOR',
            efectoAcceso: 'BLOQUEANTE',
            detalleTecnico: `Intento bloqueado de mutar CEDULA consolidada (${currentPerson.numero_identificacion} -> ${matrixEval.numeroIdentificacionNormalizado}).`,
          });
        }
      }

      if (!matrixEval.validDocument || matrixEval.anomaliasDetectadas.length > 0) {
        for (const anom of matrixEval.anomaliasDetectadas) {
          const anomaliaId = crypto.randomUUID();
          anomaliasGeneradasIds.push(anomaliaId);
          if (anom.efectoAcceso === 'BLOQUEANTE') {
            estadoPersona = 'BLOQUEADA_ANOMALIA';
            estadoCuenta = 'BLOQUEADA_ANOMALIA';
          } else if (estadoPersona === 'ACTIVA') {
            estadoPersona = 'RESTRINGIDA_ANOMALIA';
          }
          pendingAnomalies.push({
            anomaliaId,
            codigoCausal: anom.codigoCausal,
            efectoAcceso: anom.efectoAcceso,
            detalleTecnico: anom.detalleTecnico,
          });
        }
      }

      const tipoId = matrixEval.tipoIdentificacionNormalizado ?? 'CODIGO_MINEDEC';
      const numId =
        matrixEval.numeroIdentificacionNormalizado ?? `TEMP-${googleSubId.slice(0, 16)}`;

      const rawTipoUsuario = String(rawProfile.tipoUsuario ?? 'DOCENTE').trim().toUpperCase();
      const normalizedTipoUsuario = ['ESTUDIANTE', 'DOCENTE', 'ADMINISTRATIVO', 'EXTERNO'].includes(
        rawTipoUsuario,
      )
        ? rawTipoUsuario
        : rawTipoUsuario.includes('ESTUDIANTE')
          ? 'ESTUDIANTE'
          : rawTipoUsuario.includes('ADMIN') && !rawTipoUsuario.includes('DOCENTE')
            ? 'ADMINISTRATIVO'
            : 'DOCENTE';

      await tx.query(
        `INSERT INTO persona_identidad (
           id_interno, tipo_identificacion, numero_identificacion, nombre_completo,
           estado_persona, creado_en, actualizado_en
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (id_interno) DO UPDATE SET
           nombre_completo = EXCLUDED.nombre_completo,
           estado_persona = EXCLUDED.estado_persona,
           actualizado_en = EXCLUDED.actualizado_en`,
        [
          idInterno,
          tipoId,
          numId,
          gwsUser.nombreCompleto || gwsUser.name?.fullName || emailPrincipal,
          estadoPersona,
          nowIso,
        ],
      );

      await tx.query(
        `INSERT INTO cuenta_institucional (
           cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
           tipo_usuario, suspended_en_gws, estado_sincronizacion, hash_payload_gws,
           origen_ultima_sincronizacion, ultima_sincronizacion_en, creado_en, actualizado_en
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $12)
         ON CONFLICT (google_sub_id) DO UPDATE SET
           id_interno = EXCLUDED.id_interno,
           email_principal = EXCLUDED.email_principal,
           dominio = EXCLUDED.dominio,
           org_unit_path = EXCLUDED.org_unit_path,
           suspended_en_gws = EXCLUDED.suspended_en_gws,
           estado_sincronizacion = EXCLUDED.estado_sincronizacion,
           hash_payload_gws = EXCLUDED.hash_payload_gws,
           ultima_sincronizacion_en = EXCLUDED.ultima_sincronizacion_en,
           actualizado_en = EXCLUDED.actualizado_en`,
        [
          cuentaId,
          idInterno,
          googleSubId,
          emailPrincipal,
          dominio,
          gwsUser.orgUnitPath || '/',
          normalizedTipoUsuario,
          Boolean(gwsUser.suspended ?? gwsUser.suspendedEnGws),
          estadoCuenta,
          params.hashPayloadGws,
          params.origenCanal === 'SYNC_BATCH_JOB'
            ? 'CONCILIACION_DIARIA'
            : 'ADMIN_SDK_PUSH',
          nowIso,
        ],
      );

      for (const anom of pendingAnomalies) {
        await tx.query(
          `INSERT INTO anomalia_identidad (
             anomalia_id, id_interno, cuenta_id, google_sub_id, email_principal, dominio,
             codigo_causal, efecto_acceso, estado_anomalia, detalle_tecnico, detectada_en
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ABIERTA', $9, $10)`,
          [
            anom.anomaliaId,
            idInterno,
            cuentaId,
            googleSubId,
            emailPrincipal,
            dominio,
            anom.codigoCausal,
            anom.efectoAcceso,
            anom.detalleTecnico,
            nowIso,
          ],
        );
      }

      const otherActiveAccountsCount = await this.countActiveAccountsForPerson(
        idInterno,
        cuentaId,
        tx,
      );

      if (
        (estadoCuenta === 'SUSPENDIDA_GWS' || estadoCuenta === 'ELIMINADA_GWS') &&
        estadoPersona !== 'BLOQUEADA_ANOMALIA'
      ) {
        estadoPersona = otherActiveAccountsCount > 0 ? 'ACTIVA' : 'INACTIVA';
        await tx.query(
          `UPDATE persona_identidad
           SET estado_persona = $2, actualizado_en = $3
           WHERE id_interno = $1`,
          [idInterno, estadoPersona, nowIso],
        );
      }

      await this.auditWriter.appendEvent(tx, {
        tipoEvento: existingAcc ? 'IDENTIDAD_ACTUALIZADA' : 'IDENTIDAD_CREADA',
        idInterno,
        cuentaId,
        actorSub: 'sa-sync',
        origenCanal: params.origenCanal,
        resumenCambio: `Sincronización GWS (${params.modoDespacho}) para ${emailPrincipal}`,
        datosPrevios: null,
        datosNuevos: {
          estadoPersona,
          estadoCuenta,
          hashPayloadGws: params.hashPayloadGws,
          anomaliasCount: anomaliasGeneradasIds.length,
        },
        traceId: params.traceId,
      });

      return {
        outcome: anomaliasGeneradasIds.length > 0 ? 'ANOMALIA_REGISTRADA' : 'APLICADO',
        idInternoPersona: idInterno,
        cuentaId,
        googleSubId,
        emailPrincipal,
        dominio,
        estadoPersona,
        estadoCuenta,
        otherActiveAccountsCount,
        requiresCacheInvalidation: true,
        anomaliasGeneradasIds,
      };
    });
  }

  public async applyAccountLifecycleChange(params: {
    googleSubId: string;
    emailPrincipal?: string | null;
    nuevoEstadoCuenta: 'SUSPENDIDA_GWS' | 'ELIMINADA_GWS' | 'SINCRONIZADA';
    motivo: string;
    origenCanal: 'SYNC_INCREMENTAL' | 'SYNC_BATCH_JOB';
    traceId: string;
  }): Promise<{
    found: boolean;
    idInternoPersona?: string;
    cuentaId?: string;
    googleSubId: string;
    emailPrincipal?: string;
    dominio?: string;
    estadoPersonaResultante?: string;
    estadoCuentaResultante?: string;
    remainingActiveAccountsCount: number;
  }> {
    return this.txManager.withTransaction(async (tx) => {
      const existingMeta = await this.findAccountSyncMetadata(
        params.googleSubId,
        params.emailPrincipal,
        tx,
      );
      if (!existingMeta) {
        return {
          found: false,
          googleSubId: params.googleSubId,
          remainingActiveAccountsCount: 0,
        };
      }

      const personRes = await tx.query<{ estado_persona: string }>(
        `SELECT estado_persona FROM persona_identidad WHERE id_interno = $1`,
        [existingMeta.idInterno],
      );
      const currentEstadoPersona = String(personRes.rows[0]?.estado_persona ?? 'ACTIVA');

      const nowIso = new Date().toISOString();
      const isDeactivating =
        params.nuevoEstadoCuenta === 'SUSPENDIDA_GWS' ||
        params.nuevoEstadoCuenta === 'ELIMINADA_GWS';

      await tx.query(
        `UPDATE cuenta_institucional
         SET suspended_en_gws = $2,
             estado_sincronizacion = $3,
             ultima_sincronizacion_en = $4,
             actualizado_en = $4
         WHERE cuenta_id = $1`,
        [existingMeta.cuentaId, isDeactivating, params.nuevoEstadoCuenta, nowIso],
      );

      const remainingActiveAccountsCount = await this.countActiveAccountsForPerson(
        existingMeta.idInterno,
        existingMeta.cuentaId,
        tx,
      );

      let nuevoEstadoPersona = currentEstadoPersona;
      if (isDeactivating) {
        // Regla de Baja Lógica Diferenciada en Dos Niveles (Nivel 1):
        // Si tiene otras cuentas institucionales activas, PersonaIdentidad permanece ACTIVA.
        // Solo si quedan 0 cuentas activas, PersonaIdentidad pasa a INACTIVA.
        nuevoEstadoPersona =
          remainingActiveAccountsCount > 0 ? 'ACTIVA' : 'INACTIVA';
      } else if (currentEstadoPersona === 'INACTIVA') {
        nuevoEstadoPersona = 'ACTIVA';
      }

      await tx.query(
        `UPDATE persona_identidad
         SET estado_persona = $2, actualizado_en = $3
         WHERE id_interno = $1`,
        [existingMeta.idInterno, nuevoEstadoPersona, nowIso],
      );

      await this.auditWriter.appendEvent(tx, {
        tipoEvento:
          params.nuevoEstadoCuenta === 'ELIMINADA_GWS'
            ? 'IDENTIDAD_ELIMINADA'
            : params.nuevoEstadoCuenta === 'SUSPENDIDA_GWS'
              ? 'IDENTIDAD_SUSPENDIDA'
              : 'IDENTIDAD_SINCRONIZADA',
        idInterno: existingMeta.idInterno,
        cuentaId: existingMeta.cuentaId,
        actorSub: 'sa-sync',
        origenCanal: params.origenCanal,
        resumenCambio: params.motivo,
        datosPrevios: {
          estadoPersona: currentEstadoPersona,
          estadoSincronizacion: existingMeta.estadoSincronizacion,
        },
        datosNuevos: {
          estadoPersona: nuevoEstadoPersona,
          estadoSincronizacion: params.nuevoEstadoCuenta,
          remainingActiveAccountsCount,
        },
        traceId: params.traceId,
      });

      return {
        found: true,
        idInternoPersona: existingMeta.idInterno,
        cuentaId: existingMeta.cuentaId,
        googleSubId: existingMeta.googleSubId,
        emailPrincipal: existingMeta.emailPrincipal,
        dominio: existingMeta.dominio,
        estadoPersonaResultante: nuevoEstadoPersona,
        estadoCuentaResultante: params.nuevoEstadoCuenta,
        remainingActiveAccountsCount,
      };
    });
  }

  public async deactivatePersonCascade(
    params: DeactivatePersonCascadeParams,
  ): Promise<DeactivatePersonCascadeResult | null> {
    return this.txManager.withTransaction(async (tx) => {
      const personRes = await tx.query<{
        id_interno: string;
        tipo_identificacion: string | null;
        numero_identificacion: string | null;
        estado_persona: string;
      }>(
        `SELECT id_interno, tipo_identificacion, numero_identificacion, estado_persona
         FROM persona_identidad
         WHERE id_interno = $1`,
        [params.idInterno],
      );
      const persona = personRes.rows[0];
      if (!persona) {
        return null;
      }

      const accountsRes = await tx.query<{
        cuenta_id: string;
        google_sub_id: string;
        email_principal: string;
        dominio: string;
      }>(
        `SELECT cuenta_id, google_sub_id, email_principal, dominio
         FROM cuenta_institucional
         WHERE id_interno = $1`,
        [params.idInterno],
      );

      const nowIso = new Date().toISOString();
      await tx.query(
        `UPDATE persona_identidad
         SET estado_persona = $2, actualizado_en = $3
         WHERE id_interno = $1`,
        [params.idInterno, params.nuevoEstadoPersona, nowIso],
      );

      const nuevoEstadoCuenta =
        params.nuevoEstadoPersona === 'BLOQUEADA_ANOMALIA'
          ? 'BLOQUEADA_ANOMALIA'
          : 'SUSPENDIDA_GWS';

      await tx.query(
        `UPDATE cuenta_institucional
         SET suspended_en_gws = true,
             estado_sincronizacion = $2,
             ultima_sincronizacion_en = $3,
             actualizado_en = $3
         WHERE id_interno = $1`,
        [params.idInterno, nuevoEstadoCuenta, nowIso],
      );

      const cuentasDesactivadas = accountsRes.rows.map((acc) => ({
        cuentaId: String(acc.cuenta_id),
        googleSubId: String(acc.google_sub_id),
        emailPrincipal: String(acc.email_principal),
        dominio: String(acc.dominio),
      }));
      const subdominiosAfectados = Array.from(
        new Set(cuentasDesactivadas.map((c) => c.dominio)),
      );

      await this.auditWriter.appendEvent(tx, {
        tipoEvento: 'PERSONA_DESACTIVADA',
        idInterno: params.idInterno,
        actorSub: params.adminIdentificacion,
        origenCanal: 'PAP_ADMIN',
        resumenCambio: `Desactivación en cascada de PersonaIdentidad (${params.nuevoEstadoPersona}): ${params.motivoDesactivacion}`,
        datosPrevios: {
          estadoPersona: persona.estado_persona,
          cuentasCount: cuentasDesactivadas.length,
        },
        datosNuevos: {
          estadoPersona: params.nuevoEstadoPersona,
          cuentasDesactivadasCount: cuentasDesactivadas.length,
          subdominiosAfectados,
        },
        traceId: params.traceId,
      });

      return {
        idInterno: params.idInterno,
        tipoIdentificacion: persona.tipo_identificacion,
        numeroIdentificacion: persona.numero_identificacion,
        estadoPersona: params.nuevoEstadoPersona,
        cuentasDesactivadas,
        subdominiosAfectados,
      };
    });
  }

  /**
   * Operación transaccional `reconcileOrMergeHotIdentity` (`T041`):
   * - Si la cuenta en GWS carece de identificación válida en `MINEDEC_Perfil`, mantiene
   *   `PENDIENTE_CONCILIACION` con anomalía `SIN_IDENTIFICACION_VALIDA`.
   * - Si el documento oficial no existe previamente, promueve in-place a `ACTIVA`.
   * - Si el documento oficial ya existe en otra `PersonaIdentidad`, fusiona/re-vincula
   *   atómicamente la `CuentaInstitucional` a la `PersonaIdentidad` existente y elimina
   *   el registro provisional huérfano dentro de la misma transacción.
   */
  public async reconcileOrMergeHotIdentity(
    params: ReconcileHotIdentityParams,
  ): Promise<ReconcileHotIdentityResult> {
    if (!params.gwsUser) {
      return this.keepPendingWithoutValidId(
        params,
        'Cuenta no encontrada o sin perfil en Google Workspace.',
      );
    }

    const rawProfile = (params.gwsUser.customSchemas?.MINEDEC_Perfil ??
      params.gwsUser.minedecPerfil ??
      {}) as MinedecPerfilInput;
    const matrixEval = evaluateMinedecPerfilMatrix(rawProfile);

    if (
      !matrixEval.validDocument ||
      !matrixEval.tipoIdentificacionNormalizado ||
      !matrixEval.numeroIdentificacionNormalizado
    ) {
      return this.keepPendingWithoutValidId(
        params,
        'La cuenta en Google Workspace carece de customSchemas.MINEDEC_Perfil.numeroIdentificacion válido (SIN_IDENTIFICACION_VALIDA).',
      );
    }

    const tipoDoc = matrixEval.tipoIdentificacionNormalizado;
    const numDoc = matrixEval.numeroIdentificacionNormalizado;

    return this.txManager.withTransaction(async (tx) => {
      const nowIso = new Date().toISOString();

      const accRes = await tx.query<{ cuenta_id: string; id_interno: string }>(
        `SELECT cuenta_id, id_interno
         FROM cuenta_institucional
         WHERE google_sub_id = $1 OR email_principal = $2
         LIMIT 1`,
        [params.googleSubId, params.emailPrincipal.toLowerCase()],
      );
      const existingAcc = accRes.rows[0];
      const provisionalPersonId = existingAcc
        ? String(existingAcc.id_interno)
        : crypto.randomUUID();
      const cuentaId = existingAcc ? String(existingAcc.cuenta_id) : crypto.randomUUID();

      // Buscar si ya existe otra PersonaIdentidad consolidada con ese documento oficial
      const existingPersonByDocRes = await tx.query<{ id_interno: string }>(
        `SELECT id_interno
         FROM persona_identidad
         WHERE numero_identificacion = $1
         LIMIT 1`,
        [numDoc],
      );
      const existingPersonByDoc = existingPersonByDocRes.rows[0];

      if (
        existingPersonByDoc &&
        String(existingPersonByDoc.id_interno) !== provisionalPersonId
      ) {
        const targetIdInterno = String(existingPersonByDoc.id_interno);

        // Re-vincular CuentaInstitucional y dependencias a la PersonaIdentidad existente
        await tx.query(
          `UPDATE cuenta_institucional
           SET id_interno = $2,
               estado_sincronizacion = 'SINCRONIZADA',
               hash_payload_gws = $3,
               ultima_sincronizacion_en = $4,
               actualizado_en = $4
           WHERE cuenta_id = $1`,
          [cuentaId, targetIdInterno, params.hashPayloadGws, nowIso],
        );

        await tx.query(
          `UPDATE anomalia_identidad SET id_interno = $2 WHERE id_interno = $1`,
          [provisionalPersonId, targetIdInterno],
        );

        await tx.query(
          `UPDATE asignacion_contexto SET id_interno = $2 WHERE id_interno = $1`,
          [provisionalPersonId, targetIdInterno],
        );

        // Eliminar el registro provisional huérfano en la misma transacción
        await tx.query(
          `DELETE FROM persona_identidad WHERE id_interno = $1`,
          [provisionalPersonId],
        );

        await this.auditWriter.appendEvent(tx, {
          tipoEvento: 'REGISTRO_CALIENTE_FUSIONADO',
          idInterno: targetIdInterno,
          cuentaId,
          actorSub: 'sa-sync',
          origenCanal: 'SYNC_INCREMENTAL',
          resumenCambio: `Fusión atómica de REGISTRO_CALIENTE hacia PersonaIdentidad existente (${tipoDoc}:${numDoc}). Registro provisional eliminado: ${provisionalPersonId}`,
          datosPrevios: { idInternoProvisional: provisionalPersonId },
          datosNuevos: {
            idInternoDefinitivo: targetIdInterno,
            tipoIdentificacion: tipoDoc,
            numeroIdentificacion: numDoc,
          },
          traceId: params.traceId,
        });

        return {
          action: 'MERGED_INTO_EXISTING',
          idInternoDefinitivo: targetIdInterno,
          idInternoProvisionalEliminado: provisionalPersonId,
          cuentaId,
          estadoPersona: 'ACTIVA',
          estadoCuenta: 'SINCRONIZADA',
        };
      }

      // Promoción in-place del registro provisional a ACTIVA
      await tx.query(
        `INSERT INTO persona_identidad (
           id_interno, tipo_identificacion, numero_identificacion, nombre_completo,
           estado_persona, creado_en, actualizado_en
         ) VALUES ($1, $2, $3, $4, 'ACTIVA', $5, $5)
         ON CONFLICT (id_interno) DO UPDATE SET
           tipo_identificacion = EXCLUDED.tipo_identificacion,
           numero_identificacion = EXCLUDED.numero_identificacion,
           nombre_completo = EXCLUDED.nombre_completo,
           estado_persona = 'ACTIVA',
           actualizado_en = EXCLUDED.actualizado_en`,
        [
          provisionalPersonId,
          tipoDoc,
          numDoc,
          params.gwsUser?.nombreCompleto ||
            params.gwsUser?.name?.fullName ||
            params.emailPrincipal,
          nowIso,
        ],
      );

      await tx.query(
        `INSERT INTO cuenta_institucional (
           cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
           tipo_usuario, suspended_en_gws, estado_sincronizacion, hash_payload_gws,
           origen_ultima_sincronizacion, ultima_sincronizacion_en, creado_en, actualizado_en
         ) VALUES ($1, $2, $3, $4, $5, $6, 'DOCENTE', false, 'SINCRONIZADA', $7, 'ADMIN_SDK_PUSH', $8, $8, $8)
         ON CONFLICT (cuenta_id) DO UPDATE SET
           estado_sincronizacion = 'SINCRONIZADA',
           hash_payload_gws = EXCLUDED.hash_payload_gws,
           ultima_sincronizacion_en = EXCLUDED.ultima_sincronizacion_en,
           actualizado_en = EXCLUDED.actualizado_en`,
        [
          cuentaId,
          provisionalPersonId,
          params.googleSubId,
          params.emailPrincipal.toLowerCase(),
          params.dominio.toLowerCase(),
          params.gwsUser?.orgUnitPath || '/',
          params.hashPayloadGws,
          nowIso,
        ],
      );

      await this.auditWriter.appendEvent(tx, {
        tipoEvento: 'REGISTRO_CALIENTE_PROMOVIDO',
        idInterno: provisionalPersonId,
        cuentaId,
        actorSub: 'sa-sync',
        origenCanal: 'SYNC_INCREMENTAL',
        resumenCambio: `Promoción in-place de REGISTRO_CALIENTE a ACTIVA (${tipoDoc}:${numDoc})`,
        datosPrevios: { estadoPersona: 'PENDIENTE_CONCILIACION' },
        datosNuevos: {
          estadoPersona: 'ACTIVA',
          estadoCuenta: 'SINCRONIZADA',
          tipoIdentificacion: tipoDoc,
          numeroIdentificacion: numDoc,
        },
        traceId: params.traceId,
      });

      return {
        action: 'PROMOTED_IN_PLACE',
        idInternoDefinitivo: provisionalPersonId,
        cuentaId,
        estadoPersona: 'ACTIVA',
        estadoCuenta: 'SINCRONIZADA',
      };
    });
  }

  private async keepPendingWithoutValidId(
    params: ReconcileHotIdentityParams,
    detalle: string,
  ): Promise<ReconcileHotIdentityResult> {
    return this.txManager.withTransaction(async (tx) => {
      const existingAccRes = await tx.query<{ cuenta_id: string; id_interno: string }>(
        `SELECT cuenta_id, id_interno
         FROM cuenta_institucional
         WHERE google_sub_id = $1 OR email_principal = $2
         LIMIT 1`,
        [params.googleSubId, params.emailPrincipal.toLowerCase()],
      );
      const existingAcc = existingAccRes.rows[0];
      const nowIso = new Date().toISOString();
      const idInterno = existingAcc
        ? String(existingAcc.id_interno)
        : crypto.randomUUID();
      const cuentaId = existingAcc ? String(existingAcc.cuenta_id) : crypto.randomUUID();

      if (!existingAcc) {
        const placeholderNum = `HOT-${params.googleSubId}`.slice(0, 32);
        await tx.query(
          `INSERT INTO persona_identidad (
             id_interno, tipo_identificacion, numero_identificacion, nombre_completo,
             estado_persona, creado_en, actualizado_en
           ) VALUES ($1, 'CODIGO_MINEDEC', $2, $3, 'PENDIENTE_CONCILIACION', $4, $4)
           ON CONFLICT (id_interno) DO NOTHING`,
          [idInterno, placeholderNum, params.emailPrincipal, nowIso],
        );

        await tx.query(
          `INSERT INTO cuenta_institucional (
             cuenta_id, id_interno, google_sub_id, email_principal, dominio, org_unit_path,
             tipo_usuario, suspended_en_gws, estado_sincronizacion, hash_payload_gws,
             origen_ultima_sincronizacion, ultima_sincronizacion_en, creado_en, actualizado_en
           ) VALUES ($1, $2, $3, $4, $5, '/', 'DOCENTE', false, 'REGISTRO_CALIENTE', $6, 'REGISTRO_CALIENTE', $7, $7, $7)
           ON CONFLICT (google_sub_id) DO NOTHING`,
          [
            cuentaId,
            idInterno,
            params.googleSubId,
            params.emailPrincipal.toLowerCase(),
            params.dominio.toLowerCase(),
            params.hashPayloadGws,
            nowIso,
          ],
        );
      }

      const anomaliaId = crypto.randomUUID();
      await tx.query(
        `INSERT INTO anomalia_identidad (
           anomalia_id, id_interno, cuenta_id, google_sub_id, email_principal, dominio,
           codigo_causal, efecto_acceso, estado_anomalia, detalle_tecnico, detectada_en
         ) VALUES ($1, $2, $3, $4, $5, $6, 'SIN_IDENTIFICACION_VALIDA', 'RESTRINGIDA', 'ABIERTA', $7, $8)`,
        [
          anomaliaId,
          idInterno,
          cuentaId,
          params.googleSubId,
          params.emailPrincipal.toLowerCase(),
          params.dominio.toLowerCase(),
          detalle,
          nowIso,
        ],
      );

      await this.auditWriter.appendEvent(tx, {
        tipoEvento: 'ANOMALIA_DETECTADA',
        idInterno,
        cuentaId,
        actorSub: 'sa-sync',
        origenCanal: 'SYNC_INCREMENTAL',
        resumenCambio: `REGISTRO_CALIENTE se mantiene en PENDIENTE_CONCILIACION (SIN_IDENTIFICACION_VALIDA) para ${params.emailPrincipal}`,
        datosPrevios: null,
        datosNuevos: {
          codigoAnomalia: 'SIN_IDENTIFICACION_VALIDA',
          anomaliaId,
        },
        traceId: params.traceId,
      });

      return {
        action: 'KEPT_PENDING_NO_VALID_ID',
        idInternoDefinitivo: idInterno,
        cuentaId,
        estadoPersona: 'PENDIENTE_CONCILIACION',
        estadoCuenta: 'REGISTRO_CALIENTE',
        anomaliaId,
      };
    });
  }
}
