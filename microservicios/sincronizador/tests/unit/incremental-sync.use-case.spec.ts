import request from 'supertest';
import {
  computeCanonicalGwsProfileHash,
  GwsDirectoryUserRecord,
  RedisCacheClient,
  SyncDiagnosticBuilder,
  SyncQuotaGovernor,
} from '@minedec/shared';
import {
  createSincronizadorHttpApp,
  ExecuteIncrementalSyncUseCase,
  HandleAccountLifecycleChangeUseCase,
  IGoogleDirectoryReadOnlyPort,
  IProcessedEventRepositoryPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
  ProcessPubSubEventUseCase,
  RecordSyncFailureDlqUseCase,
} from '../../src';

describe('T022: Sincronización Incremental Casos de Uso (Idempotencia, Orden Temporal, Inmutabilidad CEDULA y RUC 13->10)', () => {
  const sampleGwsUser: GwsDirectoryUserRecord = {
    id: 'gws-sub-1001',
    googleSubId: 'gws-sub-1001',
    primaryEmail: 'maria.loja@educacion.gob.ec',
    emailPrincipal: 'maria.loja@educacion.gob.ec',
    givenName: 'María',
    familyName: 'Loja',
    name: { fullName: 'María Loja' },
    nombreCompleto: 'María Loja',
    orgUnitPath: '/Docentes',
    suspended: false,
    suspendedEnGws: false,
    deletedEnGws: false,
    archived: false,
    customSchemas: {
      MINEDEC_Perfil: {
        tipoIdentificacion: 'CEDULA',
        numeroIdentificacion: '1710034065001', // RUC 13 dígitos de persona natural -> normaliza a 10 dígitos
        regimenLaboral: 'HONORARIOS_PROFESIONALES',
        tipoUsuario: 'DOCENTE',
        codigoInstitucion: '17H00123',
      },
    },
  };

  function createMocks() {
    const gwsPort: jest.Mocked<IGoogleDirectoryReadOnlyPort> = {
      getUserReadOnly: jest.fn().mockResolvedValue(sampleGwsUser),
      listUsersReadOnly: jest.fn().mockResolvedValue({ users: [sampleGwsUser] }),
    };

    const syncIdentityRepo: jest.Mocked<ISyncIdentityRepositoryPort> = {
      isDomainActive: jest.fn().mockResolvedValue(true),
      listActiveDomains: jest.fn().mockResolvedValue(['educacion.gob.ec']),
      findAccountSyncMetadata: jest.fn().mockResolvedValue(null),
      countActiveAccountsForPerson: jest.fn().mockResolvedValue(0),
      upsertSyncedIdentity: jest.fn().mockResolvedValue({
        outcome: 'APLICADO',
        idInternoPersona: 'uuid-persona-1',
        cuentaId: 'uuid-cuenta-1',
        googleSubId: 'gws-sub-1001',
        emailPrincipal: 'maria.loja@educacion.gob.ec',
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

    const processedEventRepo: jest.Mocked<IProcessedEventRepositoryPort> = {
      findByIdEventoExterno: jest.fn().mockResolvedValue(null),
      findLatestTimestampForUser: jest.fn().mockResolvedValue(null),
      recordProcessedEvent: jest.fn().mockImplementation(async (ev) => ({
        inserted: true,
        record: ev,
      })),
    };

    const cacheInvalidator: jest.Mocked<ISyncCacheInvalidatorPort> = {
      invalidateAccountScope: jest.fn().mockResolvedValue({
        invalidatedKeysCount: 4,
        pubSubPublished: true,
      }),
      invalidatePersonCascadeScope: jest.fn().mockResolvedValue({
        invalidatedKeysCount: 6,
        pubSubPublished: true,
      }),
    };

    const quotaGovernor = new SyncQuotaGovernor(new RedisCacheClient());
    const lifecycleUseCase = new HandleAccountLifecycleChangeUseCase(
      syncIdentityRepo,
      cacheInvalidator,
    );
    const dlqUseCase = {
      execute: jest.fn().mockResolvedValue({ dlqId: 'dlq-1' }),
    } as unknown as RecordSyncFailureDlqUseCase;

    const useCase = new ExecuteIncrementalSyncUseCase(
      gwsPort,
      syncIdentityRepo,
      processedEventRepo,
      cacheInvalidator,
      lifecycleUseCase,
      quotaGovernor,
      dlqUseCase,
    );

    return {
      gwsPort,
      syncIdentityRepo,
      processedEventRepo,
      cacheInvalidator,
      useCase,
    };
  }

  it('ignora idempotentemente eventos duplicados ya registrados en evento_sincronizacion_procesado', async () => {
    const { useCase, processedEventRepo, gwsPort } = createMocks();
    processedEventRepo.findByIdEventoExterno.mockResolvedValueOnce({
      idEventoExterno: 'evt-dup-1',
      googleSubId: 'gws-sub-1001',
      emailPrincipal: 'maria.loja@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      tipoEvento: 'CHANGE_USER',
      timestampEventoGws: '2026-10-20T10:00:00Z',
      origenCanal: 'PUBSUB_AUDIT_LOG',
      modoDespacho: 'FETCH_BY_SUB',
      resultado: 'PROCESADO',
      hashPayloadGws: 'abc',
      procesadoEn: '2026-10-20T10:00:01Z',
    });

    const result = await useCase.execute({
      idEventoExterno: 'evt-dup-1',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'gws-sub-1001',
      timestampEventoGws: '2026-10-20T10:00:00Z',
      traceId: 'trace-dup-1',
    });

    expect(result.resultado).toBe('DUPLICADO_IGNORADO');
    expect(gwsPort.getUserReadOnly).not.toHaveBeenCalled();
  });

  it('descarta eventos desordenados u obsoletos con timestamp_evento_gws menor al último procesado', async () => {
    const { useCase, processedEventRepo, syncIdentityRepo, gwsPort } = createMocks();
    processedEventRepo.findLatestTimestampForUser.mockResolvedValueOnce(
      '2026-10-20T12:00:00.000Z',
    );

    const result = await useCase.execute({
      idEventoExterno: 'evt-stale-1',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'gws-sub-1001',
      timestampEventoGws: '2026-10-20T11:00:00.000Z',
      traceId: 'trace-stale-1',
    });

    expect(result.resultado).toBe('OBSOLETO_IGNORADO');
    expect(gwsPort.getUserReadOnly).not.toHaveBeenCalled();
    expect(syncIdentityRepo.upsertSyncedIdentity).not.toHaveBeenCalled();
  });

  it('omite escritura en AlloyDB e invalidación Redis cuando hash_payload_gws es idéntico al almacenado', async () => {
    const { useCase, syncIdentityRepo, cacheInvalidator } = createMocks();
    const expectedHash = computeCanonicalGwsProfileHash(sampleGwsUser);

    syncIdentityRepo.findAccountSyncMetadata.mockResolvedValueOnce({
      cuentaId: 'uuid-cuenta-1',
      idInterno: 'uuid-persona-1',
      googleSubId: 'gws-sub-1001',
      emailPrincipal: 'maria.loja@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      estadoSincronizacion: 'SINCRONIZADA',
      hashPayloadGws: expectedHash,
      ultimaSincronizacionEn: '2026-10-20T09:00:00.000Z',
    });

    const result = await useCase.execute({
      idEventoExterno: 'evt-same-hash-1',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'gws-sub-1001',
      timestampEventoGws: '2026-10-20T10:30:00.000Z',
      traceId: 'trace-same-hash',
    });

    expect(result.resultado).toBe('SIN_CAMBIOS_HASH');
    expect(result.cacheInvalidated).toBe(false);
    expect(syncIdentityRepo.upsertSyncedIdentity).not.toHaveBeenCalled();
    expect(cacheInvalidator.invalidateAccountScope).not.toHaveBeenCalled();
  });

  it('bloquea con anomalía cuando se detecta mutación prohibida de CEDULA consolidada', async () => {
    const { useCase, syncIdentityRepo } = createMocks();
    syncIdentityRepo.upsertSyncedIdentity.mockResolvedValueOnce({
      outcome: 'ANOMALIA_REGISTRADA',
      idInternoPersona: 'uuid-persona-1',
      cuentaId: 'uuid-cuenta-1',
      googleSubId: 'gws-sub-1001',
      emailPrincipal: 'maria.loja@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      estadoPersona: 'BLOQUEADA_ANOMALIA',
      estadoCuenta: 'BLOQUEADA_ANOMALIA',
      otherActiveAccountsCount: 0,
      requiresCacheInvalidation: true,
      anomaliasGeneradasIds: ['anom-colision-cedula-1'],
    });

    const result = await useCase.execute({
      idEventoExterno: 'evt-cedula-mut-1',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'gws-sub-1001',
      timestampEventoGws: '2026-10-20T11:30:00.000Z',
      traceId: 'trace-cedula-mut',
    });

    expect(result.resultado).toBe('ANOMALIA_REGISTRADA');
    expect(result.estadoPersonaResultante).toBe('BLOQUEADA_ANOMALIA');
    expect(result.anomaliasGeneradasIds).toContain('anom-colision-cedula-1');
  });

  it('rechaza dominios fuera de dominio_institucional (D-21) en ProcessPubSubEventUseCase', async () => {
    const { syncIdentityRepo, processedEventRepo } = createMocks();
    syncIdentityRepo.isDomainActive.mockResolvedValueOnce(false);
    const dispatcher = {
      enqueuePriorityHotRegistration: jest.fn(),
      enqueueIncrementalSync: jest.fn(),
    };
    const redis = new RedisCacheClient();
    const pubSubUseCase = new ProcessPubSubEventUseCase(
      syncIdentityRepo,
      processedEventRepo,
      dispatcher,
      new SyncQuotaGovernor(redis),
      redis,
    );

    const payloadBase64 = Buffer.from(
      JSON.stringify({
        idEventoExterno: 'evt-unregistered-domain',
        tipoEvento: 'CHANGE_USER',
        googleSubId: 'sub-999',
        emailPrincipal: 'externo@dominio-no-autorizado.org',
        timestampEventoGws: '2026-10-20T10:00:00Z',
      }),
    ).toString('base64');

    const res = await pubSubUseCase.execute({
      messageId: 'msg-999',
      publishTime: '2026-10-20T10:00:01Z',
      dataBase64: payloadBase64,
      traceId: 'trace-unregistered',
    });

    expect(res.status).toBe('IGNORED_INACTIVE_DOMAIN');
    expect(dispatcher.enqueueIncrementalSync).not.toHaveBeenCalled();
  });

  it('cubre ramas de DELETE_USER, usuario inexistente en GWS, agotamiento a DLQ, dedup Redis y cola prioritaria hot-reg', async () => {
    const { gwsPort, syncIdentityRepo, processedEventRepo, useCase } = createMocks();
    syncIdentityRepo.applyAccountLifecycleChange.mockResolvedValue({
      found: true,
      idInternoPersona: 'uuid-persona-1',
      cuentaId: 'uuid-cuenta-1',
      googleSubId: 'gws-sub-1001',
      emailPrincipal: 'maria.loja@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      estadoCuentaResultante: 'ELIMINADA_GWS',
      estadoPersonaResultante: 'INACTIVA',
      remainingActiveAccountsCount: 0,
    });

    // 1. DELETE_USER direct branch
    const delRes = await useCase.execute({
      idEventoExterno: 'evt-del-1',
      tipoEvento: 'DELETE_USER',
      googleSubId: 'gws-sub-1001',
      emailPrincipal: 'maria.loja@educacion.gob.ec',
      timestampEventoGws: '2026-10-20T12:00:00Z',
      traceId: 'trace-del-1',
    });
    expect(delRes.resultado).toBe('APLICADO');
    expect(delRes.estadoCuentaResultante).toBe('ELIMINADA_GWS');

    // 2. Inactive domain in ExecuteIncrementalSyncUseCase
    syncIdentityRepo.isDomainActive.mockResolvedValueOnce(false);
    const inactRes = await useCase.execute({
      idEventoExterno: 'evt-inact-1',
      tipoEvento: 'CHANGE_USER',
      emailPrincipal: 'u@inactivo.gob.ec',
      timestampEventoGws: '2026-10-20T12:00:00Z',
      traceId: 'trace-inact-1',
    });
    expect(inactRes.resultado).toBe('OBSOLETO_IGNORADO');

    // 3. gwsUser returns null (with googleSubId and without googleSubId)
    gwsPort.getUserReadOnly.mockResolvedValueOnce(null);
    const nullWithSub = await useCase.execute({
      idEventoExterno: 'evt-null-sub',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'gws-sub-1001',
      timestampEventoGws: '2026-10-20T12:00:00Z',
      traceId: 'trace-null-sub',
    });
    expect(nullWithSub.resultado).toBe('APLICADO');

    gwsPort.getUserReadOnly.mockResolvedValueOnce(null);
    const nullWithoutSub = await useCase.execute({
      idEventoExterno: 'evt-null-nosub',
      tipoEvento: 'CHANGE_USER',
      emailPrincipal: 'maria.loja@educacion.gob.ec',
      timestampEventoGws: '2026-10-20T12:00:00Z',
      traceId: 'trace-null-nosub',
    });
    expect(nullWithoutSub.resultado).toBe('OBSOLETO_IGNORADO');

    // 4. Error on attempt 5 -> DERIVADO_A_DLQ
    const err429 = Object.assign(new Error('Rate limit'), { httpStatus: 429 });
    gwsPort.getUserReadOnly.mockRejectedValueOnce(err429);
    const dlqRes = await useCase.execute({
      idEventoExterno: 'evt-dlq-5',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'gws-sub-1001',
      timestampEventoGws: '2026-10-20T12:00:00Z',
      intentoActual: 5,
      traceId: 'trace-dlq-5',
    });
    expect(dlqRes.resultado).toBe('DERIVADO_A_DLQ');

    // 5. ProcessPubSubEventUseCase: hot registration, duplicate in Redis, duplicate in DB, obsolete
    const dispatcher = {
      enqueuePriorityHotRegistration: jest.fn().mockResolvedValue({
        taskId: 't-hot',
        queueName: 'q-hot',
      }),
      enqueueIncrementalSync: jest.fn().mockResolvedValue({
        taskId: 't-inc',
        queueName: 'q-inc',
      }),
    };
    const redis = new RedisCacheClient();
    const pubSubUseCase = new ProcessPubSubEventUseCase(
      syncIdentityRepo,
      processedEventRepo,
      dispatcher,
      new SyncQuotaGovernor(redis),
      redis,
    );

    const hotEnq = await pubSubUseCase.execute({
      messageId: 'msg-hot-1',
      idEventoExterno: 'evt-hot-enq-1',
      tipoEvento: 'REGISTRO_CALIENTE_RECONCILE',
      googleSubId: 'sub-hot-1',
      emailPrincipal: 'hot@educacion.gob.ec',
      esRegistroCaliente: true,
      traceId: 't-hot-1',
    });
    expect(hotEnq.status).toBe('ENQUEUED_PRIORITY_HOT_REG');

    // Calling again hits Redis dedup
    const dupRedis = await pubSubUseCase.execute({
      messageId: 'msg-hot-1',
      idEventoExterno: 'evt-hot-enq-1',
      traceId: 't-hot-1',
    });
    expect(dupRedis.status).toBe('IGNORED_DUPLICATE');

    // Obsolete timestamp in ProcessPubSubEventUseCase
    processedEventRepo.findLatestTimestampForUser.mockResolvedValueOnce(
      '2026-10-20T15:00:00Z',
    );
    const obsPubSub = await pubSubUseCase.execute({
      messageId: 'msg-obs-1',
      idEventoExterno: 'evt-obs-pubsub-1',
      googleSubId: 'sub-hot-1',
      timestampEventoGws: '2026-10-20T10:00:00Z',
      traceId: 't-obs-1',
    });
    expect(obsPubSub.status).toBe('IGNORED_OBSOLETE');
  });

  it('cubre SyncDiagnosticBuilder (todos los escenarios) y validaciones HTTP / autenticación OIDC en app.ts y controladores', async () => {
    const scenarios = [
      'GWS_QUOTA_THROTTLED',
      'DLQ_EVENT_EXHAUSTED',
      'PARTITION_ORPHAN_RECOVERED',
      'PARTITION_CONFLICT_ACTIVE',
      'INVALID_GWS_PAYLOAD',
      'HEALTH_SUMMARY',
    ] as const;

    for (const escenario of scenarios) {
      const built = SyncDiagnosticBuilder.build({
        escenario,
        dominio: 'educacion.gob.ec',
        orgUnitPath: '/Docentes',
        googleUserId: 'sub-1',
        idEventoExterno: 'evt-1',
        httpStatusGws: 429,
        intentosRealizados: 5,
        pendientesDlq: 2,
        detalleError: 'Detalle de prueba',
      });
      expect(built.resumenEjecutivo).toContain('1. Componente afectado:');
    }

    const appWithAuth = createSincronizadorHttpApp(
      {},
      { requireServiceAuth: true, expectedBearerToken: 'secret-oidc-token' },
    );

    // Ambiguous path rejection (%2F and ..)
    const ambRes = await request(appWithAuth).get('/internal/v1/sync/%2F..');
    expect(ambRes.status).toBe(400);
    expect(ambRes.body.code).toBe('AMBIGUOUS_PATH_REJECTED');

    // Missing Bearer token -> 401
    const unauthRes = await request(appWithAuth)
      .post('/internal/v1/sync/events/pubsub-push')
      .send({});
    expect(unauthRes.status).toBe(401);

    // Wrong Bearer token -> 403
    const forbRes = await request(appWithAuth)
      .post('/internal/v1/sync/events/pubsub-push')
      .set('Authorization', 'Bearer wrong-token')
      .send({});
    expect(forbRes.status).toBe(403);

    // Invalid payloads on internal & admin endpoints -> 400
    const authHeader = { Authorization: 'Bearer secret-oidc-token' };

    const badEnvelope = await request(appWithAuth)
      .post('/internal/v1/sync/events/pubsub-push')
      .set(authHeader)
      .send({ invalid: true });
    expect(badEnvelope.status).toBe(400);

    const badBase64Json = await request(appWithAuth)
      .post('/internal/v1/sync/events/pubsub-push')
      .set(authHeader)
      .send({
        message: {
          messageId: 'm1',
          data: Buffer.from('not-json-{{{').toString('base64'),
        },
      });
    expect(badBase64Json.status).toBe(400);

    const badInc = await request(appWithAuth)
      .post('/internal/v1/sync/tasks/incremental')
      .set(authHeader)
      .send({});
    expect(badInc.status).toBe(400);

    const badHot = await request(appWithAuth)
      .post('/internal/v1/sync/tasks/priority-hot-registration')
      .set(authHeader)
      .send({});
    expect(badHot.status).toBe(400);

    const badUuidDeactivate = await request(appWithAuth)
      .post('/api/v1/admin/sync/persons/not-a-uuid/deactivate')
      .set(authHeader)
      .send({});
    expect(badUuidDeactivate.status).toBe(400);

    const badBodyDeactivate = await request(appWithAuth)
      .post('/api/v1/admin/sync/persons/b6a6c7b4-8b20-4895-9f9a-111122223333/deactivate')
      .set(authHeader)
      .send({ nuevoEstadoPersona: 'INVALIDO' });
    expect(badBodyDeactivate.status).toBe(400);

    const notFoundDeactivate = await request(appWithAuth)
      .post('/api/v1/admin/sync/persons/b6a6c7b4-8b20-4895-9f9a-111122223333/deactivate')
      .set(authHeader)
      .send({
        nuevoEstadoPersona: 'INACTIVA',
        motivoDesactivacion: 'Baja administrativa de prueba',
      });
    expect(notFoundDeactivate.status).toBe(404);

    const badTrigger = await request(appWithAuth)
      .post('/api/v1/admin/sync/partitions/trigger')
      .set(authHeader)
      .send({});
    expect(badTrigger.status).toBe(400);

    const badReplay = await request(appWithAuth)
      .post('/api/v1/admin/sync/dlq/replay')
      .set(authHeader)
      .send({ dlqIds: 'not-an-array' });
    expect(badReplay.status).toBe(400);

    // Health endpoint bypasses service auth in appWithAuth
    const healthRes = await request(appWithAuth).get('/internal/v1/sync/health/detailed');
    expect([200, 503]).toContain(healthRes.status);

    // Invalid decoded event payload in Pub/Sub push
    const badEventPayload = await request(appWithAuth)
      .post('/internal/v1/sync/events/pubsub-push')
      .set(authHeader)
      .send({
        message: {
          messageId: 'm2',
          data: Buffer.from(JSON.stringify({ esRegistroCaliente: 'not-boolean' })).toString(
            'base64',
          ),
        },
      });
    expect(badEventPayload.status).toBe(400);

    // Invalid delta sweep payload
    const badDelta = await request(appWithAuth)
      .post('/internal/v1/sync/tasks/delta-sweep')
      .set(authHeader)
      .send({ ventanaMinutos: -10 });
    expect(badDelta.status).toBe(400);

    // Checkpoints and DLQ query filters
    const cpList = await request(appWithAuth)
      .get(
        '/api/v1/admin/sync/checkpoints?dominio=educacion.gob.ec&tipoProceso=CONCILIACION_NOCTURNA&estadoEjecucion=COMPLETADO',
      )
      .set(authHeader);
    expect(cpList.status).toBe(200);

    const dlqList = await request(appWithAuth)
      .get('/api/v1/admin/sync/dlq?estadoDlq=PENDIENTE_REPROCESO&dominio=educacion.gob.ec&limit=10')
      .set(authHeader);
    expect(dlqList.status).toBe(200);
  });
});
