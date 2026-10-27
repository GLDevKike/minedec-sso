import {
  AlloyDbAdvisoryLockManager,
  assertReadOnlyHttpMethod,
  assertReadOnlyWorkspaceScopes,
  computeCanonicalGwsProfileHash,
  computePartitionAdvisoryLockKey,
  evaluateBatchSwitchHysteresis,
  GwsDirectoryReadOnlyAdapter,
  GwsReadOnlySecurityViolationError,
  hasGwsProfileChanged,
  isPartitionHeartbeatOrphaned,
  mapRawGoogleDirectoryUser,
  RedisCacheClient,
  RedisDistributedRateGovernor,
} from '@minedec/shared';
import {
  CloudTasksDispatcherAdapter,
  RedisPubSubCacheInvalidatorAdapter,
} from '../../src';

describe('T021: Gobernador de Cuota GWS (<= 28 req/s), Histéresis de Conmutación y Hash SHA-256 Canónico', () => {
  it('calcula determinísticamente el hash SHA-256 canónico ignorando metadatos efímeros (etag, lastLoginTime)', () => {
    const profileA = {
      id: '1122334455',
      primaryEmail: 'Docente.Uno@Educacion.gob.ec',
      name: { fullName: 'Juan Pérez' },
      orgUnitPath: '/Docentes',
      suspended: false,
      archived: false,
      etag: '"etag-1"',
      lastLoginTime: '2026-10-19T10:00:00Z',
      customSchemas: {
        MINEDEC_Perfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
          codigoInstitucion: '17H00123',
        },
      },
    };

    const profileB = {
      id: '1122334455',
      primaryEmail: 'docente.uno@educacion.gob.ec',
      name: { fullName: 'Juan Pérez' },
      orgUnitPath: '/Docentes',
      suspended: false,
      archived: false,
      etag: '"etag-999"',
      lastLoginTime: '2026-10-20T15:30:00Z',
      customSchemas: {
        MINEDEC_Perfil: {
          codigoInstitucion: '17H00123',
          numeroIdentificacion: '1710034065',
          tipoIdentificacion: 'CEDULA',
          tipoUsuario: 'DOCENTE',
        },
      },
    };

    const hashA = computeCanonicalGwsProfileHash(profileA);
    const hashB = computeCanonicalGwsProfileHash(profileB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    expect(hasGwsProfileChanged(hashA, hashB)).toBe(false);
    expect(hasGwsProfileChanged(null, hashB)).toBe(true);
  });

  it('evalúa la histéresis de conmutación entre users.get individual y users.list (500) sin oscilación', () => {
    // 1. Por debajo de umbrales (< 100 y <= 10 s) permanece en INDIVIDUAL_GET
    const lowLoad = evaluateBatchSwitchHysteresis({
      currentMode: 'INDIVIDUAL_GET',
      pendingEventsCount: 50,
      oldestUnackedMessageAgeSeconds: 5,
    });
    expect(lowLoad.recommendedMode).toBe('INDIVIDUAL_GET');
    expect(lowLoad.transitioned).toBe(false);

    // 2. Al superar >= 100 eventos pendientes conmuta a LOTE_LIST_500
    const highQueue = evaluateBatchSwitchHysteresis({
      currentMode: 'INDIVIDUAL_GET',
      pendingEventsCount: 120,
      oldestUnackedMessageAgeSeconds: 12,
    });
    expect(highQueue.recommendedMode).toBe('LOTE_LIST_500');
    expect(highQueue.transitioned).toBe(true);

    // 3. En zona intermedia (ej. 50 eventos y 8 s) mantiene LOTE_LIST_500 por histéresis
    const hysteresisHold = evaluateBatchSwitchHysteresis({
      currentMode: 'LOTE_LIST_500',
      pendingEventsCount: 50,
      oldestUnackedMessageAgeSeconds: 8,
    });
    expect(hysteresisHold.recommendedMode).toBe('LOTE_LIST_500');
    expect(hysteresisHold.transitioned).toBe(false);

    // 4. Solo retorna a INDIVIDUAL_GET cuando < 20 pendientes y <= 10 s de antigüedad
    const recovered = evaluateBatchSwitchHysteresis({
      currentMode: 'LOTE_LIST_500',
      pendingEventsCount: 15,
      oldestUnackedMessageAgeSeconds: 3,
    });
    expect(recovered.recommendedMode).toBe('INDIVIDUAL_GET');
    expect(recovered.transitioned).toBe(true);
  });

  it('gobierna el presupuesto en Redis <= 28 req/s totales y reserva >= 8 req/s para tiempo real durante jobs masivos (<= 20 req/s)', async () => {
    const redis = new RedisCacheClient();
    const governor = new RedisDistributedRateGovernor(redis, {
      maxTotalPerSecond: 28,
      maxBatchWhenRealtimeActivePerSecond: 20,
      minRealtimeReservedPerSecond: 8,
    });

    await governor.setBatchJobActive(true);
    const snapshot = await governor.getStatusSnapshot();
    expect(snapshot.batchJobActive).toBe(true);
    expect(snapshot.maxGlobalPerSecond).toBe(28);
    expect(snapshot.maxBatchPerSecond).toBe(20);
    expect(snapshot.minRealtimeReservedPerSecond).toBe(8);

    // Consumir los 20 slots de BATCH_RECONCILIATION en el segundo actual
    let batchAllowedCount = 0;
    for (let i = 0; i < 25; i++) {
      const attempt = await governor.tryAcquire('BATCH_RECONCILIATION', 1);
      if (attempt.allowed) {
        batchAllowedCount++;
      }
    }
    expect(batchAllowedCount).toBe(20);

    // Verificar que REALTIME_INCREMENTAL aún dispone de los >= 8 slots reservados (hasta llegar a 28 globales)
    let realtimeAllowedCount = 0;
    for (let i = 0; i < 10; i++) {
      const attempt = await governor.tryAcquire('REALTIME_INCREMENTAL', 1);
      if (attempt.allowed) {
        realtimeAllowedCount++;
      }
    }
    expect(realtimeAllowedCount).toBe(8);
  });

  it('valida GwsDirectoryReadOnlyAdapter, scopes de solo lectura, método GET y mapeo de perfiles GWS', async () => {
    expect(() => assertReadOnlyWorkspaceScopes([])).toThrow(
      GwsReadOnlySecurityViolationError,
    );
    expect(() =>
      assertReadOnlyWorkspaceScopes(['https://www.googleapis.com/auth/admin.directory.user']),
    ).toThrow(GwsReadOnlySecurityViolationError);
    expect(() => assertReadOnlyHttpMethod('POST')).toThrow(
      GwsReadOnlySecurityViolationError,
    );
    expect(() => assertReadOnlyHttpMethod('get')).not.toThrow();

    const mappedMinimal = mapRawGoogleDirectoryUser({
      id: 'sub-min-1',
      primaryEmail: 'User.One@Educacion.Gob.Ec',
      name: { givenName: 'Ana', familyName: 'Paz' },
      lastLoginTime: '2026-10-20T00:00:00Z',
      customSchemas: {
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
        },
      },
    });
    expect(mappedMinimal.googleSubId).toBe('sub-min-1');
    expect(mappedMinimal.emailPrincipal).toBe('user.one@educacion.gob.ec');
    expect(mappedMinimal.nombreCompleto).toBe('Ana Paz');
    expect(mappedMinimal.orgUnitPath).toBe('/');
    expect(mappedMinimal.lastModifiedTimeIso).toBe('2026-10-20T00:00:00Z');
    expect(mappedMinimal.customSchemas?.minedecPerfil?.numeroIdentificacion).toBe(
      '1710034065',
    );

    const mappedEmpty = mapRawGoogleDirectoryUser({});
    expect(mappedEmpty.googleSubId).toBe('');
    expect(mappedEmpty.orgUnitPath).toBe('/');

    // Default transports
    const defaultAdapter = new GwsDirectoryReadOnlyAdapter();
    expect(await defaultAdapter.getUserReadOnly('sub-default')).toBeNull();
    expect(
      await defaultAdapter.listUsersReadOnly({ domain: 'educacion.gob.ec' }),
    ).toEqual({ users: [], nextPageToken: null });
    expect(
      await defaultAdapter.listAdminUserAuditEvents({
        startTimeIso: '2026-10-20T00:00:00Z',
      }),
    ).toEqual([]);

    // Custom transport with rateGovernor and token caching
    const redis = new RedisCacheClient();
    const governor = new RedisDistributedRateGovernor(redis);
    const customAdapter = new GwsDirectoryReadOnlyAdapter({
      rateGovernor: governor,
      gwsHttpTransport: {
        getUser: jest.fn().mockResolvedValue({
          id: 'sub-custom-1',
          primaryEmail: 'custom@educacion.gob.ec',
          name: { fullName: 'Custom User' },
          orgUnitPath: '/Docentes',
          suspended: false,
          archived: false,
        }),
        listUsers: jest.fn().mockResolvedValue({
          users: [
            {
              id: 'sub-custom-1',
              primaryEmail: 'custom@educacion.gob.ec',
              name: { fullName: 'Custom User' },
              orgUnitPath: '/Docentes',
              suspended: false,
              archived: false,
            },
          ],
          nextPageToken: 'tok-2',
        }),
      },
    });

    await expect(customAdapter.fetchUserByGoogleSubOrEmail('   ')).rejects.toThrow(
      'userKey no puede ser vacío',
    );
    await expect(
      customAdapter.listDirectoryUsersPage({ domain: '   ' }),
    ).rejects.toThrow('domain es obligatorio');

    const userRes = await customAdapter.fetchUserByGoogleSubOrEmail('sub-custom-1');
    expect(userRes?.emailPrincipal).toBe('custom@educacion.gob.ec');

    // Second call uses cached token
    const listRes = await customAdapter.listDirectoryUsersPage({
      domain: 'educacion.gob.ec',
      orgUnitPath: "/Docentes'Especial",
      query: 'isSuspended=false',
      showDeleted: true,
    });
    expect(listRes.users).toHaveLength(1);
    expect(listRes.nextPageToken).toBe('tok-2');

    // Audit events when listAdminAuditActivities is undefined on custom transport
    const auditRes = await customAdapter.listAdminUserAuditEvents({
      startTimeIso: '2026-10-20T00:00:00Z',
    });
    expect(auditRes).toEqual([]);
  });

  it('verifica AlloyDbAdvisoryLockManager, CloudTasksDispatcherAdapter y RedisPubSubCacheInvalidatorAdapter', async () => {
    expect(() => computePartitionAdvisoryLockKey('   ')).toThrow(
      'partitionIdentifier no puede ser vacío',
    );
    const key1 = computePartitionAdvisoryLockKey(
      'educacion.gob.ec',
      '/Docentes',
      'CONCILIACION_NOCTURNA',
    );
    expect(key1).toMatch(/^\d+$/);

    expect(isPartitionHeartbeatOrphaned(null)).toBe(true);
    expect(isPartitionHeartbeatOrphaned('invalid-date')).toBe(true);
    expect(isPartitionHeartbeatOrphaned(new Date())).toBe(false);
    expect(
      isPartitionHeartbeatOrphaned(new Date(Date.now() - 20 * 60 * 1000), 15),
    ).toBe(true);

    // Without executor
    const lockNoDb = new AlloyDbAdvisoryLockManager();
    expect((await lockNoDb.tryAcquireLock('part-1')).acquired).toBe(true);
    expect(await lockNoDb.releaseLock('part-1')).toBe(true);

    // With mock executor
    const mockDb = {
      query: jest
        .fn()
        .mockResolvedValue({ rows: [{ acquired: true, released: true }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ released: true }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ acquired: false }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ released: true }], rowCount: 1 }),
    };
    const lockWithDb = new AlloyDbAdvisoryLockManager(mockDb);
    const res1 = await lockWithDb.withPartitionLock('part-1', async (k) => `ok-${k}`);
    expect(res1.acquired).toBe(true);

    const res2 = await lockWithDb.withPartitionLock(
      'educacion.gob.ec',
      '/Docentes',
      'CONCILIACION_NOCTURNA',
      async () => 'never',
    );
    expect(res2.acquired).toBe(false);

    const res3 = await lockWithDb.withPartitionLock(
      'educacion.gob.ec',
      '/Docentes',
      'CONCILIACION_NOCTURNA',
      async () => 'ok-overload',
    );
    expect(res3.acquired).toBe(true);

    await expect(
      lockWithDb.withPartitionLock('educacion.gob.ec', '/Docentes', 'TIPO'),
    ).rejects.toThrow('Se requiere función work');

    await lockWithDb.tryAcquirePartitionLock('educacion.gob.ec', '/Docentes');
    await lockWithDb.releasePartitionLock('educacion.gob.ec', '/Docentes');

    // CloudTasksDispatcherAdapter with and without tasksClient
    const localDispatcher = new CloudTasksDispatcherAdapter({
      projectId: 'p1',
      location: 'us-central1',
      serviceBaseUrl: 'https://sync.local/',
    });
    const localHot = await localDispatcher.enqueuePriorityHotRegistration({
      idEventoExterno: 'e1',
      googleSubId: 'sub1',
      emailPrincipal: 'u1@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      solicitadoEn: new Date().toISOString(),
      traceId: 't1',
    });
    expect(localHot.taskId).toContain('local-task-');

    const mockTasksClient = {
      createTask: jest.fn().mockResolvedValue([{ name: 'projects/p1/tasks/t-99' }]),
    };
    const remoteDispatcher = new CloudTasksDispatcherAdapter({
      projectId: 'p1',
      location: 'us-central1',
      serviceBaseUrl: 'https://sync.local/',
      tasksClient: mockTasksClient,
    });
    const remoteInc = await remoteDispatcher.enqueueIncrementalSync({
      idEventoExterno: 'e2',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'sub2',
      timestampEventoGws: new Date().toISOString(),
      traceId: 't2',
    });
    expect(remoteInc.taskId).toBe('projects/p1/tasks/t-99');

    // RedisPubSubCacheInvalidatorAdapter with failing pubSubPublisher (degraded mode)
    const failingPubSub = {
      publishMessage: jest.fn().mockRejectedValue(new Error('PubSub timeout')),
    };
    const invalidator = new RedisPubSubCacheInvalidatorAdapter(
      new RedisCacheClient(),
      failingPubSub,
    );
    const invAcc = await invalidator.invalidateAccountScope({
      idInternoPersona: 'id-1',
      cuentaId: 'c-1',
      googleSubId: 'sub-1',
      emailPrincipal: 'u1@educacion.gob.ec',
      motivo: 'test',
      traceId: 't-1',
    });
    expect(invAcc.pubSubPublished).toBe(false);

    const invPerson = await invalidator.invalidatePersonCascadeScope({
      idInternoPersona: 'id-1',
      tipoIdentificacion: 'CEDULA',
      numeroIdentificacion: '1710034065',
      cuentas: [
        {
          cuentaId: 'c-1',
          googleSubId: 'sub-1',
          emailPrincipal: 'u1@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
        },
      ],
      motivo: 'cascade test',
      traceId: 't-2',
    });
    expect(invPerson.pubSubPublished).toBe(false);
  });
});

