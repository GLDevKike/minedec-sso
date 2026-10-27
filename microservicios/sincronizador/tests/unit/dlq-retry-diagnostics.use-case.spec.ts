import {
  computeExponentialBackoffWithJitter,
  ExponentialBackoffPolicy,
  InMemoryRateGovernorStore,
  SyncQuotaGovernor,
} from '@minedec/shared';
import {
  AlloyDbSyncStateRepository,
  IDlqRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
  RecordSyncFailureDlqUseCase,
  RegistroFalloSincronizacion,
  ReplayDlqFailuresUseCase,
} from '../../src';

describe('T055 - Retroceso Exponencial (1s..16s + jitter), Diagnóstico DLQ en 4 Partes y Guardia de Obsolescencia', () => {
  it('calcula 5 reintentos con retroceso exponencial base 1s, 2s, 4s, 8s y 16s más jitter determinista', () => {
    const attempt1 = computeExponentialBackoffWithJitter(1, () => 0);
    const attempt2 = computeExponentialBackoffWithJitter(2, () => 0);
    const attempt3 = computeExponentialBackoffWithJitter(3, () => 0);
    const attempt4 = computeExponentialBackoffWithJitter(4, () => 0);
    const attempt5 = computeExponentialBackoffWithJitter(5, () => 0);

    expect(attempt1.baseDelayMs).toBe(1000);
    expect(attempt2.baseDelayMs).toBe(2000);
    expect(attempt3.baseDelayMs).toBe(4000);
    expect(attempt4.baseDelayMs).toBe(8000);
    expect(attempt5.baseDelayMs).toBe(16000);

    const withMaxJitter = computeExponentialBackoffWithJitter(5, () => 1);
    expect(withMaxJitter.totalDelayMs).toBeGreaterThan(16000);
    expect(withMaxJitter.totalDelayMs).toBeLessThanOrEqual(20000);
  });

  it('persiste evento agotado en DLQ con diagnóstico explicativo en español de 4 partes y sanitización de credenciales', async () => {
    const dlqRecords: RegistroFalloSincronizacion[] = [];
    const dlqRepo: IDlqRepositoryPort = {
      findById: jest.fn().mockResolvedValue(null),
      findByExternalEventId: jest.fn().mockResolvedValue(null),
      upsertDlqFailure: jest.fn().mockImplementation(async (rec) => {
        dlqRecords.push(rec);
        return rec;
      }),
      listDlqRecords: jest.fn(),
      countPendingDlq: jest.fn().mockResolvedValue(0),
    };

    const recordDlqUseCase = new RecordSyncFailureDlqUseCase(dlqRepo);
    const saved = await recordDlqUseCase.execute({
      idEventoExterno: 'evt-dlq-429-001',
      origenCanal: 'PUBSUB_AUDIT_LOG',
      googleSubId: 'sub-dlq-001',
      emailPrincipal: 'docente.dlq@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      tipoEvento: 'CHANGE_USER',
      timestampEventoGws: '2026-10-20T10:00:00.000Z',
      payloadOriginal: { eventId: 'evt-dlq-429-001' },
      intentosRealizados: 5,
      ultimoBackoffMs: 16000,
      codigoError: 'GWS_RATE_LIMIT_EXHAUSTED',
      httpStatusGws: 429,
      detalleErrorTecnico: 'HTTP 429 Too Many Requests Authorization: Bearer secret-jwt-token',
      traceId: 'trace-dlq-001',
    });

    expect(saved.estadoDlq).toBe('PENDIENTE_REVISION');
    expect(saved.intentosRealizados).toBe(5);
    expect(saved.ultimoBackoffMs).toBe(16000);
    expect(saved.detalleErrorTecnico).not.toContain('secret-jwt-token');
    expect(saved.diagnosticoLenguajeNatural).toContain('Qué ocurrió');
    expect(saved.accionRecomendada.length).toBeGreaterThan(20);
  });

  it('marca RESUELTO_POR_OBSOLESCENCIA sin sobrescribir la cuenta cuando timestamp_evento_gws < ultima_sincronizacion_en', async () => {
    const staleDlqRecord: RegistroFalloSincronizacion = {
      dlqId: '12121212-3434-4565-8787-909090909090',
      idEventoExterno: 'evt-stale-001',
      origenCanal: 'PUBSUB_AUDIT_LOG',
      googleSubId: 'sub-stale-001',
      emailPrincipal: 'actualizado.reciente@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      tipoEvento: 'CHANGE_USER',
      timestampEventoGws: '2026-10-20T08:00:00.000Z',
      payloadOriginal: {},
      intentosRealizados: 5,
      ultimoBackoffMs: 16000,
      codigoError: 'GWS_UNAVAILABLE',
      httpStatusGws: 503,
      detalleErrorTecnico: 'Service Unavailable',
      diagnosticoLenguajeNatural: 'Fallo temporal previo',
      accionRecomendada: 'Reprocesar desde DLQ',
      estadoDlq: 'PENDIENTE_REVISION',
      resueltoPorIdentificacion: null,
      motivoResolucion: null,
      creadoEn: '2026-10-20T08:01:00.000Z',
      actualizadoEn: '2026-10-20T08:01:00.000Z',
      resueltoEn: null,
    };

    const updatedRecords: RegistroFalloSincronizacion[] = [];
    const dlqRepo: IDlqRepositoryPort = {
      findById: jest.fn().mockResolvedValue(staleDlqRecord),
      findByExternalEventId: jest.fn().mockResolvedValue(staleDlqRecord),
      upsertDlqFailure: jest.fn().mockImplementation(async (rec) => {
        updatedRecords.push(rec);
        return rec;
      }),
      listDlqRecords: jest.fn().mockResolvedValue({
        totalPendientes: 1,
        items: [staleDlqRecord],
      }),
      countPendingDlq: jest.fn().mockResolvedValue(0),
    };

    const syncIdentityRepo: Partial<ISyncIdentityRepositoryPort> = {
      findAccountSyncMetadata: jest.fn().mockResolvedValue({
        cuentaId: 'aaaaaaaa-1111-4222-8333-444444444444',
        idInterno: 'bbbbbbbb-1111-4222-8333-444444444444',
        googleSubId: 'sub-stale-001',
        emailPrincipal: 'actualizado.reciente@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        estadoCuenta: 'ACTIVA',
        estadoSincronizacion: 'SINCRONIZADA',
        hashPayloadGws: 'hash-mas-reciente',
        ultimaSincronizacionEn: '2026-10-20T09:30:00.000Z', // Más reciente que 08:00:00Z
      }),
      upsertSyncedIdentity: jest.fn(),
    };

    const gwsPort: IGoogleDirectoryReadOnlyPort = {
      getUserReadOnly: jest.fn(),
      listUsersReadOnly: jest.fn(),
    };

    const cacheInvalidator: ISyncCacheInvalidatorPort = {
      invalidateAccountScope: jest.fn(),
      invalidatePersonCascadeScope: jest.fn(),
    };

    const replayUseCase = new ReplayDlqFailuresUseCase(
      dlqRepo,
      syncIdentityRepo as ISyncIdentityRepositoryPort,
      gwsPort,
      cacheInvalidator,
      new SyncQuotaGovernor(new InMemoryRateGovernorStore()),
    );

    const replayOut = await replayUseCase.execute({
      adminIdentificacion: 'admin.seguridad@educacion.gob.ec',
      motivoReplay: 'Revisión matutina de bandeja DLQ',
      traceId: 'trace-replay-stale-001',
    });

    expect(replayOut.totalEvaluados).toBe(1);
    expect(replayOut.totalResueltosPorObsolescencia).toBe(1);
    expect(replayOut.totalReprocesadosExitosos).toBe(0);
    expect(updatedRecords[0]?.estadoDlq).toBe('RESUELTO_POR_OBSOLESCENCIA');
    expect(gwsPort.getUserReadOnly).not.toHaveBeenCalled();
    expect(syncIdentityRepo.upsertSyncedIdentity).not.toHaveBeenCalled();
  });

  it('ejercita ExponentialBackoffPolicy (parseRetryAfterMs, computeDelayMs y executeWithRetry)', async () => {
    expect(ExponentialBackoffPolicy.parseRetryAfterMs(null)).toBeNull();
    expect(ExponentialBackoffPolicy.parseRetryAfterMs('')).toBeNull();
    expect(ExponentialBackoffPolicy.parseRetryAfterMs(5)).toBe(5000);
    expect(ExponentialBackoffPolicy.parseRetryAfterMs('10')).toBe(10000);
    const futureIso = new Date(Date.now() + 8000).toUTCString();
    expect(ExponentialBackoffPolicy.parseRetryAfterMs(futureIso)).toBeGreaterThan(0);
    const pastIso = new Date(Date.now() - 8000).toUTCString();
    expect(ExponentialBackoffPolicy.parseRetryAfterMs(pastIso)).toBe(0);
    expect(ExponentialBackoffPolicy.parseRetryAfterMs('not-a-date')).toBeNull();

    const dHonored = ExponentialBackoffPolicy.computeDelayMs(0, 30, () => 250);
    expect(dHonored.honoredRetryAfter).toBe(true);
    expect(dHonored.backoffMs).toBe(30000);

    const dFormula = ExponentialBackoffPolicy.computeDelayMs(2, 1, () => 500);
    expect(dFormula.honoredRetryAfter).toBe(false);
    expect(dFormula.backoffMs).toBe(4500);

    // executeWithRetry: succeeds on attempt 2 after 429
    let calls = 0;
    const okRes = await ExponentialBackoffPolicy.executeWithRetry(
      async (attempt) => {
        calls++;
        if (attempt === 1) {
          throw { httpStatus: 429, retryAfter: '2' };
        }
        return 'ok-retry';
      },
      {
        sleepFn: async () => undefined,
        extractRetryAfter: (err) => (err as { retryAfter?: string })?.retryAfter,
        jitterMsGenerator: () => 100,
      },
    );
    expect(okRes.result).toBe('ok-retry');
    expect(okRes.attemptsMade).toBe(2);
    expect(calls).toBe(2);

    // executeWithRetry: non-retryable error stops immediately
    await expect(
      ExponentialBackoffPolicy.executeWithRetry(
        async () => {
          throw { retryable: false, message: 'fatal' };
        },
        { sleepFn: async () => undefined },
      ),
    ).rejects.toMatchObject({ attemptsMade: 1 });
  });

  it('ejercita AlloyDbSyncStateRepository (eventos procesados, checkpoints y registros DLQ)', async () => {
    const nowDate = new Date('2026-10-20T12:00:00.000Z');
    const oldHeartbeat = new Date(Date.now() - 25 * 60 * 1000);

    const mockEventRow = {
      id_evento_externo: 'evt-1',
      google_sub_id: 'sub-1',
      email_principal: 'u1@educacion.gob.ec',
      tipo_evento: 'CREATE_USER',
      timestamp_evento_gws: nowDate,
      origen_canal: 'ADMIN_SDK_PUSH',
      modo_despacho: 'INDIVIDUAL_GET',
      resultado: 'APLICADO',
      hash_payload_gws: 'hash-1',
      procesado_en: nowDate,
    };

    const mockCheckpointRow = {
      checkpoint_id: 'cp-1',
      dominio: 'educacion.gob.ec',
      org_unit_path: '/Docentes',
      tipo_proceso: 'CONCILIACION_NOCTURNA',
      next_page_token: 'tok-1',
      cuentas_procesadas: 10,
      cuentas_actualizadas: 5,
      cuentas_omitidas_hash: 5,
      cuentas_baja_detectadas: 1,
      anomalias_abiertas: 0,
      estado_ejecucion: 'EN_PROGRESO',
      worker_instancia_id: 'w-1',
      lock_advisory_key: '12345',
      heartbeat_en: oldHeartbeat,
      iniciado_en: nowDate,
      completado_en: nowDate,
      ultimo_error_codigo: 'ERR_1',
      diagnostico_operativo: 'Diag 1',
    };

    const mockDlqRow = {
      dlq_id: 'dlq-1',
      id_evento_externo: 'evt-dlq-1',
      origen_canal: 'PUBSUB_AUDIT_LOG',
      google_sub_id: 'sub-1',
      email_principal: 'u1@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      tipo_evento: 'CHANGE_USER',
      payload_original: JSON.stringify({
        timestampEventoGws: '2026-10-20T11:00:00.000Z',
        httpStatusGws: 429,
        ultimoBackoffMs: 16000,
      }),
      intentos_realizados: 5,
      codigo_error: 'RATE_LIMIT',
      detalle_error_tecnico: '429',
      diagnostico_lenguaje_natural: 'Diag DLQ',
      accion_recomendada: 'Accion DLQ',
      estado_dlq: 'PENDIENTE_REVISION',
      resuelto_por_identificacion: 'admin-1',
      motivo_resolucion: 'Motivo 1',
      creado_en: nowDate,
      actualizado_en: nowDate,
      resuelto_en: nowDate,
    };

    const mockDb = {
      query: jest
        .fn()
        // findByIdEventoExterno (found & not found)
        .mockResolvedValueOnce({ rows: [mockEventRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // findLatestTimestampForUser (found Date & not found)
        .mockResolvedValueOnce({ rows: [{ timestamp_evento_gws: nowDate }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // recordProcessedEvent (inserted & conflict fallback)
        .mockResolvedValueOnce({ rows: [mockEventRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [mockEventRow], rowCount: 1 })
        // findByPartition (found & not found)
        .mockResolvedValueOnce({ rows: [mockCheckpointRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // listCheckpoints with filters
        .mockResolvedValueOnce({ rows: [mockCheckpointRow], rowCount: 1 })
        // upsertCheckpoint
        .mockResolvedValueOnce({ rows: [mockCheckpointRow], rowCount: 1 })
        // findById (found & not found)
        .mockResolvedValueOnce({ rows: [mockDlqRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // findByExternalEventId (found & not found)
        .mockResolvedValueOnce({ rows: [mockDlqRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // upsertDlqFailure
        .mockResolvedValueOnce({ rows: [mockDlqRow], rowCount: 1 })
        // listDlqRecords (query + countPendingDlq)
        .mockResolvedValueOnce({ rows: [mockDlqRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 }),
    };

    const repo = new AlloyDbSyncStateRepository(mockDb);

    const evFound = await repo.findByIdEventoExterno('evt-1');
    expect(evFound?.dominio).toBe('educacion.gob.ec');
    expect(await repo.findByIdEventoExterno('evt-missing')).toBeNull();

    expect(await repo.findLatestTimestampForUser('sub-1')).toBe(nowDate.toISOString());
    expect(await repo.findLatestTimestampForUser('sub-missing')).toBeNull();

    const ins1 = await repo.recordProcessedEvent(evFound!);
    expect(ins1.inserted).toBe(true);
    const ins2 = await repo.recordProcessedEvent(evFound!);
    expect(ins2.inserted).toBe(false);

    const cpFound = await repo.findByPartition(
      'educacion.gob.ec',
      '/Docentes',
      'CONCILIACION_NOCTURNA',
    );
    expect(cpFound?.esParticionHuerfana).toBe(true);
    expect(
      await repo.findByPartition('educacion.gob.ec', '/Otra', 'CONCILIACION_NOCTURNA'),
    ).toBeNull();

    const cpList = await repo.listCheckpoints({
      dominio: 'educacion.gob.ec',
      tipoProceso: 'CONCILIACION_NOCTURNA',
      estadoEjecucion: 'EN_PROGRESO',
    });
    expect(cpList).toHaveLength(1);

    const cpSaved = await repo.upsertCheckpoint(cpFound!);
    expect(cpSaved.checkpointId).toBe('cp-1');

    const dlqFound = await repo.findById('dlq-1');
    expect(dlqFound?.httpStatusGws).toBe(429);
    expect(await repo.findById('dlq-missing')).toBeNull();

    expect((await repo.findByExternalEventId('evt-dlq-1'))?.dlqId).toBe('dlq-1');
    expect(await repo.findByExternalEventId('evt-dlq-missing')).toBeNull();

    const dlqSaved = await repo.upsertDlqFailure(dlqFound!);
    expect(dlqSaved.dlqId).toBe('dlq-1');

    const dlqList = await repo.listDlqRecords({
      estadoDlq: 'PENDIENTE_REVISION',
      dominio: 'educacion.gob.ec',
      dlqIds: ['dlq-1'],
      limit: 25,
    });
    expect(dlqList.items).toHaveLength(1);
    expect(dlqList.totalPendientes).toBe(3);
  });
});

