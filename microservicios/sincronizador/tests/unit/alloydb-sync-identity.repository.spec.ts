import {
  AuditEventWriter,
  DatabaseTransactionManager,
  GwsDirectoryUserRecord,
  SqlQueryExecutor,
} from '@minedec/shared';
import {
  AlloyDbSyncIdentityRepository,
} from '../../src';

describe('AlloyDbSyncIdentityRepository - Persistencia Transaccional de Identidades Sincronizadas', () => {
  const sampleProfileUnchanged: GwsDirectoryUserRecord = {
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

  const sampleProfileChanged: GwsDirectoryUserRecord = {
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

  it('ejercita AlloyDbSyncIdentityRepository (upsert directo, colisión de CEDULA, ciclo de vida, cascada y reconcileOrMergeHotIdentity)', async () => {
    const mockQuery = jest.fn();
    const mockTxManager = {
      query: mockQuery,
      withTransaction: async <T>(fn: (tx: SqlQueryExecutor) => Promise<T>): Promise<T> =>
        fn({ query: mockQuery }),
    } as unknown as DatabaseTransactionManager;

    const mockAudit = {
      appendEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditEventWriter;

    const repo = new AlloyDbSyncIdentityRepository(mockTxManager, mockAudit);

    // 1. isDomainActive & listActiveDomains
    mockQuery
      .mockResolvedValueOnce({ rows: [{ activo: true }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ dominio: 'EDUCACION.gob.ec' }],
        rowCount: 1,
      });
    expect(await repo.isDomainActive('educacion.gob.ec')).toBe(true);
    expect(await repo.listActiveDomains()).toEqual(['educacion.gob.ec']);

    // 2. upsertSyncedIdentity when hash matches (SIN_CAMBIOS_HASH)
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            cuenta_id: 'c-1',
            id_interno: 'p-1',
            google_sub_id: 'sub-1',
            email_principal: 'u1@educacion.gob.ec',
            dominio: 'educacion.gob.ec',
            estado_sincronizacion: 'SINCRONIZADA',
            hash_payload_gws: 'same-hash',
            ultima_sincronizacion_en: new Date(),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });

    const unchangedRes = await repo.upsertSyncedIdentity({
      idEventoExterno: 'evt-1',
      gwsUser: sampleProfileUnchanged,
      hashPayloadGws: 'same-hash',
      origenCanal: 'SYNC_INCREMENTAL',
      modoDespacho: 'INDIVIDUAL_GET',
      traceId: 't-1',
    });
    expect(unchangedRes.outcome).toBe('SIN_CAMBIOS_HASH');

    // 3. upsertSyncedIdentity direct transaction with CEDULA mutation attempt
    mockQuery
      // findAccountSyncMetadata -> null by sub, found by email with old hash
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            cuenta_id: 'c-2',
            id_interno: 'p-2',
            google_sub_id: 'sub-2',
            email_principal: 'u2@educacion.gob.ec',
            dominio: 'educacion.gob.ec',
            estado_sincronizacion: 'SINCRONIZADA',
            hash_payload_gws: 'old-hash',
            ultima_sincronizacion_en: '2026-10-19T00:00:00Z',
          },
        ],
        rowCount: 1,
      })
      // Inside withTransaction:
      // SELECT cuenta_institucional
      .mockResolvedValueOnce({
        rows: [
          {
            cuenta_id: 'c-2',
            id_interno: 'p-2',
            google_sub_id: 'sub-2',
            email_principal: 'u2@educacion.gob.ec',
            dominio: 'educacion.gob.ec',
            estado_sincronizacion: 'SINCRONIZADA',
          },
        ],
        rowCount: 1,
      })
      // SELECT persona_identidad (existing consolidated CEDULA differs!)
      .mockResolvedValueOnce({
        rows: [
          {
            tipo_identificacion: 'CEDULA',
            numero_identificacion: '1710034065',
          },
        ],
        rowCount: 1,
      })
      // INSERT anomalia_identidad (COLISION_IDENTIFICADOR)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // INSERT persona_identidad
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // INSERT cuenta_institucional
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // countActiveAccountsForPerson
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });

    const collisionRes = await repo.upsertSyncedIdentity({
      idEventoExterno: 'evt-2',
      gwsUser: {
        ...sampleProfileChanged,
        customSchemas: {
          MINEDEC_Perfil: {
            tipoIdentificacion: 'CEDULA',
            numeroIdentificacion: '0910000000',
            tipoUsuario: 'DOCENTE',
            codigoInstitucion: '17H00123',
          },
        },
      },
      hashPayloadGws: 'new-hash',
      origenCanal: 'SYNC_INCREMENTAL',
      modoDespacho: 'INDIVIDUAL_GET',
      traceId: 't-2',
    });
    expect(collisionRes.outcome).toBe('ANOMALIA_REGISTRADA');
    expect(collisionRes.estadoPersona).toBe('BLOQUEADA_ANOMALIA');

    // 4. applyAccountLifecycleChange (not found & found)
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // Second call: found
      .mockResolvedValueOnce({
        rows: [
          {
            cuenta_id: 'c-2',
            id_interno: 'p-2',
            google_sub_id: 'sub-2',
            email_principal: 'u2@educacion.gob.ec',
            dominio: 'educacion.gob.ec',
            estado_sincronizacion: 'SINCRONIZADA',
            hash_payload_gws: 'h',
            ultima_sincronizacion_en: new Date(),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ estado_persona: 'ACTIVA' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const lcNotFound = await repo.applyAccountLifecycleChange({
      googleSubId: 'sub-missing',
      nuevoEstadoCuenta: 'SUSPENDIDA_GWS',
      motivo: 'test',
      origenCanal: 'SYNC_INCREMENTAL',
      traceId: 't-lc-1',
    });
    expect(lcNotFound.found).toBe(false);

    const lcFound = await repo.applyAccountLifecycleChange({
      googleSubId: 'sub-2',
      nuevoEstadoCuenta: 'SUSPENDIDA_GWS',
      motivo: 'test',
      origenCanal: 'SYNC_INCREMENTAL',
      traceId: 't-lc-2',
    });
    expect(lcFound.found).toBe(true);
    expect(lcFound.estadoPersonaResultante).toBe('INACTIVA');

    // 5. deactivatePersonCascade (not found & found)
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // Second call: found
      .mockResolvedValueOnce({
        rows: [
          {
            id_interno: 'p-2',
            tipo_identificacion: 'CEDULA',
            numero_identificacion: '1710034065',
            estado_persona: 'ACTIVA',
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            cuenta_id: 'c-2',
            google_sub_id: 'sub-2',
            email_principal: 'u2@educacion.gob.ec',
            dominio: 'educacion.gob.ec',
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    expect(
      await repo.deactivatePersonCascade({
        idInterno: 'p-missing',
        nuevoEstadoPersona: 'INACTIVA',
        motivoDesactivacion: 'test',
        adminIdentificacion: 'admin',
        traceId: 't-cas-1',
      }),
    ).toBeNull();

    const cascadeRes = await repo.deactivatePersonCascade({
      idInterno: 'p-2',
      nuevoEstadoPersona: 'BLOQUEADA_ANOMALIA',
      motivoDesactivacion: 'test',
      adminIdentificacion: 'admin',
      traceId: 't-cas-2',
    });
    expect(cascadeRes?.cuentasDesactivadas).toHaveLength(1);

    // 6. reconcileOrMergeHotIdentity (null user, merge into existing, promote in place)
    mockQuery
      // null user -> keepPendingWithoutValidId:
      // SELECT cuenta_institucional -> not found
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // INSERT persona_identidad
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // INSERT cuenta_institucional
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // INSERT anomalia_identidad
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const hotPending = await repo.reconcileOrMergeHotIdentity({
      idEventoExterno: 'evt-hot-1',
      googleSubId: 'sub-hot-1',
      emailPrincipal: 'hot1@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      gwsUser: null,
      hashPayloadGws: null,
      traceId: 't-hot-1',
    });
    expect(hotPending.action).toBe('KEPT_PENDING_NO_VALID_ID');

    // Merge into existing PersonaIdentidad
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ cuenta_id: 'c-hot-2', id_interno: 'p-provisional-2' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id_interno: 'p-existing-consolidated' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const hotMerged = await repo.reconcileOrMergeHotIdentity({
      idEventoExterno: 'evt-hot-2',
      googleSubId: 'sub-hot-2',
      emailPrincipal: 'hot2@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      gwsUser: {
        ...sampleProfileChanged,
        customSchemas: {
          MINEDEC_Perfil: {
            tipoIdentificacion: 'CEDULA',
            numeroIdentificacion: '1710034065',
            tipoUsuario: 'DOCENTE',
            codigoInstitucion: '17H00123',
          },
        },
      },
      hashPayloadGws: 'hash-hot-2',
      traceId: 't-hot-2',
    });
    expect(hotMerged.action).toBe('MERGED_INTO_EXISTING');
    expect(hotMerged.idInternoDefinitivo).toBe('p-existing-consolidated');

    // Promote in place
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ cuenta_id: 'c-hot-3', id_interno: 'p-provisional-3' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const hotPromoted = await repo.reconcileOrMergeHotIdentity({
      idEventoExterno: 'evt-hot-3',
      googleSubId: 'sub-hot-3',
      emailPrincipal: 'hot3@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      gwsUser: {
        ...sampleProfileChanged,
        customSchemas: {
          MINEDEC_Perfil: {
            tipoIdentificacion: 'CEDULA',
            numeroIdentificacion: '1710034065',
            tipoUsuario: 'DOCENTE',
            codigoInstitucion: '17H00123',
          },
        },
      },
      hashPayloadGws: 'hash-hot-3',
      traceId: 't-hot-3',
    });
    expect(hotPromoted.action).toBe('PROMOTED_IN_PLACE');

    // 7. Delegate path (IUpsertDirectoryIdentityDelegate) + new account + reactivation
    const mockDelegate = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({
          idInterno: 'p-del-1',
          cuentaId: 'c-del-1',
          estadoPersona: 'ACTIVA',
          estadoSincronizacion: 'SUSPENDIDA_GWS',
          cacheInvalidated: true,
          anomaliasAbiertas: [],
        })
        .mockRejectedValueOnce(new Error('Fatal delegate DB error')),
    };

    const repoWithDelegate = new AlloyDbSyncIdentityRepository(
      mockTxManager,
      mockAudit,
      mockDelegate,
    );

    mockQuery
      // findAccountSyncMetadata -> null by sub, null by email
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // UPDATE cuenta_institucional hash_payload_gws
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // countActiveAccountsForPerson -> 0
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      // UPDATE persona_identidad estado_persona = INACTIVA
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const delRes = await repoWithDelegate.upsertSyncedIdentity({
      idEventoExterno: 'evt-del-1',
      gwsUser: {
        ...sampleProfileChanged,
        suspended: true,
        customSchemas: {
          MINEDEC_Perfil: {
            tipoUsuario: 'ESTUDIANTE_BACHILLERATO' as never,
          },
        },
      },
      hashPayloadGws: 'hash-del-1',
      origenCanal: 'SYNC_BATCH_JOB',
      modoDespacho: 'LOTE_LIST_500',
      traceId: 't-del-1',
    });
    expect(delRes.outcome).toBe('APLICADO');
    expect(delRes.estadoPersona).toBe('INACTIVA');

    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(
      repoWithDelegate.upsertSyncedIdentity({
        idEventoExterno: 'evt-del-err',
        gwsUser: sampleProfileChanged,
        hashPayloadGws: 'hash-del-err',
        origenCanal: 'SYNC_INCREMENTAL',
        modoDespacho: 'INDIVIDUAL_GET',
        traceId: 't-del-err',
      }),
    ).rejects.toThrow('Fatal delegate DB error');

    // Direct transaction for new account matching existing person by doc + suspended + reactivation
    mockQuery
      // findAccountSyncMetadata -> null by sub, null by email
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // SELECT cuenta_institucional -> empty
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // SELECT persona_identidad by numero_identificacion -> found
      .mockResolvedValueOnce({ rows: [{ id_interno: 'p-by-doc-1' }], rowCount: 1 })
      // INSERT persona_identidad
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // INSERT cuenta_institucional
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // INSERT anomalia_identidad (non-blocking)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // countActiveAccountsForPerson -> 0
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      // UPDATE persona_identidad INACTIVA
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const newAccRes = await repo.upsertSyncedIdentity({
      idEventoExterno: 'evt-new-acc',
      gwsUser: {
        ...sampleProfileChanged,
        suspended: true,
        customSchemas: {
          MINEDEC_Perfil: {
            tipoIdentificacion: 'CEDULA',
            numeroIdentificacion: '1710034065',
            tipoUsuario: 'ADMINISTRATIVO_CENTRAL' as never,
            regimenLaboral: 'LOSEP',
            codigoUnidadAdministrativa: '',
          },
        },
      },
      hashPayloadGws: 'hash-new-acc',
      origenCanal: 'SYNC_BATCH_JOB',
      modoDespacho: 'LOTE_LIST_500',
      deletedEnGws: true,
      traceId: 't-new-acc',
    });
    expect(newAccRes.idInternoPersona).toBe('p-by-doc-1');
    expect(newAccRes.estadoCuenta).toBe('ELIMINADA_GWS');

    // Reactivation via applyAccountLifecycleChange
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            cuenta_id: 'c-2',
            id_interno: 'p-2',
            google_sub_id: 'sub-2',
            email_principal: 'u2@educacion.gob.ec',
            dominio: 'educacion.gob.ec',
            estado_sincronizacion: 'SUSPENDIDA_GWS',
            hash_payload_gws: 'h',
            ultima_sincronizacion_en: new Date(),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ estado_persona: 'INACTIVA' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const lcReactivated = await repo.applyAccountLifecycleChange({
      googleSubId: 'sub-2',
      nuevoEstadoCuenta: 'SINCRONIZADA',
      motivo: 'reactivacion',
      origenCanal: 'SYNC_INCREMENTAL',
      traceId: 't-lc-react',
    });
    expect(lcReactivated.estadoPersonaResultante).toBe('ACTIVA');
  });
});
