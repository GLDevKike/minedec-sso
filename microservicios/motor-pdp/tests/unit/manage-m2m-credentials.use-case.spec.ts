/**
 * Pruebas Unitarias — Ciclo de Vida de Credenciales M2M y Retiro JWKS (`005-autenticacion-m2m-rotacion`).
 *
 * Cubre:
 * - `ProvisionM2mCredentialUseCase`: generación criptográfica CSPRNG de `client_secret_unica_vez`, hash SHA-256 y validación de invariantes por `tipo_cliente`.
 * - `RotateM2mCredentialSecretUseCase`: rotación dual (`ACTIVA` -> `EN_ROTACION_GRACIA`), ventana de gracia y auditoría inmutable.
 * - `ExpireM2mCredentialGraceUseCase`: expiración limpia de ventana de gracia (`EN_ROTACION_GRACIA` -> `ACTIVA`).
 * - `RevokeM2mCredentialUseCase`: revocación de emergencia (`REVOCADA`) + invalidación inmediata en caché L2 Redis.
 * - `RetirePdpJwksKeyUseCase`: retiro programado de llave JWKS (`GRACIA_VERIFICACION` -> `RETIRADA`).
 */

import crypto from 'node:crypto';
import {
  ExpireM2mCredentialGraceUseCase,
  ProvisionM2mCredentialUseCase,
  RevokeM2mCredentialUseCase,
  RotateM2mCredentialSecretUseCase,
} from '../../src/application/use-cases/manage-m2m-credentials.use-case';
import { RetirePdpJwksKeyUseCase } from '../../src/application/use-cases/manage-pdp-jwks.use-case';
import {
  M2mClientCredential,
  PdpSigningKeyRecord,
} from '../../src/domain/entities/pdp-domain.entities';
import { PdpInvalidSchemaError } from '../../src/domain/errors/pdp-domain.errors';
import {
  M2mCredentialRepositoryPort,
  PdpAuditPort,
  PdpJwksKeyRepositoryPort,
  PdpL2CachePort,
  PdpTransactionalSecurityAuditRecord,
} from '../../src/domain/ports/pdp.ports';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('ManageM2mCredentialsUseCase & RetirePdpJwksKeyUseCase — Unit Tests (005)', () => {
  const APP_ID = '11111111-1111-4111-8111-111111111111';

  let store: Map<string, M2mClientCredential>;
  let revokedCacheSet: Set<string>;
  let auditEvents: PdpTransactionalSecurityAuditRecord[];
  let m2mRepo: M2mCredentialRepositoryPort;
  let l2Cache: PdpL2CachePort;
  let auditPort: PdpAuditPort;

  beforeEach(() => {
    store = new Map<string, M2mClientCredential>();
    revokedCacheSet = new Set<string>();
    auditEvents = [];

    m2mRepo = {
      findByClientId: jest.fn(
        async (clientId: string) => store.get(clientId) ?? null,
      ),
      createCredential: jest.fn(async (input) => {
        const expDays = input.expiresInDays ?? 90;
        const created: M2mClientCredential = {
          credencial_id: input.credencialId ?? crypto.randomUUID(),
          aplicacion_id: input.aplicacionId,
          tipo_cliente: input.tipoCliente,
          client_id: input.clientId,
          secreto_activo_hash: input.secretoActivoHash,
          secreto_anterior_hash: null,
          gracia_hasta: null,
          expira_rotacion_en: new Date(
            Date.now() + expDays * 24 * 60 * 60 * 1000,
          ),
          scopes_permitidos: input.scopesPermitidos ?? 'pdp:evaluate',
          estado_credencial: 'ACTIVA',
        };
        store.set(input.clientId, created);
        return created;
      }),
      rotateCredentialSecret: jest.fn(async (input) => {
        const existing = store.get(input.clientId);
        if (!existing || existing.estado_credencial === 'REVOCADA') {
          return null;
        }
        const graceSeconds = input.graceWindowSeconds ?? 86400;
        const expDays = input.expiresInDays ?? 90;
        const updated: M2mClientCredential = {
          ...existing,
          secreto_anterior_hash: existing.secreto_activo_hash,
          secreto_activo_hash: input.nuevoSecretoHash,
          gracia_hasta: new Date(Date.now() + graceSeconds * 1000),
          expira_rotacion_en: new Date(
            Date.now() + expDays * 24 * 60 * 60 * 1000,
          ),
          estado_credencial: 'EN_ROTACION_GRACIA',
        };
        store.set(input.clientId, updated);
        return updated;
      }),
      expireGraceWindow: jest.fn(async (clientId: string) => {
        const existing = store.get(clientId);
        if (!existing || existing.estado_credencial === 'REVOCADA') {
          return null;
        }
        const updated: M2mClientCredential = {
          ...existing,
          secreto_anterior_hash: null,
          gracia_hasta: null,
          estado_credencial: 'ACTIVA',
        };
        store.set(clientId, updated);
        return updated;
      }),
      revokeCredentialEmergency: jest.fn(async (clientId: string) => {
        const existing = store.get(clientId);
        if (!existing) {
          return null;
        }
        const updated: M2mClientCredential = {
          ...existing,
          secreto_anterior_hash: null,
          gracia_hasta: null,
          estado_credencial: 'REVOCADA',
        };
        store.set(clientId, updated);
        return updated;
      }),
    };

    l2Cache = {
      getPolicyBundle: jest.fn(async () => null),
      setPolicyBundle: jest.fn(async () => undefined),
      getPrecomputedDecision: jest.fn(async () => null),
      setPrecomputedDecision: jest.fn(async () => undefined),
      invalidateBySubject: jest.fn(async () => 0),
      invalidateByApplication: jest.fn(async () => 0),
      markM2mClientRevoked: jest.fn(async (clientId: string) => {
        revokedCacheSet.add(clientId);
      }),
      isM2mClientRevoked: jest.fn(async (clientId: string) =>
        revokedCacheSet.has(clientId),
      ),
      ping: jest.fn(async () => true),
    };

    auditPort = {
      emitStreamingEvaluationEvent: jest.fn(),
      recordTransactionalSecurityEvent: jest.fn(async (event) => {
        auditEvents.push(event);
      }),
    };
  });

  it('aprovisiona credencial APLICACION_PATRON_1 generando client_secret_unica_vez CSPRNG, persistiendo solo SHA-256 y registrando auditoría', async () => {
    const useCase = new ProvisionM2mCredentialUseCase(m2mRepo, auditPort);

    const res = await useCase.execute({
      client_id: 'm2m-siga-prod',
      tipo_cliente: 'APLICACION_PATRON_1',
      aplicacion_id: APP_ID,
      scopes_permitidos: 'pdp:evaluate',
      expires_in_days: 90,
      traceId: 'req-prov-001',
    });

    expect(res.client_id).toBe('m2m-siga-prod');
    expect(res.tipo_cliente).toBe('APLICACION_PATRON_1');
    expect(res.aplicacion_id).toBe(APP_ID);
    expect(res.client_secret_unica_vez.startsWith('m2m_sec_')).toBe(true);
    expect(res.estado_credencial).toBe('ACTIVA');

    const stored = store.get('m2m-siga-prod')!;
    expect(stored.secreto_activo_hash).toBe(sha256(res.client_secret_unica_vez));
    expect(stored.secreto_activo_hash).not.toBe(res.client_secret_unica_vez);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].tipoEvento).toBe('PDP_CREDENCIAL_M2M_CREADA');
  });

  it('rechaza aprovisionar APLICACION_PATRON_1 sin aplicacion_id o PEP_PATRON_2 con aplicacion_id', async () => {
    const useCase = new ProvisionM2mCredentialUseCase(m2mRepo, auditPort);

    await expect(
      useCase.execute({
        client_id: 'm2m-invalido-1',
        tipo_cliente: 'APLICACION_PATRON_1',
        aplicacion_id: null,
        traceId: 'req-err-1',
      }),
    ).rejects.toThrow(PdpInvalidSchemaError);

    await expect(
      useCase.execute({
        client_id: 'm2m-invalido-2',
        tipo_cliente: 'PEP_PATRON_2',
        aplicacion_id: APP_ID,
        traceId: 'req-err-2',
      }),
    ).rejects.toThrow(PdpInvalidSchemaError);
  });

  it('rota el secreto con ventana de gracia dual, expira la gracia y revoca de emergencia invalidando L2 Redis', async () => {
    const provisionUseCase = new ProvisionM2mCredentialUseCase(
      m2mRepo,
      auditPort,
    );
    const rotateUseCase = new RotateM2mCredentialSecretUseCase(
      m2mRepo,
      auditPort,
    );
    const expireGraceUseCase = new ExpireM2mCredentialGraceUseCase(
      m2mRepo,
      auditPort,
    );
    const revokeUseCase = new RevokeM2mCredentialUseCase(
      m2mRepo,
      l2Cache,
      auditPort,
    );

    const provisioned = await provisionUseCase.execute({
      client_id: 'm2m-pep-gateway',
      tipo_cliente: 'PEP_PATRON_2',
      aplicacion_id: null,
      traceId: 'req-1',
    });

    const rotated = await rotateUseCase.execute({
      client_id: 'm2m-pep-gateway',
      grace_window_seconds: 86400,
      expires_in_days: 90,
      traceId: 'req-2',
    });

    expect(rotated.estado_credencial).toBe('EN_ROTACION_GRACIA');
    expect(rotated.client_secret_unica_vez).not.toBe(
      provisioned.client_secret_unica_vez,
    );

    const inGraceRecord = store.get('m2m-pep-gateway')!;
    expect(inGraceRecord.secreto_activo_hash).toBe(
      sha256(rotated.client_secret_unica_vez),
    );
    expect(inGraceRecord.secreto_anterior_hash).toBe(
      sha256(provisioned.client_secret_unica_vez),
    );

    const expiredGrace = await expireGraceUseCase.execute({
      client_id: 'm2m-pep-gateway',
      traceId: 'req-3',
    });
    expect(expiredGrace.estado_credencial).toBe('ACTIVA');
    expect(store.get('m2m-pep-gateway')!.secreto_anterior_hash).toBeNull();

    const revoked = await revokeUseCase.execute({
      client_id: 'm2m-pep-gateway',
      traceId: 'req-4',
    });
    expect(revoked.revoked).toBe(true);
    expect(revoked.estado_credencial).toBe('REVOCADA');
    expect(revokedCacheSet.has('m2m-pep-gateway')).toBe(true);
  });

  it('retira una llave JWKS en GRACIA_VERIFICACION pasando su estado a RETIRADA', async () => {
    const jwksKeys = new Map<string, PdpSigningKeyRecord>([
      [
        'pdp-rs256-old',
        {
          kid: 'pdp-rs256-old',
          servicio_emisor: 'MOTOR_PDP',
          algoritmo: 'RS256',
          secret_manager_version: 'v1',
          public_jwk_json: {
            kty: 'RSA',
            use: 'sig',
            alg: 'RS256',
            kid: 'pdp-rs256-old',
            n: 'modulus',
            e: 'AQAB',
          },
          estado_llave: 'GRACIA_VERIFICACION',
          activada_en: new Date('2026-01-01T00:00:00.000Z'),
          expira_rotacion_en: new Date('2026-04-01T00:00:00.000Z'),
          retirada_en: null,
        },
      ],
    ]);

    const jwksRepo: PdpJwksKeyRepositoryPort = {
      listActiveAndGraceKeys: jest.fn(async () => []),
      getActiveSigningKey: jest.fn(async () => null),
      rotateSigningKey: jest.fn(async () => {
        throw new Error('not used');
      }),
      revokeKeyEmergency: jest.fn(async () => null),
      retireGraceKey: jest.fn(async (kid: string) => {
        const key = jwksKeys.get(kid);
        if (!key || key.estado_llave !== 'GRACIA_VERIFICACION') {
          return null;
        }
        key.estado_llave = 'RETIRADA';
        return {
          kid,
          estado_llave: 'RETIRADA' as const,
        };
      }),
    };

    const retireUseCase = new RetirePdpJwksKeyUseCase(jwksRepo, auditPort);
    const result = await retireUseCase.execute({
      kid: 'pdp-rs256-old',
      traceId: 'req-retire-1',
    });

    expect(result).toEqual({
      retired: true,
      kid: 'pdp-rs256-old',
      estado_llave: 'RETIRADA',
    });
    expect(jwksKeys.get('pdp-rs256-old')?.estado_llave).toBe('RETIRADA');
    expect(auditEvents.at(-1)?.tipoEvento).toBe('PDP_JWKS_RETIRADO');
  });
});
