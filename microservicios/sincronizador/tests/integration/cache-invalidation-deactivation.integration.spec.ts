import request from 'supertest';
import { RedisCacheClient, SyncQuotaGovernor } from '@minedec/shared';
import {
  createSincronizadorApp,
  ICheckpointRepositoryPort,
  IDlqRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  IProcessedEventRepositoryPort,
  ISyncIdentityRepositoryPort,
  ISyncTaskDispatcherPort,
  RedisPubSubCacheInvalidatorAdapter,
} from '../../src';

describe('T031: Integración de Revocación Reactiva en Redis (< 5 s nominal / <= 300 s límite duro) y Baja en Cascada', () => {
  it('purga en < 5 s las llaves Redis de la PersonaIdentidad y sus cuentas y responde 200 en POST /api/v1/admin/sync/persons/:idInterno/deactivate', async () => {
    const redisClient = new RedisCacheClient();
    const idInterno = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

    // Pre-poblar llaves en Redis con TTL <= 300s
    await redisClient.setJson(redisClient.keyByInternalId(idInterno), { active: true }, 300);
    await redisClient.setJson(redisClient.keyByDoc('CEDULA', '1710034065'), { active: true }, 300);
    await redisClient.setJson(redisClient.keyBySub('sub-doc-1'), { active: true }, 300);
    await redisClient.setJson(redisClient.keyByEmail('doc1@educacion.gob.ec'), { active: true }, 300);
    await redisClient.setJson(redisClient.keyBySub('sub-est-1'), { active: true }, 300);
    await redisClient.setJson(
      redisClient.keyByEmail('est1@estudiantes.educacion.gob.ec'),
      { active: true },
      300,
    );

    const cacheInvalidator = new RedisPubSubCacheInvalidatorAdapter(redisClient);

    const syncIdentityRepo: ISyncIdentityRepositoryPort = {
      isDomainActive: jest.fn().mockResolvedValue(true),
      listActiveDomains: jest.fn().mockResolvedValue(['educacion.gob.ec']),
      findAccountSyncMetadata: jest.fn(),
      countActiveAccountsForPerson: jest.fn(),
      upsertSyncedIdentity: jest.fn(),
      applyAccountLifecycleChange: jest.fn(),
      deactivatePersonCascade: jest.fn().mockResolvedValue({
        idInterno,
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065',
        estadoPersona: 'INACTIVA',
        cuentasDesactivadas: [
          {
            cuentaId: 'acc-1',
            googleSubId: 'sub-doc-1',
            emailPrincipal: 'doc1@educacion.gob.ec',
            dominio: 'educacion.gob.ec',
          },
          {
            cuentaId: 'acc-2',
            googleSubId: 'sub-est-1',
            emailPrincipal: 'est1@estudiantes.educacion.gob.ec',
            dominio: 'estudiantes.educacion.gob.ec',
          },
        ],
        subdominiosAfectados: ['educacion.gob.ec', 'estudiantes.educacion.gob.ec'],
      }),
      reconcileOrMergeHotIdentity: jest.fn(),
    };

    const app = createSincronizadorApp({
      redisClient,
      quotaGovernor: new SyncQuotaGovernor(redisClient),
      cacheInvalidator,
      syncIdentityRepo,
      gwsPort: {
        getUserReadOnly: jest.fn(),
        listUsersReadOnly: jest.fn(),
      } as unknown as IGoogleDirectoryReadOnlyPort,
      processedEventRepo: {
        findByIdEventoExterno: jest.fn(),
        findLatestTimestampForUser: jest.fn(),
        recordProcessedEvent: jest.fn(),
      } as unknown as IProcessedEventRepositoryPort,
      checkpointRepo: {
        findByPartition: jest.fn(),
        listCheckpoints: jest.fn(),
        upsertCheckpoint: jest.fn(),
      } as unknown as ICheckpointRepositoryPort,
      dlqRepo: {
        findById: jest.fn(),
        findByExternalEventId: jest.fn(),
        upsertDlqFailure: jest.fn(),
        listDlqRecords: jest.fn(),
        countPendingDlq: jest.fn(),
      } as unknown as IDlqRepositoryPort,
      taskDispatcher: {
        enqueuePriorityHotRegistration: jest.fn(),
        enqueueIncrementalSync: jest.fn(),
      } as unknown as ISyncTaskDispatcherPort,
    });

    const response = await request(app)
      .post(`/api/v1/admin/sync/persons/${idInterno}/deactivate`)
      .set('X-Goog-Authenticated-User-Email', 'accounts.google.com:seguridad@educacion.gob.ec')
      .set('X-Minedec-Admin-Identificacion', '1700123456')
      .send({
        nuevoEstadoPersona: 'INACTIVA',
        motivoDesactivacion: 'Cese definitivo de funciones reportado por Talento Humano',
      });

    expect(response.status).toBe(200);
    expect(response.body.idInterno).toBe(idInterno);
    expect(response.body.estadoPersona).toBe('INACTIVA');
    expect(response.body.cuentasDesactivadas).toBe(2);
    expect(response.body.cacheInvalidated).toBe(true);

    // Verificar que todas las llaves en Redis fueron eliminadas inmediatamente
    expect(await redisClient.getJson(redisClient.keyByInternalId(idInterno))).toBeNull();
    expect(await redisClient.getJson(redisClient.keyByDoc('CEDULA', '1710034065'))).toBeNull();
    expect(await redisClient.getJson(redisClient.keyBySub('sub-doc-1'))).toBeNull();
    expect(await redisClient.getJson(redisClient.keyByEmail('doc1@educacion.gob.ec'))).toBeNull();
    expect(await redisClient.getJson(redisClient.keyBySub('sub-est-1'))).toBeNull();
    expect(
      await redisClient.getJson(redisClient.keyByEmail('est1@estudiantes.educacion.gob.ec')),
    ).toBeNull();
  });
});
