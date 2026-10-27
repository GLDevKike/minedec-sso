/**
 * Pruebas Unitarias — `RouteNormalizerAndMatcherService` (`T030`).
 *
 * Cubre:
 * - Rechazo determinístico de secuencias de evasión o path traversal (`%2F`, `%2f`, `%00`, `..`, `%5C`, `\`, `%2e%2e`, `%252f`).
 * - Normalización canónica (colapso de `//`, remoción de query string `?` y barra final).
 * - Orden determinista de precedencia (`1. EXACTA` > `2. PREFIJO` más específico > `3. EXTENSION` > `politica_ruta_defecto`).
 */

import {
  ApplicationPolicyBundle,
  RouteCatalogEntry,
} from '../../src/domain/entities/pdp-domain.entities';
import { PdpSecurityRejectionError } from '../../src/domain/errors/pdp-domain.errors';
import { RouteNormalizerAndMatcherService } from '../../src/domain/services/route-normalizer-matcher.service';

describe('RouteNormalizerAndMatcherService — Unit Tests (T030)', () => {
  const service = new RouteNormalizerAndMatcherService();

  it('normaliza rutas canónicas colapsando barras múltiples, removiendo query/hash y barra final', () => {
    expect(service.normalizeRoute('/api//v1///calificaciones/?periodo=2026#top')).toBe(
      '/api/v1/calificaciones',
    );
    expect(service.normalizeRoute('/')).toBe('/');
  });

  it.each([
    ['/api/v1/%2Fadmin', '%2F'],
    ['/api/v1/%2fadmin', '%2f'],
    ['/api/v1/archivo%00.pdf', '%00'],
    ['/api/v1/../secretos', '..'],
    ['/api/v1/./interna', '.'],
    ['/api/v1/%2e%2e/secretos', '%2e%2e'],
    ['/api/v1/%5Cwindows', '%5C'],
    ['/api\\v1\\windows', '\\'],
    ['/api/v1/%252fadmin', 'doble codificación %252f'],
    ['ruta-sin-barra-inicial', 'sin "/" inicial'],
    ['   ', 'vacía'],
  ])(
    'rechaza ruta ambigua o maliciosa "%s" (%s) con PdpSecurityRejectionError (HTTP 400)',
    (maliciousRoute) => {
      expect(() => service.normalizeRoute(maliciousRoute)).toThrow(
        PdpSecurityRejectionError,
      );
    },
  );

  it('aplica precedencia determinista: 1. EXACTA > 2. PREFIJO (mayor longitud) > 3. EXTENSION > politica_ruta_defecto', () => {
    const routes: RouteCatalogEntry[] = [
      {
        ruta_id: 'r-ext',
        aplicacion_id: 'app-1',
        patron_ruta: '*.pdf',
        metodo_http: 'GET',
        tipo_coincidencia: 'EXTENSION',
        nivel_acceso: 'PUBLICA',
        modo_evaluacion_permisos: 'ANY',
        orden_especificidad: 10,
        modo_sombra: false,
        activo: true,
        permisos_requeridos: [],
      },
      {
        ruta_id: 'r-pref-short',
        aplicacion_id: 'app-1',
        patron_ruta: '/api/*',
        metodo_http: 'GET',
        tipo_coincidencia: 'PREFIJO',
        nivel_acceso: 'AUTENTICADA',
        modo_evaluacion_permisos: 'ANY',
        orden_especificidad: 20,
        modo_sombra: false,
        activo: true,
        permisos_requeridos: [],
      },
      {
        ruta_id: 'r-pref-long',
        aplicacion_id: 'app-1',
        patron_ruta: '/api/reportes/*',
        metodo_http: 'GET',
        tipo_coincidencia: 'PREFIJO',
        nivel_acceso: 'PROTEGIDA',
        modo_evaluacion_permisos: 'ANY',
        orden_especificidad: 30,
        modo_sombra: false,
        activo: true,
        permisos_requeridos: [],
      },
      {
        ruta_id: 'r-exact',
        aplicacion_id: 'app-1',
        patron_ruta: '/api/reportes/publico.pdf',
        metodo_http: 'GET',
        tipo_coincidencia: 'EXACTA',
        nivel_acceso: 'PUBLICA',
        modo_evaluacion_permisos: 'ANY',
        orden_especificidad: 40,
        modo_sombra: false,
        activo: true,
        permisos_requeridos: [],
      },
    ];

    const bundle: ApplicationPolicyBundle = {
      aplicacion_id: 'app-1',
      codigo_unico: 'APP_TEST',
      nombre_visible: 'App Test',
      patron_integracion: 'PATRON_2_PEP_PERIMETRAL',
      nivel_adopcion_pep: 'PROTEGIDA',
      host_publico: 'test.educacion.gob.ec',
      politica_ruta_defecto: 'PROTEGIDA',
      modo_sombra: false,
      estado_ciclo_vida: 'PUBLICADO',
      version_catalogo: 1,
      rutas_ordenadas: routes,
      grupos_logicos: [],
      roles_mapa: {},
      perfiles_mapa: {},
      rol_id_a_codigo: {},
      perfil_id_a_codigo: {},
    };

    // 1. EXACTA gana sobre PREFIJO y EXTENSION
    const exactMatch = service.resolveRoute(
      bundle,
      '/api/reportes/publico.pdf',
      'GET',
    );
    expect(exactMatch.matchedRoute?.ruta_id).toBe('r-exact');
    expect(exactMatch.effectiveAccessLevel).toBe('PUBLICA');

    // 2. PREFIJO más largo (/api/reportes/*) gana sobre PREFIJO más corto (/api/*) y sobre EXTENSION (*.pdf)
    const longPrefixMatch = service.resolveRoute(
      bundle,
      '/api/reportes/confidencial.pdf',
      'GET',
    );
    expect(longPrefixMatch.matchedRoute?.ruta_id).toBe('r-pref-long');
    expect(longPrefixMatch.effectiveAccessLevel).toBe('PROTEGIDA');

    // 3. PREFIJO corto (/api/*) gana cuando no coincide el largo
    const shortPrefixMatch = service.resolveRoute(
      bundle,
      '/api/usuarios/listado',
      'GET',
    );
    expect(shortPrefixMatch.matchedRoute?.ruta_id).toBe('r-pref-short');
    expect(shortPrefixMatch.effectiveAccessLevel).toBe('AUTENTICADA');

    // 4. EXTENSION (*.pdf) gana cuando no hay EXACTA ni PREFIJO
    const extMatch = service.resolveRoute(
      bundle,
      '/descargas/manual-docente.pdf',
      'GET',
    );
    expect(extMatch.matchedRoute?.ruta_id).toBe('r-ext');
    expect(extMatch.effectiveAccessLevel).toBe('PUBLICA');

    // 5. Fallback a politica_ruta_defecto cuando ninguna regla coincide
    const defaultMatch = service.resolveRoute(
      bundle,
      '/otra-ruta/no-catalogada',
      'POST',
    );
    expect(defaultMatch.matchedRoute).toBeNull();
    expect(defaultMatch.effectiveAccessLevel).toBe('PROTEGIDA');
  });
});
