import crypto from 'node:crypto';
import {
  HARD_MAX_REDIS_TTL_SECONDS,
  KeyValueCacheClient,
  RedisCacheClient,
  SqlQueryExecutor,
  StructuredLogger,
} from '@minedec/shared';
import {
  GoogleVerifiedIdentityClaims,
  ResultadoResolucionPipOidc,
  TipoIdentificacionPersona,
} from '../../domain/entities/oidc-broker.entities';
import { IPipIdentityResolverPort } from '../../domain/ports/oidc-broker.ports';

export interface PriorityHotRegistrationDispatcher {
  enqueuePriorityReconciliation(params: {
    googleSubId: string;
    emailPrincipal: string;
    dominio: string;
    traceId: string;
  }): Promise<void>;
}

export interface PipIdentityResolverAdapterOptions {
  maxHotRegistrationWaitMs?: number;
  pollIntervalMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  priorityDispatcher?: PriorityHotRegistrationDispatcher;
  logger?: StructuredLogger;
}

interface PipIdentityRow {
  id_interno: string;
  tipo_identificacion: TipoIdentificacionPersona | null;
  numero_identificacion: string | null;
  nombre_completo: string;
  estado_persona: string;
  cuenta_id: string;
  google_sub_id: string;
  email_principal: string;
  dominio: string;
  estado_sincronizacion: string;
  suspended_en_gws: boolean;
  fecha_fin_vigencia: Date | string | null;
}

/**
 * Adaptador de resolución de identidad contra el Repositorio Central PIP (Memorystore for Redis L2 + AlloyDB).
 * Cumple estrictamente:
 * - **0 llamadas a `Google Admin SDK`** desde `sso-oidc` (`R-02`, `FR-007`).
 * - Soporte de `REGISTRO_CALIENTE` con encolamiento prioritario (`conecta-sync-priority-hot-reg`) y
 *   **espera corta local acotada (`<= 3.000 ms`, sondeo cada `500 ms`)** (`Clarificación Q1`, `FR-007`, `SC-003`).
 * - Postura `fail-close` si al agotar la ventana persiste en `PENDIENTE_IDENTIFICACION` o si la cuenta/persona
 *   está suspendida, eliminada, inactiva, con vigencia vencida o bloqueada por anomalía (`FR-010`).
 */
export class PipIdentityResolverAdapter implements IPipIdentityResolverPort {
  public static readonly DEFAULT_MAX_WAIT_MS = 3000;
  public static readonly DEFAULT_POLL_INTERVAL_MS = 500;

  private readonly maxHotRegistrationWaitMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly priorityDispatcher?: PriorityHotRegistrationDispatcher;
  private readonly logger?: StructuredLogger;

  constructor(
    private readonly db: SqlQueryExecutor,
    private readonly redis?: KeyValueCacheClient,
    options: PipIdentityResolverAdapterOptions = {},
  ) {
    this.maxHotRegistrationWaitMs =
      options.maxHotRegistrationWaitMs ??
      Number(
        process.env.SSO_OIDC_HOT_REG_MAX_WAIT_MS ??
          PipIdentityResolverAdapter.DEFAULT_MAX_WAIT_MS,
      );
    this.pollIntervalMs =
      options.pollIntervalMs ??
      Number(
        process.env.SSO_OIDC_HOT_REG_POLL_INTERVAL_MS ??
          PipIdentityResolverAdapter.DEFAULT_POLL_INTERVAL_MS,
      );
    this.sleepFn =
      options.sleepFn ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.priorityDispatcher = options.priorityDispatcher;
    this.logger = options.logger;
  }

  public async resolveIdentityForOidcCallback(params: {
    googleClaims: GoogleVerifiedIdentityClaims;
    traceId: string;
  }): Promise<ResultadoResolucionPipOidc> {
    const { googleClaims, traceId } = params;
    let fueRegistroCaliente = false;
    let row = await this.findAccountInPip(googleClaims.googleSubId, googleClaims.emailPrincipal);

    if (!row) {
      fueRegistroCaliente = true;
      row = await this.provisionProvisionalHotRegistration(googleClaims);
      if (this.priorityDispatcher) {
        await this.priorityDispatcher.enqueuePriorityReconciliation({
          googleSubId: googleClaims.googleSubId,
          emailPrincipal: googleClaims.emailPrincipal,
          dominio: googleClaims.hd,
          traceId,
        });
      }
    } else if (
      row.estado_sincronizacion === 'REGISTRO_CALIENTE' ||
      row.estado_persona === 'PENDIENTE_IDENTIFICACION' ||
      !row.numero_identificacion
    ) {
      fueRegistroCaliente = true;
      if (this.priorityDispatcher) {
        await this.priorityDispatcher.enqueuePriorityReconciliation({
          googleSubId: googleClaims.googleSubId,
          emailPrincipal: googleClaims.emailPrincipal,
          dominio: googleClaims.hd,
          traceId,
        });
      }
    }

    const inactiveDenial = this.evaluateInactiveOrSuspendedReason(row);
    if (inactiveDenial) {
      return {
        estadoResolucion: 'CUENTA_SUSPENDIDA_O_INACTIVA',
        idInterno: row.id_interno,
        cuentaId: row.cuenta_id,
        googleSubId: row.google_sub_id,
        emailPrincipal: row.email_principal,
        dominio: row.dominio,
        tipoIdentificacion: row.tipo_identificacion,
        numeroIdentificacion: row.numero_identificacion,
        nombreCompleto: row.nombre_completo,
        estadoPersona: row.estado_persona,
        estadoSincronizacion: row.estado_sincronizacion,
        suspendedEnGws: row.suspended_en_gws,
        fueRegistroCaliente,
        intentosEsperaRealizados: 0,
        motivoDenegacion: inactiveDenial,
      };
    }

    if (this.isIdentityConsolidated(row)) {
      await this.cachePipSnapshot(row);
      return {
        estadoResolucion: 'CONSOLIDADA_ACTIVA',
        idInterno: row.id_interno,
        cuentaId: row.cuenta_id,
        googleSubId: row.google_sub_id,
        emailPrincipal: row.email_principal,
        dominio: row.dominio,
        tipoIdentificacion: row.tipo_identificacion!,
        numeroIdentificacion: row.numero_identificacion!,
        nombreCompleto: row.nombre_completo,
        estadoPersona: row.estado_persona,
        estadoSincronizacion: row.estado_sincronizacion,
        suspendedEnGws: row.suspended_en_gws,
        fueRegistroCaliente,
        intentosEsperaRealizados: 0,
      };
    }

    // Espera corta local acotada (<= 3.000 ms, sondeo cada 500 ms) sin invocar Google Admin SDK
    const maxAttempts = Math.max(
      1,
      Math.floor(this.maxHotRegistrationWaitMs / Math.max(1, this.pollIntervalMs)),
    );
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts += 1;
      await this.sleepFn(this.pollIntervalMs);

      const refreshed = await this.findAccountInPip(
        googleClaims.googleSubId,
        googleClaims.emailPrincipal,
      );
      if (refreshed) {
        row = refreshed;
        const denialDuringWait = this.evaluateInactiveOrSuspendedReason(row);
        if (denialDuringWait) {
          return {
            estadoResolucion: 'CUENTA_SUSPENDIDA_O_INACTIVA',
            idInterno: row.id_interno,
            cuentaId: row.cuenta_id,
            googleSubId: row.google_sub_id,
            emailPrincipal: row.email_principal,
            dominio: row.dominio,
            tipoIdentificacion: row.tipo_identificacion,
            numeroIdentificacion: row.numero_identificacion,
            nombreCompleto: row.nombre_completo,
            estadoPersona: row.estado_persona,
            estadoSincronizacion: row.estado_sincronizacion,
            suspendedEnGws: row.suspended_en_gws,
            fueRegistroCaliente: true,
            intentosEsperaRealizados: attempts,
            motivoDenegacion: denialDuringWait,
          };
        }

        if (this.isIdentityConsolidated(row)) {
          await this.cachePipSnapshot(row);
          return {
            estadoResolucion: 'CONSOLIDADA_ACTIVA',
            idInterno: row.id_interno,
            cuentaId: row.cuenta_id,
            googleSubId: row.google_sub_id,
            emailPrincipal: row.email_principal,
            dominio: row.dominio,
            tipoIdentificacion: row.tipo_identificacion!,
            numeroIdentificacion: row.numero_identificacion!,
            nombreCompleto: row.nombre_completo,
            estadoPersona: row.estado_persona,
            estadoSincronizacion: row.estado_sincronizacion,
            suspendedEnGws: row.suspended_en_gws,
            fueRegistroCaliente: true,
            intentosEsperaRealizados: attempts,
          };
        }
      }
    }

    this.logger?.warn(
      'Cuenta en REGISTRO_CALIENTE agotó ventana de espera corta (<= 3 s) sin numero_identificacion consolidado; aplicando retención fail-close',
      {
        traceId,
        googleSubId: row.google_sub_id,
        emailPrincipal: row.email_principal,
        intentosEsperaRealizados: attempts,
      },
    );

    return {
      estadoResolucion: 'PENDIENTE_IDENTIFICACION_RETENIDA',
      idInterno: row.id_interno,
      cuentaId: row.cuenta_id,
      googleSubId: row.google_sub_id,
      emailPrincipal: row.email_principal,
      dominio: row.dominio,
      tipoIdentificacion: row.tipo_identificacion,
      numeroIdentificacion: row.numero_identificacion,
      nombreCompleto: row.nombre_completo,
      estadoPersona: row.estado_persona,
      estadoSincronizacion: row.estado_sincronizacion,
      suspendedEnGws: row.suspended_en_gws,
      fueRegistroCaliente: true,
      intentosEsperaRealizados: attempts,
      motivoDenegacion:
        'La cuenta institucional es reciente y su documento de identificación oficial aún está siendo sincronizado.',
    };
  }

  public async verifySessionSubjectStillActive(params: {
    idInterno: string;
    cuentaId: string;
    traceId: string;
  }): Promise<boolean> {
    const result = await this.db.query<PipIdentityRow>(
      `SELECT
         p.id_interno,
         p.tipo_identificacion,
         p.numero_identificacion,
         p.nombre_completo,
         p.estado_persona,
         c.cuenta_id,
         c.google_sub_id,
         c.email_principal,
         c.dominio,
         c.estado_sincronizacion,
         c.suspended_en_gws,
         c.fecha_fin_vigencia
       FROM cuenta_institucional c
       INNER JOIN persona_identidad p ON p.id_interno = c.id_interno
       WHERE c.cuenta_id = $1 AND p.id_interno = $2
       LIMIT 1`,
      [params.cuentaId, params.idInterno],
    );

    const row = result.rows[0];
    if (!row) {
      return false;
    }

    const inactiveReason = this.evaluateInactiveOrSuspendedReason(row);
    if (inactiveReason) {
      return false;
    }

    return this.isIdentityConsolidated(row);
  }

  private async findAccountInPip(
    googleSubId: string,
    emailPrincipal: string,
  ): Promise<PipIdentityRow | null> {
    const result = await this.db.query<PipIdentityRow>(
      `SELECT
         p.id_interno,
         p.tipo_identificacion,
         p.numero_identificacion,
         p.nombre_completo,
         p.estado_persona,
         c.cuenta_id,
         c.google_sub_id,
         c.email_principal,
         c.dominio,
         c.estado_sincronizacion,
         c.suspended_en_gws,
         c.fecha_fin_vigencia
       FROM cuenta_institucional c
       INNER JOIN persona_identidad p ON p.id_interno = c.id_interno
       WHERE c.google_sub_id = $1 OR LOWER(c.email_principal) = $2
       LIMIT 1`,
      [googleSubId.trim(), emailPrincipal.trim().toLowerCase()],
    );

    return result.rows[0] ?? null;
  }

  private async provisionProvisionalHotRegistration(
    googleClaims: GoogleVerifiedIdentityClaims,
  ): Promise<PipIdentityRow> {
    const idInterno = crypto.randomUUID();
    const cuentaId = crypto.randomUUID();
    const fullName =
      googleClaims.fullName?.trim() ||
      [googleClaims.givenName, googleClaims.familyName].filter(Boolean).join(' ').trim() ||
      googleClaims.emailPrincipal;

    await this.db.query(
      `INSERT INTO persona_identidad (
         id_interno,
         tipo_identificacion,
         numero_identificacion,
         nombre_completo,
         estado_persona
       ) VALUES ($1, $2, $3, $4, $5)`,
      [idInterno, null, null, fullName, 'PENDIENTE_IDENTIFICACION'],
    );

    await this.db.query(
      `INSERT INTO cuenta_institucional (
         cuenta_id,
         id_interno,
         google_sub_id,
         email_principal,
         dominio,
         org_unit_path,
         given_name,
         family_name,
         suspended_en_gws,
         estado_sincronizacion,
         origen_ultima_sincronizacion
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        cuentaId,
        idInterno,
        googleClaims.googleSubId,
        googleClaims.emailPrincipal.toLowerCase(),
        googleClaims.hd.toLowerCase(),
        '/',
        googleClaims.givenName ?? null,
        googleClaims.familyName ?? null,
        false,
        'REGISTRO_CALIENTE',
        'REGISTRO_CALIENTE',
      ],
    );

    return {
      id_interno: idInterno,
      tipo_identificacion: null,
      numero_identificacion: null,
      nombre_completo: fullName,
      estado_persona: 'PENDIENTE_IDENTIFICACION',
      cuenta_id: cuentaId,
      google_sub_id: googleClaims.googleSubId,
      email_principal: googleClaims.emailPrincipal.toLowerCase(),
      dominio: googleClaims.hd.toLowerCase(),
      estado_sincronizacion: 'REGISTRO_CALIENTE',
      suspended_en_gws: false,
      fecha_fin_vigencia: null,
    };
  }

  private isIdentityConsolidated(row: PipIdentityRow): boolean {
    return Boolean(
      row.tipo_identificacion &&
        row.numero_identificacion &&
        row.numero_identificacion.trim().length >= 4 &&
        (row.estado_persona === 'ACTIVA' || row.estado_persona === 'RESTRINGIDA_ANOMALIA') &&
        row.estado_sincronizacion === 'SINCRONIZADA' &&
        !row.suspended_en_gws,
    );
  }

  private evaluateInactiveOrSuspendedReason(row: PipIdentityRow): string | null {
    if (row.suspended_en_gws || row.estado_sincronizacion === 'SUSPENDIDA_GWS') {
      return 'La cuenta institucional se encuentra suspendida en Google Workspace.';
    }
    if (row.estado_sincronizacion === 'ELIMINADA_GWS') {
      return 'La cuenta institucional ha sido dada de baja en el directorio primario.';
    }
    if (row.estado_sincronizacion === 'VIGENCIA_VENCIDA') {
      return 'El periodo de vigencia temporal de la cuenta institucional ha expirado.';
    }
    if (
      row.estado_sincronizacion === 'BLOQUEADA_ANOMALIA' ||
      row.estado_persona === 'BLOQUEADA_ANOMALIA'
    ) {
      return 'La identidad presenta una anomalía bloqueante de seguridad pendiente de resolución.';
    }
    if (row.estado_persona === 'INACTIVA') {
      return 'El expediente de identidad de la persona se encuentra en estado INACTIVO.';
    }
    if (row.fecha_fin_vigencia) {
      const fin = new Date(row.fecha_fin_vigencia);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (fin.getTime() < today.getTime()) {
        return 'La fecha de fin de vigencia de la vinculación institucional se encuentra vencida.';
      }
    }
    return null;
  }

  private async cachePipSnapshot(row: PipIdentityRow): Promise<void> {
    if (!this.redis) {
      return;
    }
    const payload = JSON.stringify({
      idInterno: row.id_interno,
      cuentaId: row.cuenta_id,
      googleSubId: row.google_sub_id,
      emailPrincipal: row.email_principal,
      dominio: row.dominio,
      tipoIdentificacion: row.tipo_identificacion,
      numeroIdentificacion: row.numero_identificacion,
      nombreCompleto: row.nombre_completo,
      estadoPersona: row.estado_persona,
      estadoSincronizacion: row.estado_sincronizacion,
    });
    await this.redis.setWithTtl(
      RedisCacheClient.keyBySub(row.google_sub_id),
      payload,
      HARD_MAX_REDIS_TTL_SECONDS,
    );
  }
}
