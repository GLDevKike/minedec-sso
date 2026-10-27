import * as fs from 'fs';
import * as path from 'path';
import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  createStructuredLogger,
  InMemoryRedisCacheClient,
} from '@minedec/shared';

import {
  createSsoOidcContainer,
  ExchangeAuthorizationCodeUseCase,
  ExecuteSingleLogoutUseCase,
  HandleGoogleIdpCallbackUseCase,
  IdentityRevocationEventPayloadSchema,
  ManageJwksKeysUseCase,
  RevokeIdentitySessionsUseCase,
  SafeUriSchema,
  SSO_OIDC_TYPES,
  StartOidcAuthorizationUseCase,
} from '../../src';
import {
  createOidcErrorHandlerMiddleware,
  oidcPathNormalizationGuard,
} from '../../src/infrastructure/http/middlewares/oidc-error-handler.middleware';

describe('T049 / T052 - Composition Root InversifyJS, Pureza Hexagonal y Cero Telemetría de Latencia en sso-oidc', () => {
  it('resuelve exitosamente todos los casos de uso y controladores desde createSsoOidcContainer()', () => {
    const container = createSsoOidcContainer({
      redis: new InMemoryRedisCacheClient(),
    });

    expect(
      container.get<StartOidcAuthorizationUseCase>(
        SSO_OIDC_TYPES.StartOidcAuthorizationUseCase,
      ),
    ).toBeInstanceOf(StartOidcAuthorizationUseCase);
    expect(
      container.get<HandleGoogleIdpCallbackUseCase>(
        SSO_OIDC_TYPES.HandleGoogleIdpCallbackUseCase,
      ),
    ).toBeInstanceOf(HandleGoogleIdpCallbackUseCase);
    expect(
      container.get<ExchangeAuthorizationCodeUseCase>(
        SSO_OIDC_TYPES.ExchangeAuthorizationCodeUseCase,
      ),
    ).toBeInstanceOf(ExchangeAuthorizationCodeUseCase);
    expect(
      container.get<ExecuteSingleLogoutUseCase>(
        SSO_OIDC_TYPES.ExecuteSingleLogoutUseCase,
      ),
    ).toBeInstanceOf(ExecuteSingleLogoutUseCase);
    expect(
      container.get<RevokeIdentitySessionsUseCase>(
        SSO_OIDC_TYPES.RevokeIdentitySessionsUseCase,
      ),
    ).toBeInstanceOf(RevokeIdentitySessionsUseCase);
    expect(
      container.get<ManageJwksKeysUseCase>(
        SSO_OIDC_TYPES.ManageJwksKeysUseCase,
      ),
    ).toBeInstanceOf(ManageJwksKeysUseCase);
  });

  it('ejercita esquemas Zod y guardia/middleware de errores OIDC fail-close', () => {
    expect(SafeUriSchema.safeParse('https://app.educacion.gob.ec/cb').success).toBe(true);
    expect(SafeUriSchema.safeParse('http://localhost:3000/cb').success).toBe(true);
    expect(SafeUriSchema.safeParse('http://127.0.0.1:8080').success).toBe(true);
    expect(SafeUriSchema.safeParse('http://evil.com/cb').success).toBe(false);

    expect(
      IdentityRevocationEventPayloadSchema.safeParse({
        alcanceRevocacion: 'CUENTA_INSTITUCIONAL',
        cuentaId: '11111111-1111-4111-8111-111111111111',
        motivoRevocacion: 'SUSPENDIDA_GWS',
        traceId: 'trace-001',
      }).success,
    ).toBe(true);
    expect(
      IdentityRevocationEventPayloadSchema.safeParse({
        alcanceRevocacion: 'PERSONA_IDENTIDAD',
        idInterno: '22222222-2222-4222-8222-222222222222',
        motivoRevocacion: 'PERSONA_INACTIVA',
        traceId: 'trace-002',
      }).success,
    ).toBe(true);
    expect(
      IdentityRevocationEventPayloadSchema.safeParse({
        alcanceRevocacion: 'PERSONA_IDENTIDAD',
        motivoRevocacion: 'PERSONA_INACTIVA',
        traceId: 'trace-003',
      }).success,
    ).toBe(false);

    const makeMockRes = () => {
      const headers: Record<string, string> = {};
      let statusCode = 200;
      let body: unknown = null;
      const res = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: unknown) => {
          body = payload;
          return res;
        },
      } as unknown as Response;
      return { res, getStatus: () => statusCode, getBody: () => body };
    };

    for (const badUrl of ['/authorize/../admin', '/authorize%2ftest', '/authorize%5ctest', '/authorize\\test']) {
      const { res, getStatus } = makeMockRes();
      let nextCalled = false;
      oidcPathNormalizationGuard(
        { originalUrl: badUrl, headers: {} } as unknown as Request,
        res,
        (() => {
          nextCalled = true;
        }) as NextFunction,
      );
      expect(nextCalled).toBe(false);
      expect(getStatus()).toBe(400);
    }

    const logger = createStructuredLogger('sso-oidc-test');
    const errorMiddleware = createOidcErrorHandlerMiddleware(logger);

    // ZodError en /token
    {
      const { res, getStatus } = makeMockRes();
      const zodErr = new ZodError([
        { code: 'custom', path: ['grant_type'], message: 'grant inválido' },
      ]);
      errorMiddleware(
        zodErr,
        { path: '/token', method: 'POST', headers: { 'x-trace-id': 'tr-token' } } as unknown as Request,
        res,
        (() => {}) as NextFunction,
      );
      expect(getStatus()).toBe(400);
    }

    // ZodError con code_challenge en /authorize
    {
      const { res, getStatus } = makeMockRes();
      const zodErr = new ZodError([
        { code: 'custom', path: ['code_challenge'], message: 'PKCE requerido' },
      ]);
      errorMiddleware(
        zodErr,
        { path: '/authorize', method: 'GET', headers: {} } as unknown as Request,
        res,
        (() => {}) as NextFunction,
      );
      expect(getStatus()).toBe(400);
    }

    // Error inesperado -> 503 fail-close
    {
      const { res, getStatus } = makeMockRes();
      errorMiddleware(
        new Error('Fallo de conexión simulado'),
        { path: '/authorize', method: 'GET', headers: {} } as unknown as Request,
        res,
        (() => {}) as NextFunction,
      );
      expect(getStatus()).toBe(503);
    }
  });

  it('verifica estáticamente que domain/ y application/ están libres de decoradores y que src/ no calcula latencia', () => {
    const srcRoot = path.resolve(__dirname, '../../src');

    const collectTsFiles = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectTsFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    };

    const pureFiles = [
      ...collectTsFiles(path.join(srcRoot, 'domain')),
      ...collectTsFiles(path.join(srcRoot, 'application')),
    ];
    expect(pureFiles.length).toBeGreaterThan(0);

    for (const file of pureFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/from\s+['"]inversify['"]/);
      expect(content).not.toMatch(/from\s+['"]reflect-metadata['"]/);
      expect(content).not.toMatch(/from\s+['"]express['"]/);
      expect(content).not.toMatch(/@injectable\s*\(/);
      expect(content).not.toMatch(/@inject\s*\(/);
    }

    const allSrcFiles = collectTsFiles(srcRoot);
    for (const file of allSrcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const codeWithoutComments = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(codeWithoutComments).not.toMatch(/Date\.now\(\)\s*-\s*startedAt/);
      expect(codeWithoutComments).not.toMatch(/latency_ms/);
    }
  });
});
