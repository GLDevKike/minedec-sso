import {
  InMemoryRedisCacheClient,
  SqlQueryExecutor,
  StructuredLogger,
} from '@minedec/shared';
import { PipIdentityResolverAdapter } from '../../../src/infrastructure/pip/pip-identity-resolver.adapter';
import { QueryResult } from 'pg';

describe('T028 - Pruebas unitarias de resolución en el Directorio Único PIP y registro en caliente <= 3.000 ms con 0 llamadas a Google Admin SDK (US3, FR-006)', () => {
  const loggerMock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as StructuredLogger;

  it('1. Resuelve de inmediato una identidad SINCRONIZADA y ACTIVA existente en AlloyDB sin registrar en caliente', async () => {
    const querySpy = jest.fn(async (): Promise<QueryResult> => ({
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          id_interno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          tipo_identificacion: 'CEDULA',
          numero_identificacion: '1710034065',
          nombre_completo: 'ANA LUCIA TORRES VEGA',
          estado_persona: 'ACTIVA',
          cuenta_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          google_sub_id: 'google-sub-consolidada',
          email_principal: 'ana.torres@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
          suspended_en_gws: false,
          estado_sincronizacion: 'SINCRONIZADA',
          fecha_fin_vigencia: null,
        },
      ],
    }));

    const dbMock: SqlQueryExecutor = {
      query: querySpy as unknown as SqlQueryExecutor['query'],
    };

    const redis = new InMemoryRedisCacheClient();
    const adapter = new PipIdentityResolverAdapter(dbMock, redis, {
      logger: loggerMock,
    });

    const result = await adapter.resolveIdentityForOidcCallback({
      googleClaims: {
        googleSubId: 'google-sub-consolidada',
        emailPrincipal: 'ana.torres@educacion.gob.ec',
        emailVerified: true,
        hd: 'educacion.gob.ec',
        fullName: 'ANA LUCIA TORRES VEGA',
      },
      traceId: 'trace-pip-001',
    });

    expect(result.estadoResolucion).toBe('CONSOLIDADA_ACTIVA');
    expect(result.fueRegistroCaliente).toBe(false);
    expect(result.numeroIdentificacion).toBe('1710034065');

    const stillActive = await adapter.verifySessionSubjectStillActive({
      idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      traceId: 'trace-pip-001',
    });
    expect(stillActive).toBe(true);
  });

  it('2. Registra en caliente una cuenta recién creada, encola reconciliación prioritaria y retorna CONSOLIDADA_ACTIVA si consolida dentro de la ventana <= 3.000 ms', async () => {
    let lookupAttempt = 0;

    const querySpy = jest.fn(async (sql: string): Promise<QueryResult> => {
      if (sql.includes('FROM cuenta_institucional c')) {
        lookupAttempt += 1;
        if (lookupAttempt === 1) {
          // No existe inicialmente -> dispara registro en caliente
          return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
        }
        if (lookupAttempt === 2) {
          // Primer sondeo: aún en REGISTRO_CALIENTE / PENDIENTE_IDENTIFICACION
          return {
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
            rows: [
              {
                id_interno: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                tipo_identificacion: null,
                numero_identificacion: null,
                nombre_completo: 'NUEVO DOCENTE',
                estado_persona: 'PENDIENTE_IDENTIFICACION',
                cuenta_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                google_sub_id: 'google-sub-hot-ok',
                email_principal: 'nuevo.docente@educacion.gob.ec',
                dominio: 'educacion.gob.ec',
                suspended_en_gws: false,
                estado_sincronizacion: 'REGISTRO_CALIENTE',
                fecha_fin_vigencia: null,
              },
            ],
          };
        }
        // Segundo sondeo: el reconciliador prioritario ya consolidó la CEDULA
        return {
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [
            {
              id_interno: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              tipo_identificacion: 'CEDULA',
              numero_identificacion: '0912345678',
              nombre_completo: 'NUEVO DOCENTE',
              estado_persona: 'ACTIVA',
              cuenta_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              google_sub_id: 'google-sub-hot-ok',
              email_principal: 'nuevo.docente@educacion.gob.ec',
              dominio: 'educacion.gob.ec',
              suspended_en_gws: false,
              estado_sincronizacion: 'SINCRONIZADA',
              fecha_fin_vigencia: null,
            },
          ],
        };
      }
      return { command: 'INSERT', rowCount: 1, oid: 0, fields: [], rows: [] };
    });

    const dbMock: SqlQueryExecutor = {
      query: querySpy as unknown as SqlQueryExecutor['query'],
    };

    const priorityDispatcher = {
      enqueuePriorityReconciliation: jest.fn(async () => undefined),
    };

    const adapter = new PipIdentityResolverAdapter(dbMock, undefined, {
      maxHotRegistrationWaitMs: 1_500,
      pollIntervalMs: 500,
      sleepFn: async () => undefined,
      priorityDispatcher,
      logger: loggerMock,
    });

    const result = await adapter.resolveIdentityForOidcCallback({
      googleClaims: {
        googleSubId: 'google-sub-hot-ok',
        emailPrincipal: 'nuevo.docente@educacion.gob.ec',
        emailVerified: true,
        hd: 'educacion.gob.ec',
        givenName: 'NUEVO',
        familyName: 'DOCENTE',
        fullName: 'NUEVO DOCENTE',
      },
      traceId: 'trace-pip-002',
    });

    expect(priorityDispatcher.enqueuePriorityReconciliation).toHaveBeenCalledTimes(
      1,
    );
    expect(result.estadoResolucion).toBe('CONSOLIDADA_ACTIVA');
    expect(result.fueRegistroCaliente).toBe(true);
    expect(result.tipoIdentificacion).toBe('CEDULA');
    expect(result.numeroIdentificacion).toBe('0912345678');
  });

  it('3. Retiene el acceso (PENDIENTE_IDENTIFICACION_RETENIDA) cuando tras agotar los <= 3.000 ms la cuenta sigue sin identificación oficial consolidada (FR-006)', async () => {
    let lookupAttempt = 0;

    const querySpy = jest.fn(async (sql: string): Promise<QueryResult> => {
      if (sql.includes('FROM cuenta_institucional c')) {
        lookupAttempt += 1;
        if (lookupAttempt === 1) {
          return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
        }
        return {
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [
            {
              id_interno: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              tipo_identificacion: null,
              numero_identificacion: null,
              nombre_completo: 'SIN CEDULA',
              estado_persona: 'PENDIENTE_IDENTIFICACION',
              cuenta_id: '99999999-9999-4999-8999-999999999999',
              google_sub_id: 'google-sub-pending',
              email_principal: 'sin.cedula@educacion.gob.ec',
              dominio: 'educacion.gob.ec',
              suspended_en_gws: false,
              estado_sincronizacion: 'REGISTRO_CALIENTE',
              fecha_fin_vigencia: null,
            },
          ],
        };
      }
      return { command: 'INSERT', rowCount: 1, oid: 0, fields: [], rows: [] };
    });

    const dbMock: SqlQueryExecutor = {
      query: querySpy as unknown as SqlQueryExecutor['query'],
    };

    const sleepCalls: number[] = [];
    const adapter = new PipIdentityResolverAdapter(dbMock, undefined, {
      maxHotRegistrationWaitMs: 3_000,
      pollIntervalMs: 500,
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
      logger: loggerMock,
    });

    const result = await adapter.resolveIdentityForOidcCallback({
      googleClaims: {
        googleSubId: 'google-sub-pending',
        emailPrincipal: 'sin.cedula@educacion.gob.ec',
        emailVerified: true,
        hd: 'educacion.gob.ec',
        fullName: 'SIN CEDULA',
      },
      traceId: 'trace-pip-003',
    });

    expect(result.estadoResolucion).toBe('PENDIENTE_IDENTIFICACION_RETENIDA');
    expect(result.fueRegistroCaliente).toBe(true);
    expect(sleepCalls.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3_000);
  });

  it('4. Evalúa todos los motivos de denegación por cuenta/persona suspendida, eliminada, bloqueada por anomalía o con vigencia vencida', async () => {
    const scenarios = [
      {
        suspended_en_gws: true,
        estado_sincronizacion: 'SUSPENDIDA_GWS',
        estado_persona: 'ACTIVA',
        fecha_fin_vigencia: null,
      },
      {
        suspended_en_gws: false,
        estado_sincronizacion: 'ELIMINADA_GWS',
        estado_persona: 'ACTIVA',
        fecha_fin_vigencia: null,
      },
      {
        suspended_en_gws: false,
        estado_sincronizacion: 'VIGENCIA_VENCIDA',
        estado_persona: 'ACTIVA',
        fecha_fin_vigencia: null,
      },
      {
        suspended_en_gws: false,
        estado_sincronizacion: 'BLOQUEADA_ANOMALIA',
        estado_persona: 'BLOQUEADA_ANOMALIA',
        fecha_fin_vigencia: null,
      },
      {
        suspended_en_gws: false,
        estado_sincronizacion: 'SINCRONIZADA',
        estado_persona: 'INACTIVA',
        fecha_fin_vigencia: null,
      },
      {
        suspended_en_gws: false,
        estado_sincronizacion: 'SINCRONIZADA',
        estado_persona: 'ACTIVA',
        fecha_fin_vigencia: '2020-01-01',
      },
    ];

    for (const scenario of scenarios) {
      const dbMock: SqlQueryExecutor = {
        query: (async (): Promise<QueryResult> => ({
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [
            {
              id_interno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              tipo_identificacion: 'CEDULA',
              numero_identificacion: '1710034065',
              nombre_completo: 'USUARIO INACTIVO',
              cuenta_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              google_sub_id: 'google-sub-inactive',
              email_principal: 'inactivo@educacion.gob.ec',
              dominio: 'educacion.gob.ec',
              ...scenario,
            },
          ],
        })) as unknown as SqlQueryExecutor['query'],
      };

      const adapter = new PipIdentityResolverAdapter(dbMock, undefined, {
        logger: loggerMock,
      });

      const resolved = await adapter.resolveIdentityForOidcCallback({
        googleClaims: {
          googleSubId: 'google-sub-inactive',
          emailPrincipal: 'inactivo@educacion.gob.ec',
          emailVerified: true,
          hd: 'educacion.gob.ec',
        },
        traceId: 'trace-inactive',
      });
      expect(resolved.estadoResolucion).toBe('CUENTA_SUSPENDIDA_O_INACTIVA');

      const stillActive = await adapter.verifySessionSubjectStillActive({
        idInterno: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cuentaId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        traceId: 'trace-inactive',
      });
      expect(stillActive).toBe(false);
    }
  });
});
