/**
 * Pruebas de Integración (`Supertest`) — JWKS y Rotación de Llaves RS256 (`PdpJwksController`) (`T038`).
 *
 * Cubre:
 * - `GET /api/v1/.well-known/jwks.json` con `Cache-Control: public, max-age=3600`.
 * - `POST /internal/v1/pdp/jwks/rotate` (rotación <= 90 días con ventana de gracia dual: llave anterior pasa a `GRACIA_VERIFICACION` y sigue publicada junto con la nueva llave `ACTIVA_FIRMA`).
 * - Verificación de que un token firmado con el `kid` anterior sigue siendo válido durante la ventana de gracia.
 * - `POST /internal/v1/pdp/jwks/:kid/revoke` (revocación de emergencia < 1 h que retira inmediatamente la llave del JWKS público).
 */

import crypto from 'node:crypto';
import * as jose from 'jose';
import request from 'supertest';
import { createMotorPdpApp } from '../../src/app';
import { AlloyDbPdpJwksKeyRepository } from '../../src/infrastructure/database/repositories/alloydb-pdp-jwks-key.repository';

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val, 'utf8').digest('hex');
}

describe('PdpJwksController & RS256 Key Rotation — Integration Tests (T038)', () => {
  const inMemoryJwksRepo = new AlloyDbPdpJwksKeyRepository();

  const app = createMotorPdpApp({
    pdpJwksRepo: inMemoryJwksRepo,
    m2mCredentialRepo: {
      findByClientId: async () => ({
        credencial_id: 'c-1',
        aplicacion_id: null,
        tipo_cliente: 'PEP_PATRON_2',
        client_id: 'pep-client',
        secreto_activo_hash: sha256('pep-secret'),
        secreto_anterior_hash: null,
        gracia_hasta: null,
        expira_rotacion_en: new Date('2099-01-01T00:00:00.000Z'),
        scopes_permitidos: 'pdp:evaluate',
        estado_credencial: 'ACTIVA',
      }),
    },
  });

  it('publica JWKS con Cache-Control, rota llave RS256 manteniendo la anterior en GRACIA_VERIFICACION y permite revocación de emergencia (< 1 h)', async () => {
    // 1. Emitir un token inicial (inicializa la primera llave RS256 en el signer)
    const token1Res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'pep-client',
        client_secret: 'pep-secret',
      })
      .expect(200);

    const decodedHeader1 = jose.decodeProtectedHeader(
      token1Res.body.access_token,
    );
    const initialKid = decodedHeader1.kid!;
    expect(initialKid).toBeTruthy();

    // 2. Consultar JWKS público
    const jwks1Res = await request(app)
      .get('/api/v1/.well-known/jwks.json')
      .expect(200);

    expect(jwks1Res.headers['cache-control']).toBe('public, max-age=3600');
    expect(jwks1Res.body.keys).toHaveLength(1);
    expect(jwks1Res.body.keys[0].kid).toBe(initialKid);

    // 3. Rotar llave de firma RS256 -> la llave inicial pasa a GRACIA_VERIFICACION y la nueva pasa a ACTIVA_FIRMA
    const rotateRes = await request(app)
      .post('/internal/v1/pdp/jwks/rotate')
      .send({
        kid: 'pdp-rs256-rotated-2026q3',
      })
      .expect(200);

    expect(rotateRes.body.rotatedKey.kid).toBe('pdp-rs256-rotated-2026q3');
    expect(rotateRes.body.previousKeyKid).toBe(initialKid);

    // 4. JWKS ahora expone ambas llaves (ACTIVA_FIRMA + GRACIA_VERIFICACION)
    const jwks2Res = await request(app)
      .get('/api/v1/.well-known/jwks.json')
      .expect(200);

    const publishedKids = jwks2Res.body.keys.map(
      (k: { kid: string }) => k.kid,
    );
    expect(publishedKids).toContain('pdp-rs256-rotated-2026q3');
    expect(publishedKids).toContain(initialKid);

    // 5. El token emitido con la llave anterior (en gracia) sigue siendo verificable contra el JWKS
    const jwksSet = jose.createLocalJWKSet(jwks2Res.body);
    const verifiedOldToken = await jose.jwtVerify(
      token1Res.body.access_token,
      jwksSet,
    );
    expect(verifiedOldToken.payload.sub).toBe('pep-client');

    // 6. Revocar de emergencia la llave anterior (< 1 h) -> desaparece inmediatamente del JWKS
    const revokeRes = await request(app)
      .post(`/internal/v1/pdp/jwks/${initialKid}/revoke`)
      .expect(200);

    expect(revokeRes.body).toMatchObject({
      revoked: true,
      kid: initialKid,
    });

    const jwks3Res = await request(app)
      .get('/api/v1/.well-known/jwks.json')
      .expect(200);

    const remainingKids = jwks3Res.body.keys.map(
      (k: { kid: string }) => k.kid,
    );
    expect(remainingKids).toEqual(['pdp-rs256-rotated-2026q3']);

    // 7. Rotar nuevamente y probar el retiro limpio de ventana de gracia (/internal/v1/pdp/jwks/:kid/retire)
    await request(app)
      .post('/internal/v1/pdp/jwks/rotate')
      .send({
        kid: 'pdp-rs256-rotated-2026q4',
      })
      .expect(200);

    const retireRes = await request(app)
      .post('/internal/v1/pdp/jwks/pdp-rs256-rotated-2026q3/retire')
      .expect(200);

    expect(retireRes.body).toEqual({
      retired: true,
      kid: 'pdp-rs256-rotated-2026q3',
      estado_llave: 'RETIRADA',
    });

    const jwks4Res = await request(app)
      .get('/api/v1/.well-known/jwks.json')
      .expect(200);

    expect(jwks4Res.body.keys.map((k: { kid: string }) => k.kid)).toEqual([
      'pdp-rs256-rotated-2026q4',
    ]);
  });
});
