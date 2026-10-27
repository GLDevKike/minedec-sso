import { Pool } from 'pg';
import {
  buildNaturalLanguageIncidentDiagnostic,
  extractOrCreateOtelSpanContext,
  isInfrastructureOutageError,
  PinoStructuredLogger,
  PostgresDatabaseClient,
  sanitizeTechnicalErrorMessage,
  withOtelSpan,
} from '../../src';

describe('T058-T060 - Resiliencia ante Caídas de AlloyDB, OpenTelemetry, Logs Estandarizados y Diagnósticos en Lenguaje Natural para el Administrador', () => {
  describe('1. OpenTelemetry W3C Trace Context y Google Cloud Trace (otel-tracing.ts)', () => {
    it('extrae correctamente la cabecera W3C traceparent entrante y genera un nuevo spanId hijo preservando el traceId', () => {
      const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const incomingParentSpanId = '00f067aa0ba902b7';
      const spanCtx = extractOrCreateOtelSpanContext({
        traceparent: `00-${incomingTraceId}-${incomingParentSpanId}-01`,
      });

      expect(spanCtx.traceId).toBe(incomingTraceId);
      expect(spanCtx.parentSpanId).toBe(incomingParentSpanId);
      expect(spanCtx.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(spanCtx.spanId).not.toBe(incomingParentSpanId);
      expect(spanCtx.sampled).toBe(true);
      expect(spanCtx.traceparent).toBe(`00-${incomingTraceId}-${spanCtx.spanId}-01`);
      expect(spanCtx.cloudTraceContext).toMatch(
        new RegExp(`^${incomingTraceId}/[0-9]+;o=1$`),
      );
    });

    it('extrae correctamente la cabecera X-Cloud-Trace-Context cuando no se envía traceparent', () => {
      const traceId = '105445aa7843bc8bf206b12000100000';
      const spanCtx = extractOrCreateOtelSpanContext({
        'x-cloud-trace-context': `${traceId}/12345;o=1`,
      });

      expect(spanCtx.traceId).toBe(traceId);
      expect(spanCtx.parentSpanId).toBe('0000000000003039');
      expect(spanCtx.sampled).toBe(true);
    });

    it('instrumenta operaciones asíncronas con withOtelSpan registrando telemetría de éxito y de error', async () => {
      const recordedSpans: unknown[] = [];
      const result = await withOtelSpan(
        'AlloyDB.ResolveIdentityQuery',
        {
          kind: 'CLIENT',
          attributes: { 'db.system': 'postgresql', 'db.instance': 'conecta-minedec-pip' },
          onSpanEnd: (span) => recordedSpans.push(span),
        },
        async (ctx) => {
          expect(ctx.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
          return 'IDENTITY_OK';
        },
      );

      expect(result).toBe('IDENTITY_OK');
      expect(recordedSpans).toHaveLength(1);
      expect(recordedSpans[0]).toMatchObject({
        name: 'AlloyDB.ResolveIdentityQuery',
        kind: 'CLIENT',
        status: 'OK',
      });

      await expect(
        withOtelSpan(
          'AlloyDB.FailingQuery',
          {
            kind: 'CLIENT',
            onSpanEnd: (span) => recordedSpans.push(span),
          },
          async () => {
            throw new Error('terminating connection due to administrator command');
          },
        ),
      ).rejects.toThrow('terminating connection');

      expect(recordedSpans).toHaveLength(2);
      expect(recordedSpans[1]).toMatchObject({
        name: 'AlloyDB.FailingQuery',
        status: 'ERROR',
      });
    });
  });

  describe('2. Motor de Diagnóstico en Lenguaje Natural para el Administrador (incident-diagnostics.ts)', () => {
    it('genera una explicación detallada en lenguaje natural cuando AlloyDB se cae o entra en conmutación HA (SQLSTATE 57P01 / ECONNREFUSED)', () => {
      const alloyDbOutageError = Object.assign(
        new Error(
          'FATAL: terminating connection due to administrator command (postgresql://pip_user:SuperSecret123@10.10.0.5:5432/conecta_pip)',
        ),
        { code: '57P01' },
      );

      expect(isInfrastructureOutageError(alloyDbOutageError)).toBe(true);

      const report = buildNaturalLanguageIncidentDiagnostic(alloyDbOutageError, {
        traceId: 'trace-alloydb-down-001',
      });

      expect(report.codigoIncidente).toBe('ALLOYDB_UNAVAILABLE_OR_FAILOVER');
      expect(report.severidad).toBe('CRITICA');
      expect(report.componenteAfectado).toBe('ALLOYDB_POSTGRESQL_16');
      expect(report.posturaSeguridad).toBe('FAIL_CLOSE_ACTIVO');

      // Verifica que el administrador reciba toda la explicación en lenguaje natural
      expect(report.tituloLenguajeNatural).toContain('AlloyDB for PostgreSQL 16');
      expect(report.explicacionLenguajeNatural).toContain('Regional HA Failover');
      expect(report.impactoOperativoYSeguridad).toContain('FAIL-CLOSE');
      expect(report.impactoOperativoYSeguridad).toContain('300 segundos');
      expect(report.comoSeLevantaYRecupera).toContain('menos de 60 segundos');
      expect(report.comoSeLevantaYRecupera).toContain('RPO = 0');
      expect(report.comoSeLevantaYRecupera).toContain('14 días');
      expect(report.accionesRecomendadasAdministrador.length).toBeGreaterThanOrEqual(4);
      expect(report.accionesRecomendadasAdministrador.join(' ')).toContain(
        'gcloud alloydb clusters',
      );

      // Verifica sanitización Zero-Secret (nunca filtra la URI con contraseña)
      expect(report.detallesTecnicosSanitizados.mensajeOriginalSanitizado).toContain(
        'postgresql://[REDACTED_DB_URI]',
      );
      expect(report.detallesTecnicosSanitizados.mensajeOriginalSanitizado).not.toContain(
        'SuperSecret123',
      );
    });

    it('clasifica saturación de conexiones (53300), timeout de consulta (57014), Redis L2, Pub/Sub y Cloud Tasks en lenguaje natural', () => {
      const saturationReport = buildNaturalLanguageIncidentDiagnostic(
        Object.assign(new Error('remaining connection slots are reserved'), {
          code: '53300',
        }),
      );
      expect(saturationReport.codigoIncidente).toBe('ALLOYDB_CONNECTION_SATURATED');
      expect(saturationReport.explicacionLenguajeNatural).toContain(
        'límite máximo de conexiones',
      );

      const timeoutReport = buildNaturalLanguageIncidentDiagnostic(
        Object.assign(new Error('canceling statement due to statement timeout'), {
          code: '57014',
        }),
      );
      expect(timeoutReport.codigoIncidente).toBe('ALLOYDB_QUERY_TIMEOUT');
      expect(timeoutReport.impactoOperativoYSeguridad).toContain('ROLLBACK automático');

      const redisReport = buildNaturalLanguageIncidentDiagnostic(
        new Error('ioredis connection closed'),
        { componentHint: 'MEMORYSTORE_REDIS_L2' },
      );
      expect(redisReport.codigoIncidente).toBe('REDIS_CACHE_UNAVAILABLE');
      expect(redisReport.posturaSeguridad).toBe('DEGRADACION_CONTROLADA');

      const pubsubReport = buildNaturalLanguageIncidentDiagnostic(
        new Error('PubSub topic publish failed'),
      );
      expect(pubsubReport.codigoIncidente).toBe('PUBSUB_BUS_DEGRADED');

      const tasksReport = buildNaturalLanguageIncidentDiagnostic(
        new Error('Cloud Tasks queue dispatch error'),
      );
      expect(tasksReport.codigoIncidente).toBe('CLOUD_TASKS_QUEUE_DEGRADED');

      expect(
        sanitizeTechnicalErrorMessage('Bearer eyJhbGciOiJSUzI1NiJ9.secret password=abc'),
      ).toBe('Bearer [REDACTED_TOKEN] password=[REDACTED]');
    });
  });

  describe('3. Logs JSON Estandarizados para Google Cloud Logging (logger.ts)', () => {
    it('enriquece automáticamente los logs de error con severity, correlación Cloud Trace y diagnosticoAdministrador en lenguaje natural', () => {
      const capturedLogs: Array<{ obj: Record<string, unknown>; msg: string }> = [];
      const fakePino = {
        info: (obj: Record<string, unknown>, msg: string) =>
          capturedLogs.push({ obj, msg }),
        warn: (obj: Record<string, unknown>, msg: string) =>
          capturedLogs.push({ obj, msg }),
        error: (obj: Record<string, unknown>, msg: string) =>
          capturedLogs.push({ obj, msg }),
        debug: (obj: Record<string, unknown>, msg: string) =>
          capturedLogs.push({ obj, msg }),
      };

      const logger = new PinoStructuredLogger({
        gcpProjectId: 'minedec-sso-pdp-core-prd',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        pinoInstance: fakePino as never,
      });

      const dbDownErr = Object.assign(new Error('connect ECONNREFUSED 10.10.0.5:5432'), {
        code: 'ECONNREFUSED',
      });
      logger.error('Fallo al consultar AlloyDB en resolución de identidad', {
        error: dbDownErr,
      });

      expect(capturedLogs).toHaveLength(1);
      const entry = capturedLogs[0].obj;
      expect(entry.severity).toBe('ERROR');
      expect(entry['logging.googleapis.com/trace']).toBe(
        'projects/minedec-sso-pdp-core-prd/traces/4bf92f3577b34da6a3ce929d0e0e4736',
      );
      expect(entry['logging.googleapis.com/spanId']).toBe('00f067aa0ba902b7');
      expect(entry['logging.googleapis.com/trace_sampled']).toBe(true);
      expect(entry.diagnosticoAdministrador).toBeDefined();
      expect(
        (entry.diagnosticoAdministrador as { codigoIncidente: string }).codigoIncidente,
      ).toBe('ALLOYDB_UNAVAILABLE_OR_FAILOVER');
    });
  });

  describe('4. Reconexión Automática con Backoff y Sonda de Salud en PostgresDatabaseClient', () => {
    it('reintenta automáticamente una consulta cuando AlloyDB experimenta un micro-corte por failover HA y se recupera en el siguiente intento', async () => {
      let queryAttempts = 0;
      const fakePool = {
        on: jest.fn(),
        query: jest.fn(async () => {
          queryAttempts += 1;
          if (queryAttempts === 1) {
            throw Object.assign(
              new Error('cannot connect now - AlloyDB standby promoting'),
              { code: '57P03' },
            );
          }
          return { rows: [{ in_recovery: false }], rowCount: 1 };
        }),
        connect: jest.fn(),
        end: jest.fn(),
      } as unknown as Pool;

      const dbClient = new PostgresDatabaseClient({
        poolInstance: fakePool,
        maxConnectionRetries: 2,
        retryDelayMs: 5,
      });

      const res = await dbClient.query('SELECT 1');
      expect(queryAttempts).toBe(2);
      expect(res.rowCount).toBe(1);

      const healthOk = await dbClient.checkHealth('trace-health-ok');
      expect(healthOk.estado).toBe('OPERATIVO');
      expect(healthOk.rolInstancia).toBe('PRIMARIA_LECTURA_ESCRITURA');
      expect(healthOk.mecanismoRespaldoYRecuperacion).toContain('PITR de 14 días');
    });

    it('reporta CAIDO_O_EN_FAILOVER con diagnóstico en lenguaje natural cuando AlloyDB permanece caído', async () => {
      const failingPool = {
        on: jest.fn(),
        query: jest.fn(async () => {
          throw Object.assign(new Error('connect ECONNREFUSED 10.10.0.5:5432'), {
            code: 'ECONNREFUSED',
          });
        }),
        connect: jest.fn(),
        end: jest.fn(),
      } as unknown as Pool;

      const dbClient = new PostgresDatabaseClient({
        poolInstance: failingPool,
        maxConnectionRetries: 0,
      });

      const healthDown = await dbClient.checkHealth('trace-health-down');
      expect(healthDown.estado).toBe('CAIDO_O_EN_FAILOVER');
      expect(healthDown.diagnosticoIncidente?.codigoIncidente).toBe(
        'ALLOYDB_UNAVAILABLE_OR_FAILOVER',
      );
      expect(healthDown.resumenLenguajeNatural).toContain('AlloyDB for PostgreSQL 16');
    });
  });
});
