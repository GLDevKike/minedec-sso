import request from 'supertest';
import { InMemoryRateGovernorStore, SyncQuotaGovernor } from '@minedec/shared';
import {
  createSincronizadorHttpApp,
  IGoogleDirectoryReadOnlyPort,
  ISyncCacheInvalidatorPort,
  ISyncIdentityRepositoryPort,
} from '../../src';

describe('T039 - Integración End-to-End de Registro en Caliente y Reconciliación Prioritaria (< 10 s p95)', () => {
  it('reconcilia la tarea prioritaria en POST /internal/v1/sync/tasks/priority-hot-registration invalidando caché L2', async () => {
    const taskPayload = {
      googleSubId: 'sub-hot-999',
      emailPrincipal: 'elena.vintimilla@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      provisionalIdInterno: '44444444-5555-4666-8777-888888888888',
      requestedAt: new Date().toISOString(),
    };

    const gwsPort: jest.Mocked<IGoogleDirectoryReadOnlyPort> = {
      getUserReadOnly: jest.fn().mockResolvedValue({
        id: 'sub-hot-999',
        googleSubId: 'sub-hot-999',
        primaryEmail: 'elena.vintimilla@educacion.gob.ec',
        name: {
          givenName: 'Elena',
          familyName: 'Vintimilla',
          fullName: 'Elena Vintimilla',
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
      }),
      listUsersReadOnly: jest.fn(),
    };

    const syncIdentityRepo: Partial<ISyncIdentityRepositoryPort> = {
      reconcileOrMergeHotIdentity: jest.fn().mockResolvedValue({
        action: 'MERGED_INTO_EXISTING',
        idInternoDefinitivo: '10101010-2020-4303-8404-505050505050',
        idInternoProvisionalEliminado: '44444444-5555-4666-8777-888888888888',
        cuentaId: '55555555-6666-4777-8888-999999999999',
        estadoPersona: 'ACTIVA',
        estadoCuenta: 'ACTIVA',
      }),
    };

    const invalidatedCalls: unknown[] = [];
    const cacheInvalidator: ISyncCacheInvalidatorPort = {
      invalidateAccountScope: jest.fn().mockImplementation(async (scope) => {
        invalidatedCalls.push(scope);
        return {
          invalidatedKeysCount: 4,
          pubSubPublished: true,
        };
      }),
      invalidatePersonCascadeScope: jest.fn().mockResolvedValue({
        invalidatedKeysCount: 4,
        pubSubPublished: true,
      }),
    };

    const app = createSincronizadorHttpApp({
      quotaGovernor: new SyncQuotaGovernor(new InMemoryRateGovernorStore()),
      gwsDirectoryPort: gwsPort,
      syncIdentityRepo: syncIdentityRepo as ISyncIdentityRepositoryPort,
      cacheInvalidator,
    });

    const response = await request(app)
      .post('/internal/v1/sync/tasks/priority-hot-registration')
      .set('x-trace-id', 'trace-e2e-hot-999')
      .send({
        idEventoExterno: `HOT_REG:${taskPayload.googleSubId}`,
        googleSubId: taskPayload.googleSubId,
        emailPrincipal: taskPayload.emailPrincipal,
        dominio: taskPayload.dominio,
        solicitadoEn: taskPayload.requestedAt,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      action: 'MERGED_INTO_EXISTING',
      resultado: 'APLICADO',
      idInternoPersona: '10101010-2020-4303-8404-505050505050',
      idInternoProvisionalEliminado: '44444444-5555-4666-8777-888888888888',
      estadoPersonaResultante: 'ACTIVA',
      estadoCuentaResultante: 'ACTIVA',
      cacheInvalidated: true,
    });
    expect(invalidatedCalls).toHaveLength(1);
  });
});
