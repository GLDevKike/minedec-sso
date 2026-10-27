import request from 'supertest';
import { createInMemoryPipTestHarness } from '../../helpers/in-memory-pip-test-harness';
import { PgCatalogoAtributoRepository } from '../../../src/infrastructure/persistence/pg-catalog.repository';
import { InMemoryRedisCacheClient, SqlQueryExecutor } from '@minedec/shared';

const INTERNAL_HEADERS = {
  'X-Internal-Service-Token': 'dev-internal-pip-token-minedec',
};

const ADMIN_HEADERS = {
  'X-Goog-Authenticated-User-Email': 'accounts.google.com:superadmin@educacion.gob.ec',
  'X-Minedec-Actor-Role': 'SUPERADMIN_SEGURIDAD',
};

describe('T024 - Catálogos Parametrizables Jerárquicos (D-03), Homologación FO-DNTIC-20 y Derivación Académica', () => {
  it('homologa sinónimos de origen FO-DNTIC-20 (sinonimosOrigen), normaliza ZONA de 1 dígito y deriva determinísticamente nivelAcademico (incluyendo EDUCACION_SUPERIOR)', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Alta en caliente en catálogo de SUPERIOR_3 -> EDUCACION_SUPERIOR con sinónimos FO-DNTIC-20
    const upsertGradoSuperior = await request(harness.app)
      .put('/api/v1/admin/catalogs/GRADO_CURSO')
      .set(ADMIN_HEADERS)
      .send({
        codigoValor: 'SUPERIOR_3',
        codigoPadre: null,
        etiquetaVisible: 'Tercer Nivel Tecnológico Superior (Semestre 3)',
        nivelAcademicoDerivado: 'EDUCACION_SUPERIOR',
        sinonimosOrigen: [
          'TERCER NIVEL TECNOLÓGICO SUPERIOR',
          'INSTITUTO SUPERIOR 3ER NIVEL',
        ],
        requiereVigenciaTemporal: false,
        activo: true,
      });

    expect(upsertGradoSuperior.status).toBe(200);
    expect(upsertGradoSuperior.body.codigoValor).toBe('SUPERIOR_3');
    expect(upsertGradoSuperior.body.nivelAcademicoDerivado).toBe('EDUCACION_SUPERIOR');
    expect(harness.catalogRepo.invalidatedCategories).toContain('GRADO_CURSO');

    // 2. Consultar el catálogo vía GET /api/v1/admin/catalogs/GRADO_CURSO
    const getCatalogRes = await request(harness.app)
      .get('/api/v1/admin/catalogs/GRADO_CURSO')
      .set(ADMIN_HEADERS);

    expect(getCatalogRes.status).toBe(200);
    expect(getCatalogRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codigoValor: 'SUPERIOR_3',
          nivelAcademicoDerivado: 'EDUCACION_SUPERIOR',
        }),
      ]),
    );

    // 3. Ingestar perfil con etiquetas crudas FO-DNTIC-20 ("Alumno", "Estudiante Matriculado", "TERCER NIVEL TECNOLÓGICO SUPERIOR", zona "9") y nivelAcademico discrepante ("INICIAL")
    const upsertProfileRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-fo-dntic-20-superior',
        emailPrincipal: 'diego.instituto@estudiante.edu.ec',
        nombreCompleto: 'Diego Alejandro Vaca',
        orgUnitPath: '/Estudiantes/Superior',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          fechaNacimiento: '2001-08-15',
          tipoUsuario: 'Alumno', // Sinónimo -> ESTUDIANTE
          subtipoUsuario: 'Estudiante Matriculado', // Sinónimo -> ESTUDIANTE_REGULAR
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '9/17D05/17D05C01', // Zona 1 dígito -> 09/17D05/17D05C01
          codigoInstitucion: '17H00123',
          gradoCurso: 'TERCER NIVEL TECNOLÓGICO SUPERIOR', // Sinónimo -> SUPERIOR_3
          nivelAcademico: 'INICIAL', // Discrepante -> sobrescrito determinísticamente a EDUCACION_SUPERIOR
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'NO APLICA JORNADA', // Homologado -> NO_APLICA
        },
      });

    expect(upsertProfileRes.status).toBe(200);
    expect(upsertProfileRes.body.estadoPersona).toBe('ACTIVA');
    expect(upsertProfileRes.body.anomaliasAbiertas).toHaveLength(0);

    const savedCuenta = await harness.cuentaRepo.findByGoogleSubId(
      'sub-fo-dntic-20-superior',
    );
    expect(savedCuenta?.tipoUsuario).toBe('ESTUDIANTE');
    expect(savedCuenta?.subtipoUsuario).toBe('ESTUDIANTE_REGULAR');
    expect(savedCuenta?.gradoCurso).toBe('SUPERIOR_3');
    expect(savedCuenta?.nivelAcademicoDerivado).toBe('EDUCACION_SUPERIOR');

    const savedContexts = await harness.contextRepo.findActiveByIdInterno(
      upsertProfileRes.body.idInterno,
    );
    expect(savedContexts[0]?.jornada).toBe('NO_APLICA');
    expect(savedContexts[0]?.codigoZona).toBe('09');
  });

  it('rechaza combinaciones jerárquicas inválidas tipoUsuario -> subtipoUsuario (ej. ESTUDIANTE con LOSEP) y permite recarga en caliente de nuevos subtipos sin redespliegue', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Intentar vincular un ESTUDIANTE con subtipo LOSEP (cuyo codigoPadre es ADMINISTRATIVO)
    const invalidHierarchyRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-jerarquia-invalida',
        emailPrincipal: 'error.jerarquia@estudiante.edu.ec',
        nombreCompleto: 'Estudiante Con Subtipo Administrativo',
        orgUnitPath: '/Estudiantes',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856',
          fechaNacimiento: '2004-03-20',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'LOSEP', // Pertenece a ADMINISTRATIVO (SERVIDOR_PUBLICO)
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          gradoCurso: '3BGU',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(invalidHierarchyRes.status).toBe(200);
    expect(invalidHierarchyRes.body.anomaliasAbiertas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codigoCausal: 'ATRIBUTO_OBLIGATORIO_FALTANTE',
          efectoAcceso: 'RESTRINGIDA',
        }),
      ]),
    );

    // 2. Dar de alta en caliente un nuevo subtipo DOCENTE_INTERCULTURAL_BILINGUE bajo DOCENTE
    const hotAddSubtipoRes = await request(harness.app)
      .put('/api/v1/admin/catalogs/SUBTIPO_USUARIO')
      .set(ADMIN_HEADERS)
      .send({
        codigoValor: 'DOCENTE_INTERCULTURAL_BILINGUE',
        codigoPadre: 'DOCENTE',
        etiquetaVisible: 'Docente de Educación Intercultural Bilingüe (MOSEIB)',
        sinonimosOrigen: ['Docente MOSEIB', 'Maestro Bilingüe'],
        requiereVigenciaTemporal: false,
        activo: true,
      });

    expect(hotAddSubtipoRes.status).toBe(200);

    // Verificar evento de auditoría CATALOGO_ACTUALIZADO
    expect(harness.auditLog.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipoEvento: 'CATALOGO_ACTUALIZADO',
        }),
      ]),
    );

    // 3. Inmediatamente sincronizar un docente con el sinónimo "Docente MOSEIB" sin reiniciar el servicio
    const docenteMoseibRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-docente-moseib',
        emailPrincipal: 'inti.killa@docentes.educacion.gob.ec',
        nombreCompleto: 'Inti Killa Duchicela',
        orgUnitPath: '/Docentes/MOSEIB',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0102030405',
          tipoUsuario: 'DOCENTE',
          subtipoUsuario: 'Docente MOSEIB',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          regimenEscolar: 'SIERRA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
        },
      });

    expect(docenteMoseibRes.status).toBe(200);
    expect(docenteMoseibRes.body.anomaliasAbiertas).toHaveLength(0);
    const savedDocenteCuenta = await harness.cuentaRepo.findByGoogleSubId(
      'sub-docente-moseib',
    );
    expect(savedDocenteCuenta?.subtipoUsuario).toBe('DOCENTE_INTERCULTURAL_BILINGUE');
  });

  it('almacena en caché L2 Redis (minedec:pip:catalogo:v1) con TTL <= 300 s e invalida claves en PgCatalogoAtributoRepository', async () => {
    const redis = new InMemoryRedisCacheClient();
    const mockSql: SqlQueryExecutor = {
      query: async <T>() => ({
        rows: [
          {
            catalogo_id: '770e8400-e29b-41d4-a716-446655440000',
            categoria_atributo: 'GRADO_CURSO',
            codigo_valor: '3BGU',
            codigo_padre: null,
            etiqueta_visible: 'Tercero BGU',
            nivel_academico_derivado: 'BGU',
            metadatos_regla: { sinonimosOrigen: ['Sexto Curso'] },
            requiere_vigencia_temporal: false,
            activo: true,
          } as unknown as T,
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      }),
    };

    const pgCatalogRepo = new PgCatalogoAtributoRepository(mockSql, redis);
    const itemsFirst = await pgCatalogRepo.listByCategory('GRADO_CURSO', true);
    expect(itemsFirst).toHaveLength(1);
    expect(itemsFirst[0]?.sinonimosOrigen).toContain('Sexto Curso');

    // Segunda lectura viene desde Redis L2 con TTL <= 300s
    const ttl = await redis.ttl('minedec:pip:catalogo:v1:GRADO_CURSO:ACTIVE');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);

    const itemsCached = await pgCatalogRepo.listByCategory('GRADO_CURSO', true);
    expect(itemsCached).toHaveLength(1);

    const grouped = await pgCatalogRepo.listAllActiveGrouped();
    expect(grouped.GRADO_CURSO).toHaveLength(1);

    await pgCatalogRepo.upsert(itemsFirst[0]!);
    await pgCatalogRepo.invalidateCatalogCache();
    expect(await redis.get('minedec:pip:catalogo:v1:GRADO_CURSO:ACTIVE')).toBeNull();
  });
});
