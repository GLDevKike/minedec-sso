import request from 'supertest';
import { createInMemoryPipTestHarness } from '../../helpers/in-memory-pip-test-harness';

const INTERNAL_HEADERS = {
  'X-Internal-Service-Token': 'dev-internal-pip-token-minedec',
};

describe('T035 - Registro en Caliente (REGISTRO_CALIENTE / JIT Provisional) y Promoción Asíncrona (FR-009 / US4)', () => {
  it('crea un registro provisional TEMP-<sub_id> en < 50 ms con 0 llamadas a Google Workspace, infiere tipoUsuario por subdominio y promueve in-place cuando llega el perfil MINEDEC_Perfil', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Login de cuenta recién creada en @docentes.educacion.gob.ec que aún no fue sincronizada
    const resolveRes = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: '108877665544332211000',
        emailPrincipal: 'nuevo.docente@docentes.educacion.gob.ec',
        nombreCompleto: 'Luis Fernando Cárdenas',
      });

    expect(resolveRes.status).toBe(202);
    expect(resolveRes.body.estadoPersona).toBe('PENDIENTE_IDENTIFICACION');
    expect(resolveRes.body.nivelAccesoEfectivo).toBe('RESTRINGIDA_SOLO_AUTENTICADA');
    expect(resolveRes.body.tipoIdentificacion).toBe('CODIGO_MINEDEC');
    expect(resolveRes.body.numeroIdentificacion).toBe('TEMP-108877665544332211000');
    expect(resolveRes.body.cuentaActiva.estadoSincronizacion).toBe('REGISTRO_CALIENTE');
    expect(resolveRes.body.cuentaActiva.tipoUsuario).toBe('DOCENTE');
    expect(resolveRes.body.prioritySyncQueued).toBe(true);

    const provisionalIdInterno: string = resolveRes.body.idInterno;

    // Verificar que se encoló una tarea prioritaria en Cloud Tasks y se auditó REGISTRO_CALIENTE_CREADO
    const queuedTasks = harness.prioritySyncQueue.getRecordedTasks();
    expect(queuedTasks).toHaveLength(1);
    expect(queuedTasks[0]?.payload.googleSubId).toBe('108877665544332211000');
    expect(queuedTasks[0]?.payload.provisionalIdInterno).toBe(provisionalIdInterno);

    expect(harness.auditLog.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipoEvento: 'REGISTRO_CALIENTE_PROVISIONAL',
          entidadId: provisionalIdInterno,
        }),
      ]),
    );

    // 2. El Sincronizador procesa la tarea prioritaria y envía PUT /internal/v1/pip/identities/upsert con CEDULA real
    const promoteRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: '108877665544332211000',
        emailPrincipal: 'nuevo.docente@docentes.educacion.gob.ec',
        nombreCompleto: 'Luis Fernando Cárdenas',
        orgUnitPath: '/Docentes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'REGISTRO_CALIENTE_PRIORITARIO',
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

    expect(promoteRes.status).toBe(200);
    // Promoción in-place preserva el mismo idInterno y limpia TEMP-<sub_id> sin dejarlo como codigoMinedecAnterior
    expect(promoteRes.body.idInterno).toBe(provisionalIdInterno);
    expect(promoteRes.body.estadoPersona).toBe('ACTIVA');
    expect(promoteRes.body.estadoSincronizacion).toBe('SINCRONIZADA');

    const promotedPersona = await harness.personaRepo.findByIdInterno(provisionalIdInterno);
    expect(promotedPersona?.tipoIdentificacion).toBe('CEDULA');
    expect(promotedPersona?.numeroIdentificacion).toBe('1710034065');
    expect(promotedPersona?.codigoMinedecAnterior).toBeNull();

    // 3. Nueva resolución desde el PDP ahora devuelve 200 OK con nivelAccesoEfectivo COMPLETO
    const resolveAfterPromotion = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: '108877665544332211000',
        emailPrincipal: 'nuevo.docente@docentes.educacion.gob.ec',
        nombreCompleto: 'Luis Fernando Cárdenas',
      });

    expect(resolveAfterPromotion.status).toBe(200);
    expect(resolveAfterPromotion.body.idInterno).toBe(provisionalIdInterno);
    expect(resolveAfterPromotion.body.estadoPersona).toBe('ACTIVA');
    expect(resolveAfterPromotion.body.nivelAccesoEfectivo).toBe('COMPLETO');
    expect(resolveAfterPromotion.body.prioritySyncQueued).toBe(false);
  });

  it('re-vincula (re-link) una cuenta provisional REGISTRO_CALIENTE hacia una PersonaIdentidad existente si la CEDULA ya existía bajo otra cuenta institucional', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Persona ya existente con cuenta administrativa (@educacion.gob.ec) y CEDULA 0926687856
    const existingAdminRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-admin-existente-0926687856',
        emailPrincipal: 'paola.vera@educacion.gob.ec',
        nombreCompleto: 'Paola Andrea Vera',
        orgUnitPath: '/Administrativos/PlantaCentral',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856',
          tipoUsuario: 'ADMINISTRATIVO',
          subtipoUsuario: 'SERVIDOR_PUBLICO',
          nivelEstructura: 'PLANTA_CENTRAL',
          viceministerio: 'EDUCACION',
          codigoDependenciaAdmin: 'DNTIC-01',
        },
      });
    expect(existingAdminRes.status).toBe(200);
    const canonicalIdInterno: string = existingAdminRes.body.idInterno;

    // 2. La misma persona inicia sesión por primera vez con su nueva cuenta de estudiante (@estudiante.edu.ec) antes de sincronizarse
    const hotStudentRes = await request(harness.app)
      .post('/internal/v1/pip/identities/resolve')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-estudiante-jit-0926687856',
        emailPrincipal: 'paola.vera@estudiante.edu.ec',
        nombreCompleto: 'Paola Andrea Vera',
      });

    expect(hotStudentRes.status).toBe(202);
    expect(hotStudentRes.body.cuentaActiva.tipoUsuario).toBe('ESTUDIANTE');
    const provisionalStudentIdInterno: string = hotStudentRes.body.idInterno;
    expect(provisionalStudentIdInterno).not.toBe(canonicalIdInterno);

    // 3. Llega la sincronización prioritaria revelando que sub-estudiante-jit-0926687856 tiene la CEDULA 0926687856
    const unifyRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-estudiante-jit-0926687856',
        emailPrincipal: 'paola.vera@estudiante.edu.ec',
        nombreCompleto: 'Paola Andrea Vera',
        orgUnitPath: '/Estudiantes/Superior',
        suspendedEnGws: false,
        origenSincronizacion: 'REGISTRO_CALIENTE_PRIORITARIO',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856',
          fechaNacimiento: '1995-11-20',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'ESTUDIANTE_REGULAR',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          gradoCurso: '3BGU',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'NOCTURNA',
        },
      });

    expect(unifyRes.status).toBe(200);
    expect(unifyRes.body.idInterno).toBe(canonicalIdInterno);

    const accounts = await harness.cuentaRepo.findAllByIdInterno(canonicalIdInterno);
    expect(accounts).toHaveLength(2);
  });
});
