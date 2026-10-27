import { SyncQuotaGovernor } from '@minedec/shared';
import {
  IGoogleDirectoryReadOnlyPort,
  IProcessedEventRepositoryPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
  ReconcileHotRegistrationUseCase,
} from '../../src';

describe('T038 - ReconcileHotRegistrationUseCase (Promoción In-Place, Fusión Atómica y Retención sin ID válido)', () => {
  const createMocks = () => {
    const gwsPort: jest.Mocked<IGoogleDirectoryReadOnlyPort> = {
      getUserReadOnly: jest.fn(),
      listUsersReadOnly: jest.fn(),
    };

    const syncIdentityRepo: jest.Mocked<ISyncIdentityRepositoryPort> = {
      isDomainActive: jest.fn().mockResolvedValue(true),
      listActiveDomains: jest.fn().mockResolvedValue(['educacion.gob.ec']),
      findAccountSyncMetadata: jest.fn(),
      countActiveAccountsForPerson: jest.fn().mockResolvedValue(0),
      upsertSyncedIdentity: jest.fn(),
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
        invalidatedKeysCount: 3,
        pubSubPublished: true,
      }),
      invalidatePersonCascadeScope: jest.fn().mockResolvedValue({
        invalidatedKeysCount: 3,
        pubSubPublished: true,
      }),
    };

    const quotaGovernor = {
      tryAcquire: jest.fn().mockResolvedValue({
        allowed: true,
        category: 'HOT_REGISTRATION',
        currentGlobalRps: 2,
        currentBucketRps: 1,
        allocatedLimitRps: 5,
        retryAfterMs: 0,
        batchJobActive: false,
      }),
    } as unknown as SyncQuotaGovernor;

    const useCase = new ReconcileHotRegistrationUseCase(
      gwsPort,
      syncIdentityRepo,
      processedEventRepo,
      cacheInvalidator,
      quotaGovernor,
    );

    return {
      useCase,
      gwsPort,
      syncIdentityRepo,
      processedEventRepo,
      cacheInvalidator,
      quotaGovernor,
    };
  };

  it('Escenario 1 (Promoción In-Place): promueve a ACTIVA cuando el documento oficial no existe previamente', async () => {
    const { useCase, gwsPort, syncIdentityRepo, cacheInvalidator, processedEventRepo } =
      createMocks();

    gwsPort.getUserReadOnly.mockResolvedValue({
      id: 'sub-hot-001',
      googleSubId: 'sub-hot-001',
      primaryEmail: 'docente.nuevo@educacion.gob.ec',
      name: {
        givenName: 'Carlos',
        familyName: 'Mendoza',
        fullName: 'Carlos Mendoza',
      },
      suspended: false,
      archived: false,
      orgUnitPath: '/Docentes',
      customSchemas: {
        MINEDEC_Perfil: {
          tipo_identificacion: 'CEDULA',
          numero_identificacion: '1710034065',
          regimen_laboral: 'LOEI',
        },
      },
    });

    syncIdentityRepo.reconcileOrMergeHotIdentity.mockResolvedValue({
      action: 'PROMOTED_IN_PLACE',
      idInternoDefinitivo: '11111111-2222-4333-8444-555555555555',
      cuentaId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      estadoPersona: 'ACTIVA',
      estadoCuenta: 'ACTIVA',
    });

    const result = await useCase.execute({
      idEventoExterno: 'hot-evt-001',
      googleSubId: 'sub-hot-001',
      emailPrincipal: 'docente.nuevo@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      traceId: 'trace-hot-001',
    });

    expect(result.action).toBe('PROMOTED_IN_PLACE');
    expect(result.resultado).toBe('APLICADO');
    expect(result.estadoPersonaResultante).toBe('ACTIVA');
    expect(result.estadoCuentaResultante).toBe('ACTIVA');
    expect(result.idInternoProvisionalEliminado).toBeUndefined();
    expect(cacheInvalidator.invalidateAccountScope).toHaveBeenCalledWith(
      expect.objectContaining({
        idInternoPersona: '11111111-2222-4333-8444-555555555555',
        googleSubId: 'sub-hot-001',
        motivo: 'HOT_REGISTRATION_PROMOTED_IN_PLACE',
      }),
    );
    expect(processedEventRepo.recordProcessedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        idEventoExterno: 'hot-evt-001',
        origenCanal: 'CLOUD_TASKS_PRIORITY',
        resultado: 'PROCESADO',
      }),
    );
  });

  it('Escenario 2 (Fusión / Re-vinculación Atómica): re-vincula CuentaInstitucional a PersonaIdentidad existente y elimina provisional huérfano', async () => {
    const { useCase, gwsPort, syncIdentityRepo, cacheInvalidator } = createMocks();

    gwsPort.getUserReadOnly.mockResolvedValue({
      id: 'sub-hot-002',
      googleSubId: 'sub-hot-002',
      primaryEmail: 'maria.loja@educacion.gob.ec',
      name: {
        givenName: 'María',
        familyName: 'Loja',
        fullName: 'María Loja',
      },
      suspended: false,
      archived: false,
      orgUnitPath: '/Docentes',
      customSchemas: {
        MINEDEC_Perfil: {
          tipo_identificacion: 'CEDULA',
          numero_identificacion: '0912345678',
          regimen_laboral: 'LOEI',
        },
      },
    });

    const existingPersonId = '99999999-8888-4777-8666-555555555555';
    const removedProvisionalId = '22222222-3333-4444-8555-666666666666';

    syncIdentityRepo.reconcileOrMergeHotIdentity.mockResolvedValue({
      action: 'MERGED_INTO_EXISTING',
      idInternoDefinitivo: existingPersonId,
      idInternoProvisionalEliminado: removedProvisionalId,
      cuentaId: 'cccccccc-dddd-4eee-8fff-000000000000',
      estadoPersona: 'ACTIVA',
      estadoCuenta: 'ACTIVA',
    });

    const result = await useCase.execute({
      idEventoExterno: 'hot-evt-002',
      googleSubId: 'sub-hot-002',
      emailPrincipal: 'maria.loja@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      traceId: 'trace-hot-002',
    });

    expect(result.action).toBe('MERGED_INTO_EXISTING');
    expect(result.idInternoPersona).toBe(existingPersonId);
    expect(result.idInternoProvisionalEliminado).toBe(removedProvisionalId);
    expect(result.resultado).toBe('APLICADO');
    expect(cacheInvalidator.invalidateAccountScope).toHaveBeenCalledWith(
      expect.objectContaining({
        idInternoPersona: existingPersonId,
        motivo: 'HOT_REGISTRATION_MERGED_INTO_EXISTING',
      }),
    );
  });

  it('Escenario 3 (Sin Identificación Válida): conserva PENDIENTE_CONCILIACION y genera anomalía SIN_IDENTIFICACION_VALIDA', async () => {
    const { useCase, gwsPort, syncIdentityRepo } = createMocks();

    gwsPort.getUserReadOnly.mockResolvedValue({
      id: 'sub-hot-003',
      googleSubId: 'sub-hot-003',
      primaryEmail: 'sin.cedula@educacion.gob.ec',
      name: {
        givenName: 'Usuario',
        familyName: 'SinCedula',
        fullName: 'Usuario SinCedula',
      },
      suspended: false,
      archived: false,
      orgUnitPath: '/Administrativos',
      customSchemas: {},
    });

    syncIdentityRepo.reconcileOrMergeHotIdentity.mockResolvedValue({
      action: 'KEPT_PENDING_NO_VALID_ID',
      idInternoDefinitivo: '33333333-4444-4555-8666-777777777777',
      cuentaId: 'dddddddd-eeee-4fff-8000-111111111111',
      estadoPersona: 'PENDIENTE_CONCILIACION',
      estadoCuenta: 'ACTIVA',
      anomaliaId: 'anom-sin-id-001',
    });

    const result = await useCase.execute({
      idEventoExterno: 'hot-evt-003',
      googleSubId: 'sub-hot-003',
      emailPrincipal: 'sin.cedula@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      traceId: 'trace-hot-003',
    });

    expect(result.action).toBe('KEPT_PENDING_NO_VALID_ID');
    expect(result.resultado).toBe('ANOMALIA_REGISTRADA');
    expect(result.estadoPersonaResultante).toBe('PENDIENTE_CONCILIACION');
    expect(result.anomaliasGeneradasIds).toEqual(['anom-sin-id-001']);
  });
});
