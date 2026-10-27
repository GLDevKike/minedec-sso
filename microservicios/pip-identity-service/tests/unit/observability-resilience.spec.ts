import request from 'supertest';
import { QueryResult, QueryResultRow } from 'pg';
import { InMemoryRedisCacheClient, SqlQueryExecutor } from '@minedec/shared';
import { createPipExpressApp } from '../../src';

describe('T058-T060 - Endpoint GET /internal/v1/pip/health/detailed y Manejo de Caídas HTTP 503 (Fail-Close)', () => {
  it('devuelve 200 OK con resumen ejecutivo en lenguaje natural cuando AlloyDB y Redis están operativos', async () => {
    const healthySqlExecutor: SqlQueryExecutor = {
      query: async <R extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<R>> =>
        ({
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          rows: [{ ok: 1 } as unknown as R],
          fields: [],
        }) as QueryResult<R>,
    };

    const { app } = createPipExpressApp({
      overrides: {
        sqlExecutor: healthySqlExecutor,
        redisStore: new InMemoryRedisCacheClient(),
      },
    });

    const response = await request(app)
      .get('/internal/v1/pip/health/detailed')
      .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');

    expect(response.status).toBe(200);
    expect(response.headers['traceparent']).toMatch(
      /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/,
    );
    expect(response.headers['x-span-id']).toMatch(/^[0-9a-f]{16}$/);
    expect(response.body.estadoGlobal).toBe('OPERATIVO');
    expect(response.body.posturaSeguridad).toBe('FAIL_CLOSE_ACTIVO');
    expect(response.body.resumenEjecutivoAdministrador).toContain('PITR 14 días');
    expect(response.body.componentes.alloydbPostgresql16.estado).toBe('OPERATIVO');
    expect(response.body.componentes.memorystoreRedisL2.estado).toBe('OPERATIVO');
  });

  it('devuelve 503 Service Unavailable (Fail-Close) con diagnóstico completo en lenguaje natural para el Administrador cuando AlloyDB se cae en health/detailed y en endpoints de negocio', async () => {
    const failingSqlExecutor: SqlQueryExecutor = {
      query: async () => {
        throw Object.assign(
          new Error('FATAL: terminating connection due to administrator command'),
          { code: '57P01' },
        );
      },
    };

    const { app } = createPipExpressApp({
      overrides: {
        sqlExecutor: failingSqlExecutor,
        redisStore: new InMemoryRedisCacheClient(),
      },
    });

    const healthRes = await request(app).get('/internal/v1/pip/health/detailed');
    expect(healthRes.status).toBe(503);
    expect(healthRes.body.estadoGlobal).toBe('CAIDO_FAIL_CLOSE_ACTIVO');
    expect(healthRes.body.resumenEjecutivoAdministrador).toContain(
      'ALERTA CRÍTICA PARA EL ADMINISTRADOR',
    );
    expect(healthRes.body.resumenEjecutivoAdministrador).toContain('CÓMO SE LEVANTA');
    expect(
      healthRes.body.componentes.alloydbPostgresql16.diagnosticoIncidente.codigoIncidente,
    ).toBe('ALLOYDB_UNAVAILABLE_OR_FAILOVER');

    const businessRes = await request(app).get('/api/v1/admin/identities/1710034065');
    expect(businessRes.status).toBe(503);
    expect(businessRes.body.code).toBe('ALLOYDB_UNAVAILABLE_OR_FAILOVER');
    expect(businessRes.body.posturaSeguridad).toBe('FAIL_CLOSE_ACTIVO');
    expect(businessRes.body.diagnosticoAdministrador.explicacionLenguajeNatural).toContain(
      'Regional HA Failover',
    );
    expect(businessRes.body.diagnosticoAdministrador.comoSeLevantaYRecupera).toContain(
      'menos de 60 segundos',
    );
  });
});
