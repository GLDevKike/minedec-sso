/**
 * Servicio de Dominio Puro: Normalizador Perimetral y Clasificador de Rutas (`motor-pdp`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, VI y XIII):
 * - Cero decoradores (`@injectable`, `@inject`) e imports de infraestructura.
 * - Rechaza de forma determinística secuencias de path traversal o evasión (`%2F`, `%2f`, `%00`, `..`, `%5C`, `\`, doble codificación).
 * - Precedencia determinista de coincidencia: `1. EXACTA` > `2. PREFIJO` (mayor longitud) > `3. EXTENSION` > `politica_ruta_defecto`.
 */

import {
  ApplicationPolicyBundle,
  HttpMethodType,
  RouteAccessLevel,
  RouteCatalogEntry,
} from '../entities/pdp-domain.entities';
import { PdpSecurityRejectionError } from '../errors/pdp-domain.errors';

export interface RouteMatchResolution {
  normalizedPath: string;
  matchedRoute: RouteCatalogEntry | null;
  effectiveAccessLevel: RouteAccessLevel;
  effectiveShadowMode: boolean;
  policyTraceTag: string;
}

const FORBIDDEN_RAW_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  {
    pattern: /%2f/i,
    reason: 'Barra codificada (%2F) no permitida en ruta_solicitada',
  },
  {
    pattern: /%5c/i,
    reason: ' Barra invertida codificada (%5C) no permitida en ruta_solicitada',
  },
  {
    pattern: /%00/i,
    reason: 'Byte nulo (%00) no permitido en ruta_solicitada',
  },
  {
    pattern: /\0/,
    reason: 'Carácter nulo literal no permitido en ruta_solicitada',
  },
  {
    pattern: /\\/,
    reason: 'Barra invertida literal (\\) no permitida en ruta_solicitada',
  },
  {
    pattern: /%2e%2e/i,
    reason: 'Secuencia de salto de directorio codificada (%2e%2e) no permitida',
  },
  {
    pattern: /%25(?:2f|5c|00|2e)/i,
    reason: 'Doble codificación URL (%25...) no permitida en ruta_solicitada',
  },
];

export class RouteNormalizerAndMatcherService {
  /**
   * Valida y normaliza canónicamente la ruta solicitada.
   * Lanza `PdpSecurityRejectionError` (`HTTP 400`) ante cualquier intento de path traversal o ambigüedad.
   */
  public normalizeAndValidateRoute(rawRoute: string): string {
    const trimmed = rawRoute.trim();
    if (!trimmed || !trimmed.startsWith('/')) {
      throw new PdpSecurityRejectionError(
        'La ruta solicitada debe comenzar con "/" y no estar vacía',
        rawRoute,
      );
    }

    for (const rule of FORBIDDEN_RAW_PATTERNS) {
      if (rule.pattern.test(trimmed)) {
        throw new PdpSecurityRejectionError(rule.reason.trim(), rawRoute);
      }
    }

    // Extraer solo el pathname antes de query string (?) o fragmento (#)
    const pathOnly = trimmed.split(/[?#]/)[0] || '/';

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(pathOnly);
    } catch {
      throw new PdpSecurityRejectionError(
        'Codificación URL mal formada en ruta_solicitada',
        rawRoute,
      );
    }

    if (decodedPath.includes('\\') || decodedPath.includes('\0')) {
      throw new PdpSecurityRejectionError(
        'Caracteres de control o barra invertida tras decodificación',
        rawRoute,
      );
    }

    // Colapsar barras múltiples consecutivas (// -> /)
    const collapsed = decodedPath.replace(/\/+/g, '/');

    // Verificar segmentos de navegación relativa (`.` o `..`)
    const segments = collapsed.split('/');
    for (const seg of segments) {
      if (seg === '..' || seg === '.') {
        throw new PdpSecurityRejectionError(
          'Navegación relativa de directorios (".." o ".") prohibida en ruta_solicitada',
          rawRoute,
        );
      }
    }

    // Remover barra diagonal final salvo para la raíz "/"
    if (collapsed.length > 1 && collapsed.endsWith('/')) {
      return collapsed.slice(0, -1);
    }

    return collapsed;
  }

  /**
   * Alias de conveniencia para normalización y validación de ruta.
   */
  public normalizeRoute(rawRoute: string): string {
    return this.normalizeAndValidateRoute(rawRoute);
  }

  /**
   * Coincide una ruta normalizada contra el catálogo de rutas ordenadas.
   */
  public matchRoute(
    rawOrNormalizedRoute: string,
    httpMethod: HttpMethodType,
    rutasOrdenadas: RouteCatalogEntry[],
  ): RouteCatalogEntry | null {
    const tempBundle = {
      rutas_ordenadas: rutasOrdenadas,
      politica_ruta_defecto: 'PROTEGIDA' as RouteAccessLevel,
      modo_sombra: false,
    } as ApplicationPolicyBundle;
    return this.resolveRoute(tempBundle, rawOrNormalizedRoute, httpMethod)
      .matchedRoute;
  }

  /**
   * Resuelve la entrada del catálogo de rutas aplicable según la precedencia determinista:
   * 1. `EXACTA`
   * 2. `PREFIJO` (de mayor longitud de segmentos/caracteres)
   * 3. `EXTENSION`
   * 4. `aplicacion.politica_ruta_defecto`
   */
  public resolveRoute(
    bundle: ApplicationPolicyBundle,
    rawRoute: string,
    httpMethod: HttpMethodType,
  ): RouteMatchResolution {
    const normalizedPath = this.normalizeAndValidateRoute(rawRoute);
    const activeRoutes = bundle.rutas_ordenadas.filter(
      (r) =>
        r.activo && (r.metodo_http === httpMethod || r.metodo_http === 'ALL'),
    );

    const exactCandidates: RouteCatalogEntry[] = [];
    const prefixCandidates: Array<{
      route: RouteCatalogEntry;
      prefixLength: number;
      segmentCount: number;
    }> = [];
    const extensionCandidates: RouteCatalogEntry[] = [];

    for (const route of activeRoutes) {
      const normalizedPattern = this.normalizePatternForComparison(
        route.patron_ruta,
      );

      if (route.tipo_coincidencia === 'EXACTA') {
        if (normalizedPattern === normalizedPath) {
          exactCandidates.push(route);
        }
      } else if (route.tipo_coincidencia === 'PREFIJO') {
        const cleanPrefix = normalizedPattern.endsWith('/*')
          ? normalizedPattern.slice(0, -2) || '/'
          : normalizedPattern.endsWith('*')
            ? normalizedPattern.slice(0, -1) || '/'
            : normalizedPattern;

        const matchesPrefix =
          cleanPrefix === '/' ||
          normalizedPath === cleanPrefix ||
          normalizedPath.startsWith(`${cleanPrefix}/`);

        if (matchesPrefix) {
          const segmentCount =
            cleanPrefix === '/'
              ? 0
              : cleanPrefix.split('/').filter(Boolean).length;
          prefixCandidates.push({
            route,
            prefixLength: cleanPrefix.length,
            segmentCount,
          });
        }
      } else if (route.tipo_coincidencia === 'EXTENSION') {
        const ext = normalizedPattern.startsWith('*.')
          ? normalizedPattern.slice(1)
          : normalizedPattern.startsWith('.')
            ? normalizedPattern
            : `.${normalizedPattern.replace(/^\/+/, '')}`;

        if (normalizedPath.toLowerCase().endsWith(ext.toLowerCase())) {
          extensionCandidates.push(route);
        }
      }
    }

    let matchedRoute: RouteCatalogEntry | null = null;

    if (exactCandidates.length > 0) {
      exactCandidates.sort((a, b) =>
        this.compareMethodAndSpecificity(a, b, httpMethod),
      );
      matchedRoute = exactCandidates[0] ?? null;
    } else if (prefixCandidates.length > 0) {
      prefixCandidates.sort((a, b) => {
        if (b.segmentCount !== a.segmentCount) {
          return b.segmentCount - a.segmentCount;
        }
        if (b.prefixLength !== a.prefixLength) {
          return b.prefixLength - a.prefixLength;
        }
        return this.compareMethodAndSpecificity(a.route, b.route, httpMethod);
      });
      matchedRoute = prefixCandidates[0]?.route ?? null;
    } else if (extensionCandidates.length > 0) {
      extensionCandidates.sort((a, b) =>
        this.compareMethodAndSpecificity(a, b, httpMethod),
      );
      matchedRoute = extensionCandidates[0] ?? null;
    }

    if (matchedRoute) {
      return {
        normalizedPath,
        matchedRoute,
        effectiveAccessLevel: matchedRoute.nivel_acceso,
        effectiveShadowMode: Boolean(
          bundle.modo_sombra || matchedRoute.modo_sombra,
        ),
        policyTraceTag: `RUTA_${matchedRoute.nivel_acceso}:${matchedRoute.patron_ruta}`,
      };
    }

    return {
      normalizedPath,
      matchedRoute: null,
      effectiveAccessLevel: bundle.politica_ruta_defecto,
      effectiveShadowMode: Boolean(bundle.modo_sombra),
      policyTraceTag: `POLITICA_RUTA_DEFECTO:${bundle.politica_ruta_defecto}`,
    };
  }

  private normalizePatternForComparison(pattern: string): string {
    const trimmed = pattern.trim();
    if (trimmed.length > 1 && trimmed.endsWith('/') && !trimmed.endsWith('/*')) {
      return trimmed.slice(0, -1);
    }
    return trimmed;
  }

  private compareMethodAndSpecificity(
    a: RouteCatalogEntry,
    b: RouteCatalogEntry,
    requestedMethod: HttpMethodType,
  ): number {
    const aExactMethod = a.metodo_http === requestedMethod ? 0 : 1;
    const bExactMethod = b.metodo_http === requestedMethod ? 0 : 1;
    if (aExactMethod !== bExactMethod) {
      return aExactMethod - bExactMethod;
    }
    return a.orden_especificidad - b.orden_especificidad;
  }
}
