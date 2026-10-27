import request from 'supertest';
import { createInMemoryPipTestHarness } from '../../helpers/in-memory-pip-test-harness';

const INTERNAL_HEADERS = {
  'X-Internal-Service-Token': 'dev-internal-pip-token-minedec',
};

const ADMIN_HEADERS = {
  'X-Goog-Authenticated-User-Email': 'accounts.google.com:superadmin@educacion.gob.ec',
  'X-Minedec-Actor-Role': 'SUPERADMIN_SEGURIDAD',
};

describe('T030 - Transición Unidireccional CODIGO_MINEDEC -> CEDULA e Inmutabilidad Estricta de CEDULA (Principio X.2)', () => {
  it('transiciona unidireccionalmente de CODIGO_MINEDEC a CEDULA conservando idInterno y codigoMinedecAnterior, y rechaza con 409 cualquier intento posterior de mutar la CEDULA consolidada', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Alta inicial con CODIGO_MINEDEC (estudiante sin cédula al momento de matrícula)
    const initialRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-estudiante-transicion-01',
        emailPrincipal: 'mateo.transicion@estudiante.edu.ec',
        nombreCompleto: 'Mateo Sebastián Quispe',
        orgUnitPath: '/Estudiantes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CODIGO_MINEDEC',
          numeroIdentificacion: 'MIN-2026-000123',
          fechaNacimiento: '2012-06-15',
          representanteLegalCedula: '1710034065',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'ESTUDIANTE_REGULAR',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          gradoCurso: '9EGB',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(initialRes.status).toBe(200);
    const originalIdInterno: string = initialRes.body.idInterno;
    expect(initialRes.body.transitionedFromCodigoMinedec).toBe(false);

    // Poblar caché L2 bajo CODIGO_MINEDEC antes de la transición
    const resolveBefore = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-estudiante-transicion-01',
        emailPrincipal: 'mateo.transicion@estudiante.edu.ec',
        nombreCompleto: 'Mateo Sebastián Quispe',
        tipoIdentificacion: 'CODIGO_MINEDEC',
        numeroIdentificacion: 'MIN-2026-000123',
      });
    expect(resolveBefore.status).toBe(200);

    // 2. Ejecutar transición unidireccional CODIGO_MINEDEC (MIN-2026-000123) -> CEDULA (0926687856)
    const transitionRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-estudiante-transicion-01',
        emailPrincipal: 'mateo.transicion@estudiante.edu.ec',
        nombreCompleto: 'Mateo Sebastián Quispe',
        orgUnitPath: '/Estudiantes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          idInterno: originalIdInterno,
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856',
          fechaNacimiento: '2012-06-15',
          representanteLegalCedula: '1710034065',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'ESTUDIANTE_REGULAR',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          gradoCurso: '9EGB',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(transitionRes.status).toBe(200);
    expect(transitionRes.body.idInterno).toBe(originalIdInterno);
    expect(transitionRes.body.transitionedFromCodigoMinedec).toBe(true);
    expect(transitionRes.body.cacheInvalidated).toBe(true);

    // Verificar que codigoMinedecAnterior fue preservado y se auditó TRANSICION_CODIGO_A_CEDULA
    const adminView = await request(harness.app)
      .get('/api/v1/admin/identities/0926687856')
      .set(ADMIN_HEADERS);

    expect(adminView.status).toBe(200);
    expect(adminView.body.idInterno).toBe(originalIdInterno);
    expect(adminView.body.tipoIdentificacion).toBe('CEDULA');
    expect(adminView.body.numeroIdentificacion).toBe('0926687856');
    expect(adminView.body.codigoMinedecAnterior).toBe('MIN-2026-000123');

    expect(harness.auditLog.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipoEvento: 'TRANSICION_CODIGO_A_CEDULA',
          entidadId: originalIdInterno,
        }),
      ]),
    );

    // 3. Intentar mutar la CEDULA ya consolidada (0926687856 -> 0102030405) -> 409 Conflict (Principio X.2)
    const mutateCedulaRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-estudiante-transicion-01',
        emailPrincipal: 'mateo.transicion@estudiante.edu.ec',
        nombreCompleto: 'Mateo Sebastián Quispe',
        orgUnitPath: '/Estudiantes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          idInterno: originalIdInterno,
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0102030405',
          fechaNacimiento: '2012-06-15',
          representanteLegalCedula: '1710034065',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'ESTUDIANTE_REGULAR',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          gradoCurso: '9EGB',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(mutateCedulaRes.status).toBe(409);

    // Verificar que la CEDULA original 0926687856 permaneció intacta en la BD
    const afterAttempt = await harness.personaRepo.findByIdInterno(originalIdInterno);
    expect(afterAttempt?.numeroIdentificacion).toBe('0926687856');
  });

  it('bloquea con 409 Conflict y anomalía BLOQUEANTE COLISION_IDENTIFICADOR cuando una transición intenta usar una CEDULA que ya pertenece a otro idInterno', async () => {
    const harness = createInMemoryPipTestHarness();

    // Persona A ya consolidada con CEDULA 0926687856
    const personaARes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-persona-a-cedula',
        emailPrincipal: 'persona.a@docentes.educacion.gob.ec',
        nombreCompleto: 'Persona A Titular Cédula',
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
    expect(personaARes.status).toBe(200);

    // Persona B registrada inicialmente con CODIGO_MINEDEC MIN-2026-777888
    const personaBRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-persona-b-codigo',
        emailPrincipal: 'persona.b@estudiante.edu.ec',
        nombreCompleto: 'Persona B Con Código',
        orgUnitPath: '/Estudiantes',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CODIGO_MINEDEC',
          numeroIdentificacion: 'MIN-2026-777888',
          fechaNacimiento: '2004-02-10',
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
    expect(personaBRes.status).toBe(200);

    // Persona B intenta transicionar a la CEDULA 0926687856 que ya pertenece a Persona A -> 409 Conflict
    const collisionRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-persona-b-codigo',
        emailPrincipal: 'persona.b@estudiante.edu.ec',
        nombreCompleto: 'Persona B Con Código',
        orgUnitPath: '/Estudiantes',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          idInterno: personaBRes.body.idInterno,
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856',
          fechaNacimiento: '2004-02-10',
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

    expect(collisionRes.status).toBe(409);

    const openAnomaliesB = await harness.anomalyRepo.findActiveByGoogleSubId(
      'sub-persona-b-codigo',
    );
    expect(openAnomaliesB).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codigoCausal: 'COLISION_IDENTIFICADOR',
          efectoAcceso: 'BLOQUEANTE',
        }),
      ]),
    );
  });
});
