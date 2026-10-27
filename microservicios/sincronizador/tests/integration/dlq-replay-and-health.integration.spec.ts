import request from 'supertest';
import { InMemoryRateGovernorStore, SyncQuotaGovernor } from '@minedec/shared';
import {
  createSincronizadorHttpApp,
  IDlqRepositoryPort,
  IGoogleDirectoryReadOnlyPort,
  ISyncIdentityRepositoryPort,
  RegistroFalloSincronizacion,
} from '../../src';

describe('T056 - Integración de Bandeja DLQ, Reprocesamiento Selectivo y Salud Operativa Detallada', () => {
  it('lista fallos en GET /api/v1/admin/sync/dlq, reprocesa vigentes en POST /api/v1/admin/sync/dlq/replay y reporta salud en GET /internal/v1/sync/health/detailed', async () => {
    const dlqMap = new Map<string, RegistroFalloSincronizacion>();
    const activeDlqId = 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5';

    dlqMap.set(activeDlqId, {
      dlqId: activeDlqId,
      idEventoExterno: 'evt-replay-live-001',
      origenCanal: 'PUBSUB_AUDIT_LOG',
      googleSubId: 'sub-live-001',
      emailPrincipal: 'docente.reproceso@educacion.gob.ec',
      dominio: 'educacion.gob.ec',
      tipoEvento: 'CHANGE_USER',
      timestampEventoGws: '2026-10-20T11:00:00.000Z',
      payloadOriginal: { eventId: 'evt-replay-live-001' },
      intentosRealizados: 5,
      ultimoBackoffMs: 16000,
      codigoError: 'GWS_TIMEOUT',
      httpStatusGws: 503,
      detalleErrorTecnico: 'Upstream timeout',
      diagnosticoLenguajeNatural: 'Qué ocurrió: Timeout tras 5 intentos.',
      accionRecomendada: 'Ejecutar POST /api/v1/admin/sync/dlq/replay',
      estadoDlq: 'PENDIENTE_REVISION',
      resueltoPorIdentificacion: null,
      motivoResolucion: null,
      creadoEn: '2026-10-20T11:01:00.000Z',
      actualizadoEn: '2026-10-20T11:01:00.000Z',
      resueltoEn: null,
    });

    const dlqRepo: IDlqRepositoryPort = {
      findById: jest.fn().mockImplementation(async (id: string) => dlqMap.get(id) ?? null),
      findByExternalEventId: jest.fn().mockResolvedValue(null),
      upsertDlqFailure: jest.fn().mockImplementation(async (rec) => {
        dlqMap.set(rec.dlqId, rec);
        return rec;
      }),
      listDlqRecords: jest.fn().mockImplementation(async () => {
        const items = Array.from(dlqMap.values());
        const pending = items.filter((i) => i.estadoDlq === 'PENDIENTE_REVISION').length;
        return { totalPendientes: pending, items };
      }),
      countPendingDlq: jest.fn().mockImplementation(async () => {
        return Array.from(dlqMap.values()).filter(
          (i) => i.estadoDlq === 'PENDIENTE_REVISION',
        ).length;
      }),
    };

    const gwsPort: IGoogleDirectoryReadOnlyPort = {
      getUserReadOnly: jest.fn().mockResolvedValue({
        id: 'sub-live-001',
        googleSubId: 'sub-live-001',
        primaryEmail: 'docente.reproceso@educacion.gob.ec',
        name: {
          givenName: 'Rosa',
          familyName: 'Salazar',
          fullName: 'Rosa Salazar',
        },
        suspended: false,
        archived: false,
        orgUnitPath: '/Docentes',
      }),
      listUsersReadOnly: jest.fn(),
    };

    const syncIdentityRepo: Partial<ISyncIdentityRepositoryPort> = {
      findAccountSyncMetadata: jest.fn().mockResolvedValue({
        cuentaId: 'c1c1c1c1-d2d2-4e3e-8f4f-010101010101',
        idInterno: 'f1f1f1f1-e2e2-4d3d-8c4c-020202020202',
        googleSubId: 'sub-live-001',
        emailPrincipal: 'docente.reproceso@educacion.gob.ec',
        dominio: 'educacion.gob.ec',
        estadoCuenta: 'ACTIVA',
        estadoSincronizacion: 'SINCRONIZADA',
        hashPayloadGws: 'old-hash',
        ultimaSincronizacionEn: '2026-10-20T10:00:00.000Z', // Anterior al evento (11:00:00Z)
      }),
      upsertSyncedIdentity: jest.fn().mockResolvedValue({
        outcome: 'ACTUALIZADA',
        idInternoPersona: 'f1f1f1f1-e2e2-4d3d-8c4c-020202020202',
        cuentaId: 'c1c1c1c1-d2d2-4e3e-8f4f-010101010101',
        googleSubId: 'sub-live-001',
        emailPrincipal: 'docente.reproceso@educacion.gob.ec',
        estadoPersona: 'ACTIVA',
        estadoCuenta: 'ACTIVA',
        estadoSincronizacion: 'SINCRONIZADA',
        cacheShouldInvalidate: true,
      }),
    };

    const app = createSincronizadorHttpApp({
      quotaGovernor: new SyncQuotaGovernor(new InMemoryRateGovernorStore()),
      dlqRepo,
      gwsDirectoryPort: gwsPort,
      syncIdentityRepo: syncIdentityRepo as ISyncIdentityRepositoryPort,
    });

    // 1. Listar bandeja DLQ
    const listResponse = await request(app).get('/api/v1/admin/sync/dlq');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.totalPendientes).toBe(1);
    expect(listResponse.body.items[0].dlqId).toBe(activeDlqId);

    // 2. Reprocesar registro DLQ vigente
    const replayResponse = await request(app)
      .post('/api/v1/admin/sync/dlq/replay')
      .send({
        dlqIds: [activeDlqId],
        adminIdentificacion: 'superadmin@educacion.gob.ec',
        motivoReplay: 'Restablecimiento de servicio Google Directory API',
      });

    expect(replayResponse.status).toBe(200);
    expect(replayResponse.body).toMatchObject({
      totalEvaluados: 1,
      totalReprocesadosExitosos: 1,
      totalResueltosPorObsolescencia: 0,
      totalFallidosNuevamente: 0,
    });
    expect(dlqMap.get(activeDlqId)?.estadoDlq).toBe('RESUELTO_REPROCESADO');

    // 3. Consultar salud operativa detallada en GET /internal/v1/sync/health/detailed
    const healthResponse = await request(app).get('/internal/v1/sync/health/detailed');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe('HEALTHY');
    expect(healthResponse.body.quotaBudget.minedecHardCeilingRps).toBe(28);
    expect(healthResponse.body.quotaBudget.priorityHotRegReservedRps).toBe(5);
    expect(healthResponse.body.diagnosticoAdministrador.posturaSeguridad).toBe(
      'OPERACION_NOMINAL',
    );
    expect(
      healthResponse.body.diagnosticoAdministrador.diagnosticoCuatroPartes,
    ).toEqual(
      expect.objectContaining({
        componenteAfectado: expect.any(String),
        impactoOperativo: expect.any(String),
        mitigacionActiva: expect.any(String),
        accionRecomendada: expect.any(String),
      }),
    );
  });
});
