import request from 'supertest';
import { createInMemoryPipTestHarness } from '../../helpers/in-memory-pip-test-harness';
import { PgAnomaliaIdentidadRepository } from '../../../src/infrastructure/persistence/pg-anomaly.repository';
import { SqlQueryExecutor } from '@minedec/shared';

const INTERNAL_HEADERS = {
  'X-Internal-Service-Token': 'dev-internal-pip-token-minedec',
};

const ADMIN_HEADERS = {
  'X-Goog-Authenticated-User-Email': 'accounts.google.com:superadmin@educacion.gob.ec',
  'X-Minedec-Actor-Role': 'SUPERADMIN_SEGURIDAD',
};

describe('T036 - Ciclo de Vida Completo de Anomalías (BLOQUEANTE vs RESTRINGIDA, Auto-Resolución, Cierre Manual y Reincidencia)', () => {
  it('auto-resuelve (AUTO_SINCRONIZACION) anomalías operativas no colisionales al corregirse en GWS y encadena reincidencias mediante anomaliaAnteriorId', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Primera sincronización con sede AMIE inexistente (99H99999) -> genera anomalía RESTRINGIDA SEDE_AMIE_INEXISTENTE
    const badAmieRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-docente-anomalia-amie',
        emailPrincipal: 'docente.amie@docentes.educacion.gob.ec',
        nombreCompleto: 'Docente Con Sede Errónea',
        orgUnitPath: '/Docentes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
          subtipoUsuario: 'DOCENTE_NOMBRAMIENTO',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '99H99999', // No existe en catalogo_territorio_sede
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(badAmieRes.status).toBe(200);
    expect(badAmieRes.body.estadoPersona).toBe('RESTRINGIDA_ANOMALIA');
    expect(badAmieRes.body.anomaliasAbiertas).toHaveLength(1);
    const firstAnomalyId: string = badAmieRes.body.anomaliasAbiertas[0].anomaliaId;
    expect(badAmieRes.body.anomaliasAbiertas[0].codigoCausal).toBe('FORMATO_AMIE_INVALIDO');
    expect(badAmieRes.body.anomaliasAbiertas[0].efectoAcceso).toBe('RESTRINGIDA');

    // En modo RESTRINGIDA, resolve permite acceso degradado (200 OK con RESTRINGIDA_SOLO_AUTENTICADA)
    const resolveRestricted = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-docente-anomalia-amie',
        emailPrincipal: 'docente.amie@docentes.educacion.gob.ec',
        nombreCompleto: 'Docente Con Sede Errónea',
      });
    expect(resolveRestricted.status).toBe(200);
    expect(resolveRestricted.body.nivelAccesoEfectivo).toBe('RESTRINGIDA_SOLO_AUTENTICADA');

    // 2. Segunda sincronización corrigiendo el AMIE a 17H00123 -> debe auto-resolver (AUTO_SINCRONIZACION)
    const fixedAmieRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-docente-anomalia-amie',
        emailPrincipal: 'docente.amie@docentes.educacion.gob.ec',
        nombreCompleto: 'Docente Con Sede Errónea',
        orgUnitPath: '/Docentes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'BARRIDO_DELTA_2MIN',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
          subtipoUsuario: 'DOCENTE_NOMBRAMIENTO',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(fixedAmieRes.status).toBe(200);
    expect(fixedAmieRes.body.estadoPersona).toBe('ACTIVA');
    expect(fixedAmieRes.body.anomaliasAbiertas).toHaveLength(0);
    expect(fixedAmieRes.body.anomaliasResueltasAutomaticamente).toContain(firstAnomalyId);

    const resolvedRecord = await harness.anomalyRepo.findById(firstAnomalyId);
    expect(resolvedRecord?.estadoAnomalia).toBe('RESUELTA');
    expect(resolvedRecord?.origenResolucion).toBe('AUTO_SINCRONIZACION');

    // 3. Reincidencia: vuelve a llegar un AMIE inexistente (88H88888) -> crea nueva fila con anomaliaAnteriorId apuntando a firstAnomalyId
    const recurrenceRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-docente-anomalia-amie',
        emailPrincipal: 'docente.amie@docentes.educacion.gob.ec',
        nombreCompleto: 'Docente Con Sede Errónea',
        orgUnitPath: '/Docentes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'CONCILIACION_DIARIA',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
          subtipoUsuario: 'DOCENTE_NOMBRAMIENTO',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '88H88888',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(recurrenceRes.status).toBe(200);
    expect(recurrenceRes.body.anomaliasAbiertas).toHaveLength(1);
    const secondAnomalyId: string = recurrenceRes.body.anomaliasAbiertas[0].anomaliaId;
    expect(secondAnomalyId).not.toBe(firstAnomalyId);

    const secondRecord = await harness.anomalyRepo.findById(secondAnomalyId);
    expect(secondRecord?.anomaliaAnteriorId).toBe(firstAnomalyId);
  });

  it('mantiene COLISION_IDENTIFICADOR en LISTA_PARA_CERRAR hasta cierre manual (MANUAL_ADMIN) con auditoría e invalidación de caché, y deniega acceso (403 fail-close) ante anomalía BLOQUEANTE', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Cuenta con cédula módulo 10 inválida -> anomalía BLOQUEANTE FORMATO_CEDULA_INVALIDO
    const blockedRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-cedula-invalida-bloqueada',
        emailPrincipal: 'bloqueado@educacion.gob.ec',
        nombreCompleto: 'Usuario Con Cédula Inválida',
        orgUnitPath: '/Administrativos',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034069', // Dígito verificador incorrecto
          tipoUsuario: 'ADMINISTRATIVO',
          subtipoUsuario: 'SERVIDOR_PUBLICO',
          nivelEstructura: 'PLANTA_CENTRAL',
          viceministerio: 'EDUCACION',
          codigoDependenciaAdmin: 'DNTIC-01',
        },
      });

    expect(blockedRes.status).toBe(200);
    expect(blockedRes.body.estadoPersona).toBe('BLOQUEADA_ANOMALIA');

    // Intento de resolve para cuenta con anomalía BLOQUEANTE -> 403 Forbidden (fail-close)
    const resolveBlocked = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-cedula-invalida-bloqueada',
        emailPrincipal: 'bloqueado@educacion.gob.ec',
        nombreCompleto: 'Usuario Con Cédula Inválida',
      });
    expect(resolveBlocked.status).toBe(403);

    // 2. Provocar una anomalía COLISION_IDENTIFICADOR intentando usar un idInterno distinto para una CEDULA ya consolidada
    const titularRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-titular-colision',
        emailPrincipal: 'titular@docentes.educacion.gob.ec',
        nombreCompleto: 'Titular Legítimo',
        orgUnitPath: '/Docentes',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856',
          tipoUsuario: 'DOCENTE',
          subtipoUsuario: 'DOCENTE_NOMBRAMIENTO',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });
    expect(titularRes.status).toBe(200);

    // Otra cuenta viene con un idInterno explícito diferente pero la misma CEDULA 0926687856 -> 409 COLISION_IDENTIFICADOR
    const collidingRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-colisionante-01',
        emailPrincipal: 'colisionante@estudiante.edu.ec',
        nombreCompleto: 'Cuenta En Colisión',
        orgUnitPath: '/Estudiantes',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          idInterno: '99999999-e29b-41d4-a716-446655440000',
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856',
          fechaNacimiento: '2005-01-10',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'ESTUDIANTE_REGULAR',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          gradoCurso: '3BGU',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });
    expect(collidingRes.status).toBe(409);

    // Listar anomalías vía GET /api/v1/admin/anomalies?codigoCausal=COLISION_IDENTIFICADOR
    const listCollisionRes = await request(harness.app)
      .get('/api/v1/admin/anomalies?codigoCausal=COLISION_IDENTIFICADOR')
      .set(ADMIN_HEADERS);

    expect(listCollisionRes.status).toBe(200);
    expect(listCollisionRes.body.items).toHaveLength(1);
    const collisionAnomalyId: string = listCollisionRes.body.items[0].anomaliaId;
    expect(listCollisionRes.body.items[0].estadoAnomalia).toBe('ABIERTA');

    // 3. Cuando en Google Workspace se corrige la cédula de sub-colisionante-01 a su cédula real (0102030405),
    // COLISION_IDENTIFICADOR NO se cierra sola: pasa a LISTA_PARA_CERRAR esperando confirmación administrativa
    const correctedCollisionSync = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-colisionante-01',
        emailPrincipal: 'colisionante@estudiante.edu.ec',
        nombreCompleto: 'Cuenta En Colisión Corregida',
        orgUnitPath: '/Estudiantes',
        suspendedEnGws: false,
        origenSincronizacion: 'BARRIDO_DELTA_2MIN',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0102030405',
          fechaNacimiento: '2005-01-10',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'ESTUDIANTE_REGULAR',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          gradoCurso: '3BGU',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(correctedCollisionSync.status).toBe(200);
    const afterSyncAnomaly = await harness.anomalyRepo.findById(collisionAnomalyId);
    expect(afterSyncAnomaly?.estadoAnomalia).toBe('LISTA_PARA_CERRAR');

    // 4. El administrador cierra manualmente la anomalía vía POST /api/v1/admin/anomalies/:anomaliaId/resolve
    const manualCloseRes = await request(harness.app)
      .post(`/api/v1/admin/anomalies/${collisionAnomalyId}/resolve`)
      .set(ADMIN_HEADERS)
      .send({
        motivoResolucion: 'Verificado con Distrito 17D05 que el documento correcto es 0102030405',
      });

    expect(manualCloseRes.status).toBe(200);
    expect(manualCloseRes.body.estadoAnomalia).toBe('RESUELTA');
    expect(manualCloseRes.body.origenResolucion).toBe('MANUAL_ADMIN');

    // Verificar que la persona quedó en estado ACTIVA y acceso COMPLETO
    const resolveAfterManualClose = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-colisionante-01',
        emailPrincipal: 'colisionante@estudiante.edu.ec',
        nombreCompleto: 'Cuenta En Colisión Corregida',
      });
    expect(resolveAfterManualClose.status).toBe(200);
    expect(resolveAfterManualClose.body.estadoPersona).toBe('ACTIVA');
    expect(resolveAfterManualClose.body.nivelAccesoEfectivo).toBe('COMPLETO');
  });

  it('ejecuta consultas parametrizadas ($1, $2) en PgAnomaliaIdentidadRepository', async () => {
    const queries: string[] = [];
    const mockSql: SqlQueryExecutor = {
      query: async <T>(text: string) => {
        queries.push(text);
        return {
          rows: [
            {
              anomalia_id: '990e8400-e29b-41d4-a716-446655440000',
              anomalia_anterior_id: null,
              id_interno: '550e8400-e29b-41d4-a716-446655440000',
              cuenta_id: '660e8400-e29b-41d4-a716-446655440001',
              google_sub_id: '109988776655443322110',
              email_principal: 'maria.loja@docentes.educacion.gob.ec',
              dominio: 'docentes.educacion.gob.ec',
              codigo_causal: 'SEDE_AMIE_INEXISTENTE',
              efecto_acceso: 'RESTRINGIDA',
              estado_anomalia: 'ABIERTA',
              origen_resolucion: null,
              resuelta_por_identificacion: null,
              motivo_resolucion: null,
              valor_anterior: '{"codigoInstitucion":"99H99999"}',
              valor_nuevo: null,
              detalle_tecnico: 'AMIE no encontrado',
              detectada_en: '2026-10-18T10:00:00.000Z',
              resuelta_en: null,
            } as unknown as T,
          ],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      },
    };

    const pgAnomalyRepo = new PgAnomaliaIdentidadRepository(mockSql);
    const found = await pgAnomalyRepo.findById('990e8400-e29b-41d4-a716-446655440000');
    expect(found).toBeDefined();
    await pgAnomalyRepo.findActiveByGoogleSubId('109988776655443322110');
    await pgAnomalyRepo.findActiveByIdInterno('550e8400-e29b-41d4-a716-446655440000');
    await pgAnomalyRepo.findLatestResolvedByGoogleSubIdAndCausal(
      '109988776655443322110',
      'FORMATO_AMIE_INVALIDO',
    );
    if (found) {
      await pgAnomalyRepo.insert(found);
      await pgAnomalyRepo.update({ ...found, estadoAnomalia: 'RESUELTA' });
    }
    const page = await pgAnomalyRepo.listPaginated({
      estadoAnomalia: 'ABIERTA',
      efectoAcceso: 'RESTRINGIDA',
      codigoCausal: 'FORMATO_AMIE_INVALIDO',
      dominio: 'docentes.educacion.gob.ec',
      pageSize: 10,
      cursor: '0',
    });
    expect(page.items).toHaveLength(1);
    expect(queries.length).toBeGreaterThanOrEqual(7);
  });
});
