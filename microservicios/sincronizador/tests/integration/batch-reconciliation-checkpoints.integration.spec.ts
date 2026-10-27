import request from 'supertest';
import { InMemoryRateGovernorStore, SyncQuotaGovernor } from '@minedec/shared';
import {
  CheckpointConciliacion,
  createSincronizadorHttpApp,
  ICheckpointRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  ISyncIdentityRepositoryPort,
} from '../../src';

describe('T046 - Integración de Conciliación Masiva con Reanudación Exacta desde next_page_token y Endpoints Admin', () => {
  it('simula caída en página 2, detecta partición huérfana en GET /api/v1/admin/sync/checkpoints y reanuda exactamente en página 3 con POST /api/v1/admin/sync/partitions/trigger', async () => {
    const checkpointStore = new Map<string, CheckpointConciliacion>();
    const partitionKey = 'educacion.gob.ec::/Docentes::CARGA_INICIAL';

    // Estado persistido tras procesar páginas 1 y 2 antes de caída del contenedor (> 15 min)
    checkpointStore.set(partitionKey, {
      checkpointId: '77777777-8888-4999-8000-111111111111',
      dominio: 'educacion.gob.ec',
      orgUnitPath: '/Docentes',
      tipoProceso: 'CARGA_INICIAL',
      nextPageToken: 'token-pagina-3',
      cuentasProcesadas: 1000,
      cuentasActualizadas: 950,
      cuentasOmitidasHash: 50,
      cuentasBajaDetectadas: 0,
      anomaliasAbiertas: 0,
      estadoEjecucion: 'EN_PROGRESO',
      workerInstanciaId: 'crashed-worker-01',
      lockAdvisoryKey: '1122334455',
      heartbeatEn: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      iniciadoEn: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
      completadoEn: null,
      ultimoErrorCodigo: null,
      diagnosticoOperativo: null,
      esParticionHuerfana: true,
    });

    const checkpointRepo: ICheckpointRepositoryPort = {
      findByPartition: jest.fn().mockImplementation(async (dom, ou, tipo) => {
        return checkpointStore.get(`${dom}::${ou}::${tipo}`) ?? null;
      }),
      listCheckpoints: jest.fn().mockImplementation(async () => {
        return Array.from(checkpointStore.values());
      }),
      upsertCheckpoint: jest.fn().mockImplementation(async (cp) => {
        const key = `${cp.dominio}::${cp.orgUnitPath}::${cp.tipoProceso}`;
        checkpointStore.set(key, cp);
        return cp;
      }),
    };

    const requestedPageTokens: Array<string | undefined> = [];
    const gwsPort: IGoogleDirectoryReadOnlyPort = {
      getUserReadOnly: jest.fn(),
      listUsersReadOnly: jest.fn().mockImplementation(async (params) => {
        requestedPageTokens.push(params.pageToken);
        return {
          users: [
            {
              id: 'sub-page3-001',
              googleSubId: 'sub-page3-001',
              primaryEmail: 'docente.pag3@educacion.gob.ec',
              name: {
                givenName: 'Pedro',
                familyName: 'Quito',
                fullName: 'Pedro Quito',
              },
              suspended: false,
              archived: false,
              orgUnitPath: '/Docentes',
            },
          ],
          nextPageToken: undefined,
        };
      }),
    };

    const syncIdentityRepo: Partial<ISyncIdentityRepositoryPort> = {
      isDomainActive: jest.fn().mockResolvedValue(true),
      findAccountSyncMetadata: jest.fn().mockResolvedValue(null),
      upsertSyncedIdentity: jest.fn().mockResolvedValue({
        outcome: 'CREADA',
        idInternoPersona: '88888888-9999-4000-8111-222222222222',
        cuentaId: '99999999-0000-4111-8222-333333333333',
        googleSubId: 'sub-page3-001',
        emailPrincipal: 'docente.pag3@educacion.gob.ec',
        estadoPersona: 'ACTIVA',
        estadoCuenta: 'ACTIVA',
        estadoSincronizacion: 'SINCRONIZADA',
        cacheShouldInvalidate: true,
      }),
    };

    const app = createSincronizadorHttpApp({
      quotaGovernor: new SyncQuotaGovernor(new InMemoryRateGovernorStore()),
      checkpointRepo,
      gwsDirectoryPort: gwsPort,
      syncIdentityRepo: syncIdentityRepo as ISyncIdentityRepositoryPort,
    });

    // 1. Verificar detección de partición huérfana en GET /api/v1/admin/sync/checkpoints
    const listRes = await request(app)
      .get('/api/v1/admin/sync/checkpoints')
      .query({ dominio: 'educacion.gob.ec' });

    expect(listRes.status).toBe(200);
    expect(listRes.body.totalParticiones).toBe(1);
    expect(listRes.body.particionesHuerfanasDetectadas).toBe(1);
    expect(listRes.body.items[0].esParticionHuerfana).toBe(true);
    expect(listRes.body.items[0].nextPageToken).toBe('token-pagina-3');

    // 2. Disparar recuperación en POST /api/v1/admin/sync/partitions/trigger
    const triggerRes = await request(app)
      .post('/api/v1/admin/sync/partitions/trigger')
      .send({
        dominio: 'educacion.gob.ec',
        orgUnitPath: '/Docentes',
        tipoProceso: 'CARGA_INICIAL',
      });

    expect(triggerRes.status).toBe(200);
    expect(triggerRes.body.reclamoParticionHuerfana).toBe(true);
    expect(triggerRes.body.tokenReanudadoDesde).toBe('token-pagina-3');
    expect(triggerRes.body.paginasProcesadasEnCiclo).toBe(1);
    expect(triggerRes.body.checkpoint.estadoEjecucion).toBe('COMPLETADO');
    expect(triggerRes.body.checkpoint.cuentasProcesadas).toBe(1001);
    expect(requestedPageTokens).toEqual(['token-pagina-3']);
  });
});
