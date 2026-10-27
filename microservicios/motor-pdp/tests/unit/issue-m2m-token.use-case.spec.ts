/**
 * Pruebas Unitarias — `IssueM2mTokenUseCase` (`T025`).
 *
 * Cubre:
 * - Validación de `grant_type=client_credentials` y comparación `crypto.timingSafeEqual` sobre hash SHA-256.
 * - Ventana de gracia dual (`secreto_anterior_hash` válido cuando `EN_ROTACION_GRACIA` y `gracia_hasta >= now()`).
 * - Rechazo cuando `gracia_hasta` ha expirado, cuando la credencial está `REVOCADA` o cuando excede la rotación de 90 días (`expira_rotacion_en < now()`).
 * - Auditoría transaccional `PDP_TOKEN_M2M_EMITIDO` y `PDP_TOKEN_M2M_RECHAZADO`.
 */

import crypto from 'node:crypto';
import { IssueM2mTokenUseCase } from '../../src/application/use-cases/issue-m2m-token.use-case';
import { M2mClientCredential } from '../../src/domain/entities/pdp-domain.entities';
import {
  PdpBadRequestError,
  PdpUnauthorizedM2mError,
} from '../../src/domain/errors/pdp-domain.errors';
import {
  M2mCredentialRepositoryPort,
  PdpAssertionSignerPort,
  PdpAuditPort,
  PdpTransactionalSecurityAuditRecord,
} from '../../src/domain/ports/pdp.ports';

function sha256(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

describe('IssueM2mTokenUseCase — Unit Tests (T025)', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  const credentials = new Map<string, M2mClientCredential>();
  const securityEvents: PdpTransactionalSecurityAuditRecord[] = [];

  const mockRepo: M2mCredentialRepositoryPort = {
    findByClientId: async (clientId) => credentials.get(clientId) ?? null,
  };

  const mockSigner: PdpAssertionSignerPort = {
    signAssertionJwt: async () => 'signed-assertion',
    buildInjectedHeaders: () => ({}),
    signM2mAccessToken: async ({ clientId, scope }) => ({
      accessToken: `jwt-for-${clientId}-${scope}`,
      expiresIn: 3600,
    }),
    verifyM2mAccessToken: async () => {
      throw new Error('not used');
    },
    generateAndRotateKeyPair: async () => {
      throw new Error('not used');
    },
  };

  const mockAudit: PdpAuditPort = {
    emitStreamingEvaluationEvent: () => {},
    recordTransactionalSecurityEvent: async (rec) => {
      securityEvents.push(rec);
    },
  };

  const useCase = new IssueM2mTokenUseCase(mockRepo, mockSigner, mockAudit);

  beforeEach(() => {
    credentials.clear();
    securityEvents.length = 0;

    credentials.set('app-siga-m2m', {
      credencial_id: 'cred-1',
      aplicacion_id: '11111111-1111-4111-8111-111111111111',
      tipo_cliente: 'APLICACION_PATRON_1',
      client_id: 'app-siga-m2m',
      secreto_activo_hash: sha256('secreto-activo-2026'),
      secreto_anterior_hash: sha256('secreto-anterior-gracia'),
      gracia_hasta: new Date('2026-06-02T00:00:00.000Z'),
      expira_rotacion_en: new Date('2026-08-15T00:00:00.000Z'),
      scopes_permitidos: 'pdp:evaluate',
      estado_credencial: 'EN_ROTACION_GRACIA',
    });
  });

  it('emite token M2M cuando el secreto activo coincide y registra PDP_TOKEN_M2M_EMITIDO', async () => {
    const result = await useCase.execute({
      grantType: 'client_credentials',
      clientId: 'app-siga-m2m',
      clientSecret: 'secreto-activo-2026',
      scope: 'pdp:evaluate',
      now,
    });

    expect(result).toEqual({
      access_token: 'jwt-for-app-siga-m2m-pdp:evaluate',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'pdp:evaluate',
    });
    expect(securityEvents).toHaveLength(1);
    expect(securityEvents[0]?.tipoEvento).toBe('PDP_TOKEN_M2M_EMITIDO');
    expect(securityEvents[0]?.valoresNuevos.matched_grace_secret).toBe(false);
  });

  it('acepta secreto_anterior_hash durante la ventana de gracia activa (EN_ROTACION_GRACIA y gracia_hasta >= now)', async () => {
    const result = await useCase.execute({
      grantType: 'client_credentials',
      clientId: 'app-siga-m2m',
      clientSecret: 'secreto-anterior-gracia',
      scope: 'pdp:evaluate',
      now,
    });

    expect(result.access_token).toBe('jwt-for-app-siga-m2m-pdp:evaluate');
    expect(securityEvents[0]?.valoresNuevos.matched_grace_secret).toBe(true);
  });

  it('rechaza secreto_anterior_hash una vez expirada la ventana gracia_hasta', async () => {
    const afterGrace = new Date('2026-06-03T00:00:00.000Z');

    await expect(
      useCase.execute({
        grantType: 'client_credentials',
        clientId: 'app-siga-m2m',
        clientSecret: 'secreto-anterior-gracia',
        scope: 'pdp:evaluate',
        now: afterGrace,
      }),
    ).rejects.toThrow(PdpUnauthorizedM2mError);

    expect(securityEvents.at(-1)?.tipoEvento).toBe('PDP_TOKEN_M2M_RECHAZADO');
  });

  it('rechaza credenciales en estado REVOCADA o con rotación vencida (> 90 días)', async () => {
    const base = credentials.get('app-siga-m2m')!;
    credentials.set('app-siga-m2m', {
      ...base,
      estado_credencial: 'REVOCADA',
    });

    await expect(
      useCase.execute({
        grantType: 'client_credentials',
        clientId: 'app-siga-m2m',
        clientSecret: 'secreto-activo-2026',
        now,
      }),
    ).rejects.toThrow(PdpUnauthorizedM2mError);

    credentials.set('app-siga-m2m', {
      ...base,
      estado_credencial: 'ACTIVA',
      expira_rotacion_en: new Date('2026-05-01T00:00:00.000Z'),
    });

    await expect(
      useCase.execute({
        grantType: 'client_credentials',
        clientId: 'app-siga-m2m',
        clientSecret: 'secreto-activo-2026',
        now,
      }),
    ).rejects.toThrow(PdpUnauthorizedM2mError);
  });

  it('rechaza grant_type distinto de client_credentials y scopes no autorizados', async () => {
    await expect(
      useCase.execute({
        grantType: 'authorization_code',
        clientId: 'app-siga-m2m',
        clientSecret: 'secreto-activo-2026',
        now,
      }),
    ).rejects.toThrow(PdpBadRequestError);

    await expect(
      useCase.execute({
        grantType: 'client_credentials',
        clientId: 'app-siga-m2m',
        clientSecret: 'secreto-activo-2026',
        scope: 'admin:full',
        now,
      }),
    ).rejects.toThrow(PdpBadRequestError);
  });
});
