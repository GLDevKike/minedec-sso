import request from 'supertest';
import { createInMemoryPipTestHarness } from '../../helpers/in-memory-pip-test-harness';
import {
  PgCatalogoTerritorioSedeRepository,
  PgCuentaInstitucionalRepository,
  PgDominioInstitucionalRepository,
  PgPersonaIdentidadRepository,
} from '../../../src/infrastructure/persistence/pg-identity.repository';
import { SqlQueryExecutor } from '@minedec/shared';

const INTERNAL_HEADERS = {
  'X-Internal-Service-Token': 'dev-internal-pip-token-minedec',
};

const ADMIN_HEADERS = {
  'X-Goog-Authenticated-User-Email': 'accounts.google.com:superadmin@educacion.gob.ec',
  'X-Minedec-Actor-Role': 'SUPERADMIN_SEGURIDAD',
};

describe('T016 - Unificación Multi-Subdominio en Tenant Único GWS, Personas Naturales y 3FN', () => {
  it('unifica múltiples cuentas (@docentes.educacion.gob.ec y @educacion.gob.ec) bajo un único idInterno preservando ceros iniciales (01..09) y el tenant C01MINEDEC01', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Primera cuenta en subdominio DOCENTE (@docentes.educacion.gob.ec) con cédula de Azuay (0102030405) y sin idInterno en origen
    const docenteRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: '109988776655443322110',
        emailPrincipal: 'maria.loja@docentes.educacion.gob.ec',
        givenName: 'María',
        familyName: 'Loja',
        nombreCompleto: 'María Fernanda Loja',
        orgUnitPath: '/Docentes/Zona9/17D05',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0102030405',
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

    expect(docenteRes.status).toBe(200);
    expect(docenteRes.body.idInterno).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(docenteRes.body.estadoPersona).toBe('ACTIVA');
    expect(docenteRes.body.anomaliasAbiertas).toHaveLength(0);

    const unifiedIdInterno: string = docenteRes.body.idInterno;

    // 2. Segunda cuenta de la misma persona natural en el dominio ADMINISTRATIVO (@educacion.gob.ec)
    const adminRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: '109988776655443322999',
        emailPrincipal: 'maria.loja@educacion.gob.ec',
        givenName: 'María',
        familyName: 'Loja',
        nombreCompleto: 'María Fernanda Loja',
        orgUnitPath: '/Administrativos/PlantaCentral',
        suspendedEnGws: false,
        origenSincronizacion: 'BARRIDO_DELTA_2MIN',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0102030405',
          tipoUsuario: 'ADMINISTRATIVO',
          subtipoUsuario: 'SERVIDOR_PUBLICO',
          nivelEstructura: 'PLANTA_CENTRAL',
          viceministerio: 'EDUCACION',
          codigoDependenciaAdmin: 'DNTIC-01',
        },
      });

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.idInterno).toBe(unifiedIdInterno);
    expect(adminRes.body.cuentaId).not.toBe(docenteRes.body.cuentaId);

    // 3. Consultar la vista administrativa unificada y verificar las 2 cuentas en el mismo tenant C01MINEDEC01 y el cero inicial intacto
    const queryRes = await request(harness.app)
      .get('/api/v1/admin/identities/0102030405')
      .set(ADMIN_HEADERS);

    expect(queryRes.status).toBe(200);
    expect(queryRes.body.idInterno).toBe(unifiedIdInterno);
    expect(queryRes.body.tipoIdentificacion).toBe('CEDULA');
    expect(queryRes.body.numeroIdentificacion).toBe('0102030405');
    expect(queryRes.body.cuentasInstitucionales).toHaveLength(2);

    const domains = queryRes.body.cuentasInstitucionales.map(
      (c: { dominio: string }) => c.dominio,
    );
    expect(domains).toEqual(
      expect.arrayContaining(['docentes.educacion.gob.ec', 'educacion.gob.ec']),
    );
    for (const cuenta of await harness.cuentaRepo.findAllByIdInterno(unifiedIdInterno)) {
      const domainMeta = await harness.dominioRepo.findByDomain(cuenta.dominio);
      expect(domainMeta?.googleCustomerId).toBe('C01MINEDEC01');
    }
  });

  it('normaliza un RUC de persona natural de 13 dígitos (0926687856001) a su CEDULA de 10 dígitos (0926687856) y rechaza RUCs societarios (tercer dígito 6 o 9)', async () => {
    const harness = createInMemoryPipTestHarness();

    // 1. Contratista (persona natural) llega con RUC de 13 dígitos 0926687856001 -> debe normalizarse a CEDULA 0926687856
    const naturalRucRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-contratista-0926687856',
        emailPrincipal: 'carlos.contratista@educacion.gob.ec',
        nombreCompleto: 'Carlos Pérez Contratista',
        orgUnitPath: '/Administrativos/Contratistas',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '0926687856001',
          tipoUsuario: 'ADMINISTRATIVO',
          subtipoUsuario: 'CONTRATISTA',
          nivelEstructura: 'PLANTA_CENTRAL',
          viceministerio: 'GESTION_EDUCATIVA',
          codigoDependenciaAdmin: 'CGPGE-02',
          fechaInicioVigencia: '2026-01-01',
          fechaFinVigencia: '2027-12-31',
        },
      });

    expect(naturalRucRes.status).toBe(200);
    expect(naturalRucRes.body.estadoPersona).toBe('ACTIVA');
    const savedPersona = await harness.personaRepo.findByIdInterno(
      naturalRucRes.body.idInterno,
    );
    expect(savedPersona?.tipoIdentificacion).toBe('CEDULA');
    expect(savedPersona?.numeroIdentificacion).toBe('0926687856');

    // 2. RUC jurídico / societario (1790016919001) debe ser rechazado con anomalía BLOQUEANTE SIN_IDENTIFICACION_VALIDA
    const legalEntityRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-juridico-prohibido',
        emailPrincipal: 'empresa.externa@educacion.gob.ec',
        nombreCompleto: 'Cuenta Societaria No Permitida',
        orgUnitPath: '/Externos',
        suspendedEnGws: false,
        origenSincronizacion: 'CONCILIACION_BATCH',
        minedecPerfil: {
          tipoIdentificacion: 'RUC',
          numeroIdentificacion: '1790016919001',
          tipoUsuario: 'EXTERNO',
          subtipoUsuario: 'PROVEEDOR',
          nivelEstructura: 'PLANTA_CENTRAL',
          fechaInicioVigencia: '2026-01-01',
          fechaFinVigencia: '2026-12-31',
        },
      });

    expect(legalEntityRes.status).toBe(200);
    expect(legalEntityRes.body.anomaliasAbiertas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
          efectoAcceso: 'BLOQUEANTE',
        }),
      ]),
    );
  });

  it('vincula en 3FN establecimientos de catalogo_territorio_sede incluyendo sedes FO-DNTIC-20 con distrito y circuito anulables', async () => {
    const harness = createInMemoryPipTestHarness();

    const specialSedeRes = await request(harness.app)
      .put('/internal/v1/pip/identities/upsert')
      .set(INTERNAL_HEADERS)
      .send({
        googleSubId: 'sub-estudiante-zona90',
        emailPrincipal: 'ana.estudiante@estudiante.edu.ec',
        nombreCompleto: 'Ana Lucía Zambrano',
        orgUnitPath: '/Estudiantes/Zona90',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          fechaNacimiento: '2005-04-10',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'ESTUDIANTE_REGULAR',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '90',
          codigoInstitucion: '90H00001',
          gradoCurso: '3BGU',
          nivelAcademico: 'BGU',
          regimenEscolar: 'NO_APLICA',
          modalidadEducativa: 'A_DISTANCIA',
          jornada: 'NO_APLICA',
        },
      });

    expect(specialSedeRes.status).toBe(200);
    expect(specialSedeRes.body.estadoPersona).toBe('ACTIVA');
    expect(specialSedeRes.body.anomaliasAbiertas).toHaveLength(0);

    const contexts = await harness.contextRepo.findActiveByIdInterno(
      specialSedeRes.body.idInterno,
    );
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.codigoAmie).toBe('90H00001');
    expect(contexts[0]?.codigoDistrito).toBeNull();
    expect(contexts[0]?.codigoCircuito).toBeNull();
  });

  it('ejecuta consultas parametrizadas ($1, $2) en los repositorios PostgreSQL de identidad, cuentas, dominios y sedes', async () => {
    const executedQueries: Array<{ text: string; values?: readonly unknown[] }> = [];
    const mockSql: SqlQueryExecutor = {
      query: async <T>(text: string, values?: readonly unknown[]) => {
        executedQueries.push({ text, values });
        if (
          text.includes('FROM persona_identidad') ||
          text.includes('INTO persona_identidad') ||
          text.includes('UPDATE persona_identidad')
        ) {
          return {
            rows: [
              {
                id_interno: '550e8400-e29b-41d4-a716-446655440000',
                tipo_identificacion: 'CEDULA',
                numero_identificacion: '0102030405',
                codigo_minedec_anterior: null,
                nombre_completo: 'María Fernanda Loja',
                fecha_nacimiento: '1988-05-12',
                representante_legal_cedula: null,
                estado_persona: 'ACTIVA',
                creado_en: '2026-10-18T10:00:00.000Z',
                actualizado_en: '2026-10-18T10:00:00.000Z',
              } as unknown as T,
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('FROM cuenta_institucional') || text.includes('INTO cuenta_institucional')) {
          return {
            rows: [
              {
                cuenta_id: '660e8400-e29b-41d4-a716-446655440001',
                id_interno: '550e8400-e29b-41d4-a716-446655440000',
                google_sub_id: '109988776655443322110',
                email_principal: 'maria.loja@docentes.educacion.gob.ec',
                dominio: 'docentes.educacion.gob.ec',
                org_unit_path: '/Docentes',
                given_name: 'María',
                family_name: 'Loja',
                tipo_usuario: 'DOCENTE',
                subtipo_usuario: 'DOCENTE_NOMBRAMIENTO',
                cargo_funcion: 'DOCENTE_AULA',
                grado_curso: null,
                nivel_academico_derivado: null,
                docente_multisede: true,
                fecha_inicio_vigencia: null,
                fecha_fin_vigencia: null,
                suspended_en_gws: false,
                estado_sincronizacion: 'SINCRONIZADA',
                origen_ultima_sincronizacion: 'EVENTO_AUDIT_LOG',
                ultima_sincronizacion_en: '2026-10-18T10:00:00.000Z',
                creado_en: '2026-10-18T10:00:00.000Z',
                actualizado_en: '2026-10-18T10:00:00.000Z',
              } as unknown as T,
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('FROM dominio_institucional') || text.includes('INTO dominio_institucional')) {
          return {
            rows: [
              {
                dominio: 'docentes.educacion.gob.ec',
                google_customer_id: 'C01MINEDEC01',
                tipo_poblacion: 'DOCENTE',
                es_subdominio: true,
                activo: true,
              } as unknown as T,
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        return {
          rows: [
            {
              codigo_amie: '17H00123',
              nombre_institucion: 'UE MEJIA',
              codigo_zona: '09',
              codigo_distrito: '17D05',
              codigo_circuito: '17D05C01',
              provincia_dpa: '17',
              canton_dpa: '1701',
              parroquia_dpa: '170150',
              regimen_escolar: 'SIERRA_AMAZONIA',
              sostenimiento: 'FISCAL',
              modalidad_educativa: 'PRESENCIAL',
              jornada: 'MATUTINA',
              activo: true,
            } as unknown as T,
          ],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      },
    };

    const pgPersonaRepo = new PgPersonaIdentidadRepository(mockSql);
    const pgCuentaRepo = new PgCuentaInstitucionalRepository(mockSql);
    const pgDominioRepo = new PgDominioInstitucionalRepository(mockSql);
    const pgSedeRepo = new PgCatalogoTerritorioSedeRepository(mockSql);

    const persona = await pgPersonaRepo.findByDocument('CEDULA', '0102030405');
    expect(persona?.numeroIdentificacion).toBe('0102030405');
    await pgPersonaRepo.findByIdInterno('550e8400-e29b-41d4-a716-446655440000');
    await pgPersonaRepo.findByNumeroIdentificacionOnly('0102030405');
    if (persona) {
      await pgPersonaRepo.upsert(persona);
      await pgPersonaRepo.updateEstadoPersona(persona.idInterno, 'INACTIVA');
    }

    const cuenta = await pgCuentaRepo.findByGoogleSubId('109988776655443322110');
    expect(cuenta?.dominio).toBe('docentes.educacion.gob.ec');
    await pgCuentaRepo.findByCuentaId('660e8400-e29b-41d4-a716-446655440001');
    await pgCuentaRepo.findByEmailPrincipal('maria.loja@docentes.educacion.gob.ec');
    await pgCuentaRepo.findAllByIdInterno('550e8400-e29b-41d4-a716-446655440000');
    if (cuenta) {
      await pgCuentaRepo.upsert(cuenta);
    }

    const dom = await pgDominioRepo.findByDomain('docentes.educacion.gob.ec');
    expect(dom?.tipoPoblacion).toBe('DOCENTE');
    expect(dom?.googleCustomerId).toBe('C01MINEDEC01');
    if (dom) {
      await pgDominioRepo.upsert(dom);
    }

    const sede = await pgSedeRepo.findByCodigoAmie('17H00123');
    expect(sede?.codigoAmie).toBe('17H00123');
    if (sede) {
      await pgSedeRepo.upsert(sede);
    }

    expect(executedQueries.length).toBeGreaterThanOrEqual(11);
    for (const q of executedQueries) {
      if (q.values && q.values.length > 0) {
        expect(q.text).toContain('$1');
      }
    }
  });
});
