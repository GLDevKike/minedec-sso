import request from 'supertest';
import {
  GwsDirectoryUserRecord,
  RedisCacheClient,
  SyncQuotaGovernor,
} from '@minedec/shared';
import {
  createSincronizadorApp,
  EventoSincronizacionGws,
  ICheckpointRepositoryPort,
  IDlqRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  IProcessedEventRepositoryPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
  ISyncTaskDispatcherPort,
} from '../../src';

describe('T023: Integración HTTP Sincronizador Incremental (/internal/v1/sync/events/pubsub, /incremental y /delta-sweep)', () => {
  function setupTestApp() {
    const processedEvents = new Map<string, EventoSincronizacionGws>();
    const sampleUser: GwsDirectoryUserRecord = {
      id: 'sub-docente-200',
      googleSubId: 'sub-docente-200',
      primaryEmail: 'carlos.quito@educacion.gob.ec',
      emailPrincipal: 'carlos.quito@educacion.gob.ec',
      givenName: 'Carlos',
      familyName: 'Quito',
      name: { fullName: 'Carlos Quito' },
      nombreCompleto: 'Carlos Quito',
      orgUnitPath: '/Docentes',
      suspended: false,
      suspendedEnGws: false,
      deletedEnGws: false,
      archived: false,
      customSchemas: {
        MINEDEC_Perfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
          codigoInstitucion: '17H00123',
        },
      },
    };

    const gwsPort: IGoogleDirectoryReadOnlyPort = {
      getUserReadOnly: jest.fn().mockResolvedValue(sampleUser),
      listUsersReadOnly: jest.fn().mockResolvedValue({
        users: [sampleUser],
        nextPageToken: undefined,
      }),
    };

    const syncIdentityRepo: ISyncIdentityRepositoryPort = {
      isDomainActive: jest.fn(async (dom) =>
        ['educacion.gob.ec', 'estudiantes.educacion.gob.ec'].includes(dom),
      ),
      listActiveDomains: jest
        .fn()
        .mockResolvedValue(['educacion.gob.ec', 'estudiantes.educacion.gob.ec']),
      findAccountSyncMetadata: jest.fn().mockResolvedValue(null),
      countActiveAccountsForPerson: jest.fn().mockResolvedValue(0),
      upsertSyncedIdentity: jest.fn().mockResolvedValue({
        outcome: 'APLICADO',
        idInternoPersona: 'b6a6c7b4-8b20-4895-9f9a-111122223333',
        cuentaId: 'c7a6c7b4-8b20-4895-9f9a-444455556666',
        googleSubId: 'sub-docente-200',
        emailPrincipal: 'carlos.quito@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        estadoPersona: 'ACTIVA',
        estadoCuenta: 'SINCRONIZADA',
        otherActiveAccountsCount: 0,
        requiresCacheInvalidation: true,
        anomaliasGeneradasIds: [],
      }),
      applyAccountLifecycleChange: jest.fn(),
      deactivatePersonCascade: jest.fn(),
      reconcileOrMergeHotIdentity: jest.fn(),
    };

    const processedEventRepo: IProcessedEventRepositoryPort = {
      findByIdEventoExterno: jest.fn(
        async (id) => processedEvents.get(id) ?? null,
      ),
      findLatestTimestampForUser: jest.fn().mockResolvedValue(null),
      recordProcessedEvent: jest.fn(async (ev) => {
        const existing = processedEvents.get(ev.idEventoExterno);
        if (existing) {
          return { inserted: false, record: existing };
        }
        processedEvents.set(ev.idEventoExterno, ev);
        return { inserted: true, record: ev };
      }),
    };

    const checkpointRepo: ICheckpointRepositoryPort = {
      findByPartition: jest.fn().mockResolvedValue(null),
      listCheckpoints: jest.fn().mockResolvedValue([]),
      upsertCheckpoint: jest.fn(async (cp) => cp),
    };

    const dlqRepo: IDlqRepositoryPort = {
      findById: jest.fn().mockResolvedValue(null),
      findByExternalEventId: jest.fn().mockResolvedValue(null),
      upsertDlqFailure: jest.fn(async (r) => r),
      listDlqRecords: jest.fn().mockResolvedValue({ items: [], totalPendientes: 0 }),
      countPendingDlq: jest.fn().mockResolvedValue(0),
    };

    const cacheInvalidator: ISyncCacheInvalidatorPort = {
      invalidateAccountScope: jest.fn().mockResolvedValue({
        invalidatedKeysCount: 4,
        pubSubPublished: true,
      }),
      invalidatePersonCascadeScope: jest.fn().mockResolvedValue({
        invalidatedKeysCount: 4,
        pubSubPublished: true,
      }),
    };

    const taskDispatcher: ISyncTaskDispatcherPort = {
      enqueuePriorityHotRegistration: jest.fn().mockResolvedValue({
        taskId: 'task-hot-1',
        queueName: 'sync-hot-registration-priority',
      }),
      enqueueIncrementalSync: jest.fn().mockResolvedValue({
        taskId: 'task-inc-1',
        queueName: 'sync-incremental-standard',
      }),
    };

    const redisClient = new RedisCacheClient();
    const quotaGovernor = new SyncQuotaGovernor(redisClient);

    const app = createSincronizadorApp({
      gwsPort,
      syncIdentityRepo,
      processedEventRepo,
      checkpointRepo,
      dlqRepo,
      cacheInvalidator,
      taskDispatcher,
      redisClient,
      quotaGovernor,
    });

    return { app, taskDispatcher, gwsPort };
  }

  it('POST /internal/v1/sync/events/pubsub recibe push OIDC de Pub/Sub y encola en Cloud Tasks', async () => {
    const { app, taskDispatcher } = setupTestApp();
    const rawEvent = {
      idEventoExterno: 'gws-audit-evt-501',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'sub-docente-200',
      emailPrincipal: 'carlos.quito@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      timestampEventoGws: '2026-10-20T12:00:00.000Z',
    };

    const response = await request(app)
      .post('/internal/v1/sync/events/pubsub')
      .set('Authorization', 'Bearer oidc-token-pubsub-invoker')
      .send({
        message: {
          messageId: 'pubsub-msg-501',
          publishTime: '2026-10-20T12:00:01.000Z',
          data: Buffer.from(JSON.stringify(rawEvent)).toString('base64'),
        },
        subscription: 'projects/minedec-sso/subscriptions/gws-directory-events-sub',
      });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('ENQUEUED');
    expect(taskDispatcher.enqueueIncrementalSync).toHaveBeenCalledTimes(1);
  });

  it('POST /internal/v1/sync/incremental ejecuta sincronización con conmutación a LOTE_LIST_500 cuando cola > 250', async () => {
    const { app, gwsPort } = setupTestApp();

    const response = await request(app)
      .post('/internal/v1/sync/incremental')
      .set('Authorization', 'Bearer oidc-token-tasks-invoker')
      .send({
        idEventoExterno: 'gws-audit-evt-502',
        tipoEvento: 'CHANGE_USER',
        googleSubId: 'sub-docente-200',
        emailPrincipal: 'carlos.quito@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        orgUnitPath: '/Docentes',
        timestampEventoGws: '2026-10-20T12:05:00.000Z',
        colaPendientesAlDespachar: 300,
        antiguedadMensajeMasViejoSegundos: 35,
      });

    expect(response.status).toBe(200);
    expect(response.body.resultado).toBe('APLICADO');
    expect(response.body.modoDespacho).toBe('LOTE_LIST_500');
    expect(response.body.cacheInvalidated).toBe(true);
    expect(gwsPort.listUsersReadOnly).toHaveBeenCalledTimes(1);
  });

  it('POST /internal/v1/sync/delta-sweep ejecuta barrido delta sobre los dominios activos en dominio_institucional', async () => {
    const { app } = setupTestApp();

    const response = await request(app)
      .post('/internal/v1/sync/delta-sweep')
      .set('Authorization', 'Bearer oidc-token-scheduler-invoker')
      .send({
        ventanaMinutos: 5,
      });

    expect(response.status).toBe(200);
    expect(response.body.dominiosEvaluados).toEqual([
      'educacion.gob.ec',
      'estudiantes.educacion.gob.ec',
    ]);
    expect(response.body.cuentasInspeccionadas).toBeGreaterThanOrEqual(2);
  });
});
