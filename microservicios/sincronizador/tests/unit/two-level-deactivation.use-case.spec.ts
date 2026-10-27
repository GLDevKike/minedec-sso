import {
  DeactivatePersonCascadeUseCase,
  HandleAccountLifecycleChangeUseCase,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../src';

describe('T030: Baja Lógica Diferenciada en Dos Niveles (PersonaIdentidad vs CuentaInstitucional)', () => {
  function createMocks() {
    const syncIdentityRepo: jest.Mocked<ISyncIdentityRepositoryPort> = {
      isDomainActive: jest.fn().mockResolvedValue(true),
      listActiveDomains: jest.fn().mockResolvedValue(['educacion.gob.ec']),
      findAccountSyncMetadata: jest.fn(),
      countActiveAccountsForPerson: jest.fn(),
      upsertSyncedIdentity: jest.fn(),
      applyAccountLifecycleChange: jest.fn(),
      deactivatePersonCascade: jest.fn(),
      reconcileOrMergeHotIdentity: jest.fn(),
    };

    const cacheInvalidator: jest.Mocked<ISyncCacheInvalidatorPort> = {
      invalidateAccountScope: jest.fn().mockResolvedValue({
        invalidatedKeysCount: 4,
        pubSubPublished: true,
      }),
      invalidatePersonCascadeScope: jest.fn().mockResolvedValue({
        invalidatedKeysCount: 7,
        pubSubPublished: true,
      }),
    };

    return { syncIdentityRepo, cacheInvalidator };
  }

  it('Escenario A (Doble Rol): suspender cuenta de estudiante mantiene PersonaIdentidad ACTIVA si posee cuenta docente activa', async () => {
    const { syncIdentityRepo, cacheInvalidator } = createMocks();
    syncIdentityRepo.applyAccountLifecycleChange.mockResolvedValueOnce({
      found: true,
      idInternoPersona: 'person-dual-role-1',
      cuentaId: 'acc-student-1',
      googleSubId: 'sub-student-1',
      emailPrincipal: 'ana.perez@estudiantes.educacion.gob.ec',
      dominio: 'estudiantes.educacion.gob.ec',
      estadoPersonaResultante: 'ACTIVA',
      estadoCuentaResultante: 'SUSPENDIDA_GWS',
      remainingActiveAccountsCount: 1, // Cuenta docente sigue activa
    });

    const useCase = new HandleAccountLifecycleChangeUseCase(
      syncIdentityRepo,
      cacheInvalidator,
    );

    const result = await useCase.execute({
      googleSubId: 'sub-student-1',
      emailPrincipal: 'ana.perez@estudiantes.educacion.gob.ec',
      tipoEvento: 'SUSPEND_USER',
      origenCanal: 'SYNC_INCREMENTAL',
      motivo: 'Suspensión de cuenta estudiantil por graduación',
      traceId: 'trace-dual-a',
    });

    expect(result.applied).toBe(true);
    expect(result.estadoCuentaResultante).toBe('SUSPENDIDA_GWS');
    expect(result.estadoPersonaResultante).toBe('ACTIVA');
    expect(result.remainingActiveAccountsCount).toBe(1);
    expect(cacheInvalidator.invalidateAccountScope).toHaveBeenCalledTimes(1);
  });

  it('Escenario B (Última Cuenta Activa): suspender o eliminar la única cuenta activa transiciona PersonaIdentidad a INACTIVA', async () => {
    const { syncIdentityRepo, cacheInvalidator } = createMocks();
    syncIdentityRepo.applyAccountLifecycleChange.mockResolvedValueOnce({
      found: true,
      idInternoPersona: 'person-single-1',
      cuentaId: 'acc-docente-1',
      googleSubId: 'sub-docente-1',
      emailPrincipal: 'pedro.solis@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      estadoPersonaResultante: 'INACTIVA',
      estadoCuentaResultante: 'ELIMINADA_GWS',
      remainingActiveAccountsCount: 0,
    });

    const useCase = new HandleAccountLifecycleChangeUseCase(
      syncIdentityRepo,
      cacheInvalidator,
    );

    const result = await useCase.execute({
      googleSubId: 'sub-docente-1',
      emailPrincipal: 'pedro.solis@educacion.gob.ec',
      tipoEvento: 'DELETE_USER',
      origenCanal: 'SYNC_INCREMENTAL',
      motivo: 'Eliminación de cuenta en Google Workspace',
      traceId: 'trace-single-b',
    });

    expect(result.applied).toBe(true);
    expect(result.estadoCuentaResultante).toBe('ELIMINADA_GWS');
    expect(result.estadoPersonaResultante).toBe('INACTIVA');
    expect(result.remainingActiveAccountsCount).toBe(0);
    expect(cacheInvalidator.invalidateAccountScope).toHaveBeenCalledTimes(1);
  });

  it('Escenario C (Baja en Cascada Nivel 1): desactivar PersonaIdentidad inactiva todas sus cuentas y purga caché en todos los subdominios', async () => {
    const { syncIdentityRepo, cacheInvalidator } = createMocks();
    syncIdentityRepo.deactivatePersonCascade.mockResolvedValueOnce({
      idInterno: 'person-dual-role-1',
      tipoIdentificacion: 'CEDULA',
      numeroIdentificacion: '1710034065',
      estadoPersona: 'INACTIVA',
      cuentasDesactivadas: [
        {
          cuentaId: 'acc-docente-1',
          googleSubId: 'sub-docente-1',
          emailPrincipal: 'ana.perez@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
        },
        {
          cuentaId: 'acc-student-1',
          googleSubId: 'sub-student-1',
          emailPrincipal: 'ana.perez@estudiantes.educacion.gob.ec',
          dominio: 'estudiantes.educacion.gob.ec',
        },
      ],
      subdominiosAfectados: ['educacion.gob.ec', 'estudiantes.educacion.gob.ec'],
    });

    const useCase = new DeactivatePersonCascadeUseCase(
      syncIdentityRepo,
      cacheInvalidator,
    );

    const result = await useCase.execute({
      idInterno: 'person-dual-role-1',
      nuevoEstadoPersona: 'INACTIVA',
      adminIdentificacion: '0912345678',
      motivoDesactivacion: 'Desvinculación institucional definitiva certificada por Talento Humano',
      traceId: 'trace-cascade-c',
    });

    expect(result).not.toBeNull();
    expect(result!.estadoPersona).toBe('INACTIVA');
    expect(result!.cuentasDesactivadasCount).toBe(2);
    expect(result!.subdominiosAfectados).toEqual([
      'educacion.gob.ec',
      'estudiantes.educacion.gob.ec',
    ]);
    expect(result!.cacheInvalidated).toBe(true);
    expect(cacheInvalidator.invalidatePersonCascadeScope).toHaveBeenCalledTimes(1);
  });
});
