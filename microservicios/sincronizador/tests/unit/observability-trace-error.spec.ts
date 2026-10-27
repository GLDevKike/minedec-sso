import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  createStructuredLogger,
  detectRuntimePlatformMetadata,
  StructuredLogger,
} from '@minedec/shared';
import {
  createSincronizadorHttpApp,
  createSyncErrorHandler,
} from '../../src/infrastructure/http/app';
import { InternalSyncController } from '../../src/infrastructure/http/controllers/internal-sync.controller';
import { CloudTasksDispatcherAdapter } from '../../src/infrastructure/messaging/cloud-tasks-dispatcher.adapter';

describe('T083-T085 - Estandarización de Logs Pino, Trazabilidad OpenTelemetry W3C y Manejo Centralizado de Errores en Sincronizador', () => {
  it('detecta metadatos de ejecución y propaga correlación W3C en PinoStructuredLogger', () => {
    const serviceMeta = detectRuntimePlatformMetadata({
      K_SERVICE: 'sso-sincronizador-des',
      K_REVISION: 'sso-sincronizador-des-00012-abc',
      K_CONFIGURATION: 'sso-sincronizador-des',
    });
    expect(serviceMeta.runtimePlatform).toBe('CLOUD_RUN_SERVICE');

    const capturedLogs: Array<{ payload: Record<string, unknown>; msg: string }> = [];
    const fakePino = {
      info: (obj: Record<string, unknown>, msg: string) => {
        capturedLogs.push({ payload: obj, msg });
      },
      warn: (obj: Record<string, unknown>, msg: string) => {
        capturedLogs.push({ payload: obj, msg });
      },
      error: (obj: Record<string, unknown>, msg: string) => {
        capturedLogs.push({ payload: obj, msg });
      },
      debug: (obj: Record<string, unknown>, msg: string) => {
        capturedLogs.push({ payload: obj, msg });
      },
    };

    const logger = createStructuredLogger('sso-sincronizador', {
      gcpProjectId: 'mec-003-sso-des',
      pinoInstance: fakePino as never,
      env: {
        K_SERVICE: 'sso-sincronizador-des',
        K_REVISION: 'rev-001',
        K_CONFIGURATION: 'cfg-001',
      },
    });

    const childLogger = logger.withTraceId(
      '4bf92f3577b34da6a3ce929d0e0e4736',
      '00f067aa0ba902b7',
    );
    childLogger.error('Error de conexión con AlloyDB en Cloud Run', {
      error: Object.assign(new Error('terminating connection due to administrator command'), {
        sqlState: '57P01',
      }),
    });

    expect(capturedLogs).toHaveLength(1);
    const entry = capturedLogs[0]!.payload;
    expect(entry.service).toBe('sso-sincronizador');
    expect(entry.runtimePlatform).toBe('CLOUD_RUN_SERVICE');
  });

  it('propaga traceparent, X-Cloud-Trace-Context y X-Trace-Id en CloudTasksDispatcherAdapter y createSincronizadorHttpApp', async () => {
    const w3cTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const capturedTaskRequests: Array<{
      task: { httpRequest: { headers: Record<string, string> } };
    }> = [];
    const dispatcher = new CloudTasksDispatcherAdapter({
      projectId: 'mec-003-sso-des',
      location: 'us-central1',
      serviceBaseUrl: 'https://sso-sincronizador-des.a.run.app',
      tasksClient: {
        async createTask(req) {
          capturedTaskRequests.push(req as never);
          return [{ name: 'projects/mec-003-sso-des/locations/us-central1/queues/q/tasks/t-otel' }];
        },
      },
    });

    await dispatcher.enqueueIncrementalSync({
      idEventoExterno: 'evt-otel-01',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'sub-trace-001',
      emailPrincipal: 'docente.trace@docentes.educacion.gob.ec',
      dominio: 'docentes.educacion.gob.ec',
      timestampEventoGws: new Date().toISOString(),
      traceId: w3cTraceId,
    });

    expect(capturedTaskRequests).toHaveLength(1);
    const sentHeaders = capturedTaskRequests[0]!.task.httpRequest.headers;
    expect(sentHeaders['X-Trace-Id']).toBe(w3cTraceId);
    expect(sentHeaders.traceparent).toMatch(
      new RegExp(`^00-${w3cTraceId}-[0-9a-f]{16}-01$`),
    );

    const app = createSincronizadorHttpApp();
    const incomingParentSpan = '00f067aa0ba902b7';
    const response = await request(app)
      .get('/internal/v1/sync/health/detailed')
      .set('traceparent', `00-${w3cTraceId}-${incomingParentSpan}-01`);

    expect(response.status).toBe(200);
    expect(response.headers['x-trace-id']).toBe(w3cTraceId);
  });

  it('captura ZodError (400), caídas de AlloyDB (503 FAIL_CLOSE_ACTIVO) y errores inesperados (500) en syncErrorHandler e InternalSyncController', async () => {
    const errorLogs: Array<{ msg: string; context: Record<string, unknown> }> = [];
    const mockLogger: StructuredLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: (msgOrCtx, ctxOrMsg) => {
        if (typeof msgOrCtx === 'string') {
          errorLogs.push({
            msg: msgOrCtx,
            context: (ctxOrMsg as Record<string, unknown>) ?? {},
          });
        }
      },
      withTraceId: () => mockLogger,
    };

    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      req.traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      req.spanId = '00f067aa0ba902b7';
      next();
    });

    testApp.post('/test/zod', (req, _res, next) => {
      try {
        z.object({ emailPrincipal: z.string().email() }).parse(req.body);
      } catch (err) {
        next(err);
      }
    });

    testApp.post('/test/alloydb-outage', (_req, _res, next) => {
      const dbError = Object.assign(
        new Error('Connection terminated unexpectedly during failover'),
        { sqlState: '57P01' },
      );
      next(dbError);
    });

    testApp.post('/test/unexpected', (_req, _res, next) => {
      next(new Error('Excepción interna no controlada en worker'));
    });

    testApp.use(createSyncErrorHandler(mockLogger));

    const resZod = await request(testApp).post('/test/zod').send({ emailPrincipal: 'invalido' });
    expect(resZod.status).toBe(400);
    expect(resZod.body.code).toBe('VALIDATION_ERROR');

    const resOutage = await request(testApp).post('/test/alloydb-outage').send({});
    expect(resOutage.status).toBe(503);
    expect(resOutage.body.code).toBe('ALLOYDB_UNAVAILABLE_OR_FAILOVER');

    const resUnexpected = await request(testApp).post('/test/unexpected').send({});
    expect(resUnexpected.status).toBe(500);
    expect(resUnexpected.body.code).toBe('INTERNAL_SYNC_ERROR');

    const controller = new InternalSyncController(
      { execute: jest.fn() } as never,
      {
        execute: jest
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error('Rate limit GWS alcanzado'), {
              httpStatus: 429,
              retryAfterSeconds: 5,
            }),
          )
          .mockRejectedValueOnce(new Error('Error SQL transitorio')),
      } as never,
      { execute: jest.fn() } as never,
      {
        execute: jest.fn().mockRejectedValueOnce(new Error('Timeout en reconciliación hot-reg')),
      } as never,
      {
        execute: jest.fn().mockRejectedValueOnce(new Error('Redis desconectado en health probe')),
      } as never,
      mockLogger,
    );

    const app = express();
    app.use(express.json());
    app.get('/internal/v1/sync/health/detailed', controller.handleDetailedHealth);
    app.post('/internal/v1/sync/tasks/incremental', controller.handleIncrementalTask);
    app.post(
      '/internal/v1/sync/tasks/priority-hot-registration',
      controller.handlePriorityHotRegistrationTask,
    );

    const resHealth = await request(app).get('/internal/v1/sync/health/detailed');
    expect(resHealth.status).toBe(503);

    const validTaskPayload = {
      idEventoExterno: 'evt-429-test',
      tipoEvento: 'CHANGE_USER',
      googleSubId: 'sub-429',
      emailPrincipal: 'docente@docentes.educacion.gob.ec',
      dominio: 'docentes.educacion.gob.ec',
      timestampEventoGws: new Date().toISOString(),
    };

    const res429 = await request(app)
      .post('/internal/v1/sync/tasks/incremental')
      .send(validTaskPayload);
    expect(res429.status).toBe(429);

    const res500 = await request(app)
      .post('/internal/v1/sync/tasks/incremental')
      .send(validTaskPayload);
    expect(res500.status).toBe(500);

    const resHotReg500 = await request(app)
      .post('/internal/v1/sync/tasks/priority-hot-registration')
      .send({
        idEventoExterno: 'evt-hot-500',
        googleSubId: 'sub-hot-500',
        emailPrincipal: 'docente@docentes.educacion.gob.ec',
        dominio: 'docentes.educacion.gob.ec',
        solicitadoEn: new Date().toISOString(),
      });
    expect(resHotReg500.status).toBe(500);
  });
});
