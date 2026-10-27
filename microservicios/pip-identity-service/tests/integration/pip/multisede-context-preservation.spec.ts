import request from 'supertest';
import { createInMemoryPipTestHarness } from '../../helpers/in-memory-pip-test-harness';
import { PgAsignacionContextoRepository } from '../../../src/infrastructure/persistence/pg-context-assignment.repository';
import { SqlQueryExecutor } from '@minedec/shared';

const INTERNAL_HEADERS = {
  'X-Internal-Service-Token': 'dev-internal-pip-token-minedec',
};

const ADMIN_HEADERS = {
  'X-Goog-Authenticated-User-Email': 'accounts.google.com:superadmin@educacion.gob.ec',
  'X-Minedec-Actor-Role': 'SUPERADMIN_SEGURIDAD',
};

describe('T029 - Preservación de Asignaciones Multisede en 3FN (GWS_PRIMARIO vs PAP_DELEGADO)', () => {
  it('preserva sedes complementarias PAP_DELEGADO durante sincronizaciones con docenteMultisede = true y las desactiva automáticamente cuando pasa a false', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Sincronizar docente con docenteMultisede = true y sede primaria 17H00123 (UE Mejía)
    const upsertDocente1 = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-docente-multisede-01',
        emailPrincipal: 'roberto.multisede@docentes.educacion.gob.ec',
        nombreCompleto: 'Roberto Carlos Andrade',
        orgUnitPath: '/Docentes/Zona9/17D05',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
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
          docenteMultisede: true,
        },
      });

    expect(upsertDocente1.status).toBe(200);
    const idInterno: string = upsertDocente1.body.idInterno;

    // 2. Asignar sede complementaria (17H00456 - Colegio Benalcázar) vía PAP_DELEGADO
    const assignComplementaryRes = await request(harness.app)
      .post('/api/v1/admin/identities/1710034065/context-assignments')
      .set(ADMIN_HEADERS)
      .send({
        nivelEstructura: 'INSTITUCION_EDUCATIVA',
        viceministerio: 'EDUCACION',
        codigoZona: '09',
        codigoDistrito: '17D06',
        codigoCircuito: '17D06C02',
        codigoAmie: '17H00456',
        cargoFuncion: 'DOCENTE_FISICA_COMPLEMENTARIO',
        motivoAsignacion: 'Asignación compartida de horas de Física en Colegio Benalcázar',
      });

    expect(assignComplementaryRes.status).toBe(201);
    expect(assignComplementaryRes.body.origenDatos).toBe('PAP_DELEGADO');
    expect(assignComplementaryRes.body.esSedePrimaria).toBe(false);
    expect(assignComplementaryRes.body.codigoAmie).toBe('17H00456');

    // 3. Re-sincronizar desde GWS manteniendo docenteMultisede = true -> sede PAP_DELEGADO debe preservarse intacta
    const upsertDocente2 = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-docente-multisede-01',
        emailPrincipal: 'roberto.multisede@docentes.educacion.gob.ec',
        nombreCompleto: 'Roberto Carlos Andrade',
        orgUnitPath: '/Docentes/Zona9/17D05',
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
          jornada: 'VESPERTINA',
          docenteMultisede: true,
        },
      });

    expect(upsertDocente2.status).toBe(200);
    const activeContextsAfterSync = await harness.contextRepo.findActiveByIdInterno(idInterno);
    expect(activeContextsAfterSync).toHaveLength(2);
    expect(
      activeContextsAfterSync.some(
        (c) => c.origenDatos === 'PAP_DELEGADO' && c.codigoAmie === '17H00456' && c.activo,
      ),
    ).toBe(true);

    // 4. Sincronizar cambio de docenteMultisede de true a false -> debe desactivar automáticamente las sedes PAP_DELEGADO
    const upsertDocenteSingle = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-docente-multisede-01',
        emailPrincipal: 'roberto.multisede@docentes.educacion.gob.ec',
        nombreCompleto: 'Roberto Carlos Andrade',
        orgUnitPath: '/Docentes/Zona9/17D05',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
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
          jornada: 'VESPERTINA',
          docenteMultisede: false,
        },
      });

    expect(upsertDocenteSingle.status).toBe(200);
    const activeAfterDisable = await harness.contextRepo.findActiveByIdInterno(idInterno);
    expect(activeAfterDisable).toHaveLength(1);
    expect(activeAfterDisable[0]?.origenDatos).toBe('GWS_PRIMARIO');

    // 5. Intentar agregar sede complementaria cuando docenteMultisede = false -> 422
    const forbiddenAssignRes = await request(harness.app)
      .post('/api/v1/admin/identities/1710034065/context-assignments')
      .set(ADMIN_HEADERS)
      .send({
        nivelEstructura: 'INSTITUCION_EDUCATIVA',
        codigoZona: '09',
        codigoDistrito: '17D06',
        codigoCircuito: '17D06C02',
        codigoAmie: '17H00456',
        motivoAsignacion: 'Intento no permitido con docenteMultisede en false',
      });

    expect(forbiddenAssignRes.status).toBe(422);
  });

  it('ejecuta consultas parametrizadas ($1, $2) en PgAsignacionContextoRepository', async () => {
    const queries: string[] = [];
    const mockSql: SqlQueryExecutor = {
      query: async <T>(text: string) => {
        queries.push(text);
        return {
          rows: [
            {
              asignacion_id: '880e8400-e29b-41d4-a716-446655440000',
              id_interno: '550e8400-e29b-41d4-a716-446655440000',
              cuenta_id: null,
              codigo_amie: '17H00456',
              nivel_estructura: 'INSTITUCION_EDUCATIVA',
              codigo_zona: '09',
              codigo_distrito: '17D06',
              codigo_circuito: '17D06C02',
              viceministerio: 'EDUCACION',
              codigo_dependencia_admin: null,
              cargo_funcion: 'DOCENTE_AULA',
              es_sede_primaria: false,
              origen_datos: 'PAP_DELEGADO',
              motivo_asignacion: 'Multisede',
              activo: true,
              creado_en: '2026-10-18T10:00:00.000Z',
              actualizado_en: '2026-10-18T10:00:00.000Z',
            } as unknown as T,
          ],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      },
    };

    const pgContextRepo = new PgAsignacionContextoRepository(mockSql);
    const active = await pgContextRepo.findActiveByIdInterno(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(active).toHaveLength(1);
    await pgContextRepo.findAllByIdInterno('550e8400-e29b-41d4-a716-446655440000');
    await pgContextRepo.findPrimaryByCuentaId('660e8400-e29b-41d4-a716-446655440001');
    await pgContextRepo.upsertPrimaryAssignment(active[0]!);
    await pgContextRepo.insertDelegatedAssignment(active[0]!);
    await pgContextRepo.deactivateDelegatedAssignmentsByIdInterno(
      '550e8400-e29b-41d4-a716-446655440000',
      '660e8400-e29b-41d4-a716-446655440001',
    );
    await pgContextRepo.deactivateDelegatedAssignmentsByIdInterno(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    await pgContextRepo.relinkAssignmentsToPersona(
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655449999',
    );
    expect(queries.length).toBeGreaterThanOrEqual(8);
  });
});
