import {
  AuditEventWriter,
  hashPayloadGws,
  InMemoryRateGovernorStore,
  OtelSpanTelemetry,
  PartitionAdvisoryLock,
  SqlQueryExecutor,
  SyncQuotaGovernor,
} from '@minedec/shared';
import {
  HandleAccountLifecycleChangeUseCase,
  ICheckpointRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  ISyncIdentityRepositoryPort,
  RecordSyncFailureDlqUseCase,
} from '@minedec/sincronizador';
import {
  AlloyDbBatchReconciliationRepository,
  executeConciliacionJobFromEnv,
  GwsDirectoryUserProfile,
  IBatchReconciliationRepositoryPort,
  PartitionAlreadyActiveConflictError,
  ResultadoEjecucionParticion,
  RunPartitionReconciliationUseCase,
} from '../../src';

describe('T045 - RunPartitionReconciliationUseCase (Bloqueo Consultivo, Rescate Huérfano, Diff Hash SHA-256 y Cuota)', () => {
  const sampleProfileUnchanged: GwsDirectoryUserProfile = {
    id: 'sub-batch-001',
    googleSubId: 'sub-batch-001',
    primaryEmail: 'sin.cambio@educacion.gob.ec',
    name: {
      givenName: 'Ana',
      familyName: 'Paz',
      fullName: 'Ana Paz',
    },
    suspended: false,
    archived: false,
    orgUnitPath: '/Docentes',
  };

  const sampleProfileChanged: GwsDirectoryUserProfile = {
    id: 'sub-batch-002',
    googleSubId: 'sub-batch-002',
    primaryEmail: 'con.cambio@educacion.gob.ec',
    name: {
      givenName: 'Luis',
      familyName: 'Vera',
      fullName: 'Luis Vera',
    },
    suspended: false,
    archived: false,
    orgUnitPath: '/Docentes',
  };

  const buildHarness = () => {
    const batchRepository: jest.Mocked<IBatchReconciliationRepositoryPort> = {
      listActiveDomains: jest
        .fn()
        .mockResolvedValue([{ dominio: 'educacion.gob.ec', activo: true }]),
      findDomainByName: jest
        .fn()
        .mockResolvedValue({ dominio: 'educacion.gob.ec', activo: true }),
      findOrCreatePartitionCheckpoint: jest.fn(),
      getExistingHashesByGoogleSubIds: jest.fn(),
      processPageChangedProfiles: jest.fn(),
      savePageCheckpoint: jest.fn(),
      updateHeartbeat: jest.fn(),
    };

    const gwsDirectory: jest.Mocked<IGoogleDirectoryReadOnlyPort> = {
      getUserReadOnly: jest.fn(),
      listUsersReadOnly: jest.fn(),
    };

    const quotaGovernor = new SyncQuotaGovernor(new InMemoryRateGovernorStore());
    const advisoryLock = {
      tryAcquirePartitionLock: jest.fn().mockResolvedValue({
        acquired: true,
        lockKey: '123456789',
        partitionId: 'educacion.gob.ec:/Docentes:CONCILIACION_NOCTURNA',
      }),
      releasePartitionLock: jest.fn().mockResolvedValue(undefined),
    } as unknown as PartitionAdvisoryLock;

    const auditWriter = {
      appendEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditEventWriter;

    const useCase = new RunPartitionReconciliationUseCase(
      batchRepository,
      gwsDirectory,
      quotaGovernor,
      advisoryLock,
      auditWriter,
    );

    return {
      useCase,
      batchRepository,
      gwsDirectory,
      quotaGovernor,
      advisoryLock,
      auditWriter,
    };
  };

  it('lanza error si el dominio está inactivo y PartitionAlreadyActiveConflictError (409) cuando pg_try_advisory_lock devuelve acquired=false', async () => {
    const { useCase, batchRepository, advisoryLock } = buildHarness();

    batchRepository.findDomainByName.mockResolvedValueOnce(null);
    await expect(
      useCase.runPartition({
        dominio: 'inactivo.gob.ec',
        orgUnitPath: '/Docentes',
        tipoProceso: 'CONCILIACION_NOCTURNA',
      }),
    ).rejects.toThrow(/inactivo/);

    (advisoryLock.tryAcquirePartitionLock as jest.Mock).mockResolvedValueOnce({
      acquired: false,
      lockKey: '987654321',
      partitionId: 'educacion.gob.ec:/Docentes:CONCILIACION_NOCTURNA',
    });

    await expect(
      useCase.runPartition({
        dominio: 'educacion.gob.ec',
        orgUnitPath: '/Docentes',
        tipoProceso: 'CONCILIACION_NOCTURNA',
      }),
    ).rejects.toBeInstanceOf(PartitionAlreadyActiveConflictError);
  });

  it('rescata partición huérfana (heartbeat_en > 15 min), omite cuentas con hash_payload_gws idéntico, actualiza solo las modificadas y ejecuta runAllActiveDomainPartitions', async () => {
    const { useCase, batchRepository, gwsDirectory, auditWriter } = buildHarness();

    const unchangedHash = hashPayloadGws(sampleProfileUnchanged);

    batchRepository.findOrCreatePartitionCheckpoint.mockResolvedValue({
      rescatadaDeHuerfana: true,
      checkpoint: {
        checkpointId: 'cp-orphan-001',
        dominio: 'educacion.gob.ec',
        orgUnitPath: '/Docentes',
        tipoProceso: 'CONCILIACION_NOCTURNA',
        nextPageToken: 'page-token-3',
        cuentasProcesadas: 1000,
        cuentasActualizadas: 40,
        cuentasOmitidasHash: 960,
        cuentasBajaDetectadas: 0,
        anomaliasAbiertas: 0,
        estadoEjecucion: 'EN_PROGRESO',
        workerInstanciaId: 'worker-rescuer',
        lockAdvisoryKey: '123456789',
        heartbeatEn: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        iniciadoEn: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        completadoEn: null,
        ultimoErrorCodigo: null,
        diagnosticoOperativo: null,
        esParticionHuerfana: true,
      },
    });

    gwsDirectory.listUsersReadOnly.mockResolvedValue({
      users: [sampleProfileUnchanged, sampleProfileChanged],
      nextPageToken: null,
    });

    batchRepository.getExistingHashesByGoogleSubIds.mockResolvedValue(
      new Map<string, string | null>([
        ['sub-batch-001', unchangedHash],
        ['sub-batch-002', 'old-different-hash'],
      ]),
    );

    batchRepository.processPageChangedProfiles.mockResolvedValue({
      actualizados: 1,
      omitidosSinCambios: 0,
      anomaliasAbiertas: 0,
      fallosDlq: 0,
    });

    batchRepository.savePageCheckpoint.mockImplementation(async (cmd) => ({
      checkpointId: cmd.checkpointId,
      dominio: 'educacion.gob.ec',
      orgUnitPath: '/Docentes',
      tipoProceso: 'CONCILIACION_NOCTURNA',
      nextPageToken: cmd.nextPageToken,
      cuentasProcesadas: 1000 + cmd.deltaProcesados,
      cuentasActualizadas: 40 + cmd.deltaActualizados,
      cuentasOmitidasHash: 960 + cmd.deltaOmitidosSinCambios,
      cuentasBajaDetectadas: 0,
      anomaliasAbiertas: cmd.deltaAnomaliasAbiertas,
      estadoEjecucion: cmd.estadoEjecucion,
      workerInstanciaId: 'worker-rescuer',
      lockAdvisoryKey: '123456789',
      heartbeatEn: new Date().toISOString(),
      iniciadoEn: new Date().toISOString(),
      completadoEn: cmd.completadoEn ?? null,
      ultimoErrorCodigo: null,
      diagnosticoOperativo: null,
      esParticionHuerfana: false,
    }));

    const result = await useCase.runPartition({
      dominio: 'educacion.gob.ec',
      orgUnitPath: '/Docentes',
      tipoProceso: 'CONCILIACION_NOCTURNA',
    });

    expect(result.rescatadaDeHuerfana).toBe(true);
    expect(result.reanudadoDesdeToken).toBe('page-token-3');
    expect(result.estadoEjecucion).toBe('COMPLETADO');
    expect(result.totalProcesados).toBe(1002);
    expect(result.totalActualizados).toBe(41);
    expect(result.totalOmitidosSinCambios).toBe(961);
    expect(batchRepository.processPageChangedProfiles).toHaveBeenCalledWith(
      [sampleProfileChanged],
      'educacion.gob.ec',
      'CONCILIACION_NOCTURNA',
    );
    expect(auditWriter.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoEvento: 'CONCILIACION_PARTICION_RECLAMADA',
      }),
    );

    const allResults = await useCase.runAllActiveDomainPartitions('CONCILIACION_NOCTURNA');
    expect(allResults).toHaveLength(1);
  });

  it('ejercita AlloyDbBatchReconciliationRepository (checkpoints, rescate huérfano, perfiles modificados/suspendidos y DLQ)', async () => {
    const sqlExecutor: SqlQueryExecutor = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    const checkpointRepo: jest.Mocked<ICheckpointRepositoryPort> = {
      findByPartition: jest.fn(),
      listCheckpoints: jest.fn(),
      upsertCheckpoint: jest.fn().mockImplementation(async (cp) => cp),
    };

    const syncIdentityRepo: jest.Mocked<ISyncIdentityRepositoryPort> = {
      isDomainActive: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      listActiveDomains: jest.fn().mockResolvedValue(['educacion.gob.ec']),
      findAccountSyncMetadata: jest
        .fn()
        .mockResolvedValueOnce({
          cuentaId: 'c1',
          idInterno: 'p1',
          googleSubId: 'sub-batch-001',
          emailPrincipal: 'sin.cambio@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
          estadoSincronizacion: 'SINCRONIZADA',
          hashPayloadGws: 'hash-1',
          ultimaSincronizacionEn: new Date().toISOString(),
        })
        .mockResolvedValueOnce(null),
      countActiveAccountsForPerson: jest.fn(),
      upsertSyncedIdentity: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: 'SIN_CAMBIOS_HASH',
          idInternoPersona: 'p1',
          cuentaId: 'c1',
          googleSubId: 'sub-batch-001',
          emailPrincipal: 'sin.cambio@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
          estadoPersona: 'ACTIVA',
          estadoCuenta: 'SINCRONIZADA',
          otherActiveAccountsCount: 0,
          requiresCacheInvalidation: false,
          anomaliasGeneradasIds: [],
        })
        .mockResolvedValueOnce({
          outcome: 'APLICADO',
          idInternoPersona: 'p2',
          cuentaId: 'c2',
          googleSubId: 'sub-batch-002',
          emailPrincipal: 'con.cambio@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
          estadoPersona: 'ACTIVA',
          estadoCuenta: 'SUSPENDIDA_GWS',
          otherActiveAccountsCount: 0,
          requiresCacheInvalidation: true,
          anomaliasGeneradasIds: ['anom-1'],
        })
        .mockRejectedValueOnce(new Error('DB constraint failure')),
      applyAccountLifecycleChange: jest.fn(),
      deactivatePersonCascade: jest.fn(),
      reconcileOrMergeHotIdentity: jest.fn(),
    };

    const lifecycleUseCase = {
      execute: jest.fn().mockResolvedValue({}),
    } as unknown as HandleAccountLifecycleChangeUseCase;

    const dlqUseCase = {
      execute: jest.fn().mockResolvedValue({}),
    } as unknown as RecordSyncFailureDlqUseCase;

    const repo = new AlloyDbBatchReconciliationRepository(
      sqlExecutor,
      checkpointRepo,
      syncIdentityRepo,
      lifecycleUseCase,
      dlqUseCase,
    );

    expect(await repo.listActiveDomains()).toEqual([
      { dominio: 'educacion.gob.ec', activo: true },
    ]);
    expect(await repo.findDomainByName('EDUCACION.gob.ec')).toEqual({
      dominio: 'educacion.gob.ec',
      activo: true,
    });
    expect(await repo.findDomainByName('inactivo.gob.ec')).toBeNull();

    // Active checkpoint throws conflict
    checkpointRepo.findByPartition.mockResolvedValueOnce({
      checkpointId: 'cp-active',
      dominio: 'educacion.gob.ec',
      orgUnitPath: '/',
      tipoProceso: 'CONCILIACION_NOCTURNA',
      nextPageToken: 't1',
      cuentasProcesadas: 10,
      cuentasActualizadas: 2,
      cuentasOmitidasHash: 8,
      cuentasBajaDetectadas: 0,
      anomaliasAbiertas: 0,
      estadoEjecucion: 'EN_PROGRESO',
      workerInstanciaId: 'w1',
      lockAdvisoryKey: '111',
      heartbeatEn: new Date().toISOString(),
      iniciadoEn: new Date().toISOString(),
      completadoEn: null,
      ultimoErrorCodigo: null,
      diagnosticoOperativo: null,
    });
    await expect(
      repo.findOrCreatePartitionCheckpoint(
        'educacion.gob.ec',
        '/',
        'CONCILIACION_NOCTURNA',
        '111',
        false,
      ),
    ).rejects.toBeInstanceOf(PartitionAlreadyActiveConflictError);

    // Orphan checkpoint rescued
    checkpointRepo.findByPartition.mockResolvedValueOnce({
      checkpointId: 'cp-orphan',
      dominio: 'educacion.gob.ec',
      orgUnitPath: '/',
      tipoProceso: 'CONCILIACION_NOCTURNA',
      nextPageToken: 'tok-orphan',
      cuentasProcesadas: 10,
      cuentasActualizadas: 2,
      cuentasOmitidasHash: 8,
      cuentasBajaDetectadas: 0,
      anomaliasAbiertas: 0,
      estadoEjecucion: 'EN_PROGRESO',
      workerInstanciaId: 'w1',
      lockAdvisoryKey: '111',
      heartbeatEn: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      iniciadoEn: new Date().toISOString(),
      completadoEn: null,
      ultimoErrorCodigo: null,
      diagnosticoOperativo: null,
    });
    const rescued = await repo.findOrCreatePartitionCheckpoint(
      'educacion.gob.ec',
      '/',
      'CONCILIACION_NOCTURNA',
      '111',
      false,
    );
    expect(rescued.rescatadaDeHuerfana).toBe(true);
    expect(rescued.checkpoint.nextPageToken).toBe('tok-orphan');

    const hashes = await repo.getExistingHashesByGoogleSubIds([
      'sub-batch-001',
      'sub-batch-002',
    ]);
    expect(hashes.get('sub-batch-001')).toBe('hash-1');

    // Process 3 profiles: 1 unchanged, 1 suspended/expired, 1 throwing error -> DLQ
    const summary = await repo.processPageChangedProfiles(
      [
        sampleProfileUnchanged,
        {
          ...sampleProfileChanged,
          suspended: true,
          customSchemas: {
            MINEDEC_Perfil: { fechaFinVigencia: '2020-01-01' },
          },
        },
        {
          ...sampleProfileChanged,
          id: 'sub-err-3',
          googleSubId: 'sub-err-3',
        },
      ],
      'educacion.gob.ec',
      'CONCILIACION_NOCTURNA',
    );
    expect(summary.omitidosSinCambios).toBe(1);
    expect(summary.actualizados).toBe(1);
    expect(summary.anomaliasAbiertas).toBe(1);
    expect(summary.fallosDlq).toBe(1);

    const savedCp = await repo.savePageCheckpoint({
      checkpointId: 'cp-orphan',
      nextPageToken: null,
      deltaProcesados: 3,
      deltaActualizados: 1,
      deltaOmitidosSinCambios: 1,
      deltaAnomaliasAbiertas: 1,
      deltaFallosDlq: 1,
      estadoEjecucion: 'COMPLETADO',
      completadoEn: new Date().toISOString(),
    });
    expect(savedCp.cuentasProcesadas).toBe(13);

    await repo.updateHeartbeat('cp-orphan');
    expect(sqlExecutor.query).toHaveBeenCalled();
  });

  it('instrumenta executeConciliacionJobFromEnv con withOtelSpan("conciliacion-job.run") en Cloud Run Job', async () => {
    const spans: OtelSpanTelemetry[] = [];
    const mockResult: ResultadoEjecucionParticion = {
      checkpointId: 'chk-001',
      dominio: 'educacion.gob.ec',
      orgUnitPath: '/Docentes',
      tipoProceso: 'CONCILIACION_NOCTURNA',
      estadoEjecucion: 'COMPLETADO',
      paginasProcesadas: 2,
      totalProcesados: 40,
      totalActualizados: 5,
      totalOmitidosSinCambios: 35,
      totalAnomaliasAbiertas: 0,
      totalFallosDlq: 0,
      rescatadaDeHuerfana: false,
      reanudadoDesdeToken: null,
      iniciadoEn: new Date().toISOString(),
      completadoEn: new Date().toISOString(),
      diagnosticoNatural: 'Partición completada sin anomalías.',
    };

    const results = await executeConciliacionJobFromEnv(
      {
        SYNC_DOMINIO: 'educacion.gob.ec',
        SYNC_ORG_UNIT_PATH: '/Docentes',
        SYNC_TIPO_PROCESO: 'CONCILIACION_NOCTURNA',
        TRACE_ID: '4bf92f3577b34da6a3ce929d0e0e4736',
      },
      {
        onSpanEnd: (span) => spans.push(span),
        runner: {
          runPartition: async () => mockResult,
          runAllActiveDomainPartitions: async () => [mockResult],
        },
      },
    );

    expect(results).toHaveLength(1);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('conciliacion-job.run');
    expect(spans[0]!.status).toBe('OK');

    const allResults = await executeConciliacionJobFromEnv(
      {},
      {
        runner: {
          runPartition: async () => mockResult,
          runAllActiveDomainPartitions: async () => [mockResult],
        },
      },
    );
    expect(allResults).toHaveLength(1);
  });
});
