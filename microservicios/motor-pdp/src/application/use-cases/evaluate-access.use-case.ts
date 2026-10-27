/**
 * Caso de Uso: Evaluación de Autorización RBAC + ABAC (`EvaluateAccessUseCase`) — `motor-pdp` (`T023`, `T035`).
 *
 * Cumplimiento Constitucional (v2.10.0, Principios III, V, VI, X y XIII):
 * - 100 % libre de decoradores (`@injectable`, `@inject`) e imports de infraestructura.
 * - Orquesta normalización de ruta, caché L2 (`TTL <= 300 s`), evaluación RBAC+ABAC,
 *   Modo Sombra (`AUTHZ_PERMITTED_SHADOW_MODE`), firma `RS256` (`assertion_jwt`)
 *   y auditoría de streaming hacia Cloud Logging -> BigQuery.
 * - Degradación `Fail-Close` (`503 AUTHZ_SERVICE_UNAVAILABLE_FAIL_CLOSE`).
 * - Cero cálculo ni exposición de latencia en Node.js.
 */

import {
  AccessDecision,
  ApplicationPolicyBundle,
  HttpMethodType,
  M2mTokenClaims,
  PrecomputedAuthorizationDecision,
} from '../../domain/entities/pdp-domain.entities';
import {
  PdpApplicationNotFoundError,
  PdpDomainError,
  PdpFailCloseUnavailableError,
  PdpForbiddenM2mScopeError,
  PdpSecurityRejectionError,
} from '../../domain/errors/pdp-domain.errors';
import {
  AssertionSigningInput,
  IdentityAuthorizationRepositoryPort,
  PdpAssertionSignerPort,
  PdpAuditPort,
  PdpL2CachePort,
  PolicyBundleRepositoryPort,
} from '../../domain/ports/pdp.ports';
import { RbacAbacEvaluatorService } from '../../domain/services/rbac-abac-evaluator.service';
import { RouteNormalizerAndMatcherService } from '../../domain/services/route-normalizer-matcher.service';

export interface EvaluateAccessCommand {
  email_autenticado?: string | null;
  uuid_aplicacion?: string;
  codigo_aplicacion?: string;
  host_solicitado?: string;
  ruta_solicitada: string;
  metodo_http: HttpMethodType;
  atributos_contexto?: {
    ip_origen?: string;
    user_agent?: string;
    dispositivo_gestionado?: boolean;
    request_id?: string;
  };
  m2mClientClaims: M2mTokenClaims;
  traceId?: string;
  evaluationTimestamp?: Date;
}

export class EvaluateAccessUseCase {
  private readonly maxCacheTtlSeconds: number;

  constructor(
    private readonly policyBundleRepo: PolicyBundleRepositoryPort,
    private readonly identityRepo: IdentityAuthorizationRepositoryPort,
    private readonly l2Cache: PdpL2CachePort,
    private readonly routeMatcher: RouteNormalizerAndMatcherService,
    private readonly evaluator: RbacAbacEvaluatorService,
    private readonly assertionSigner: PdpAssertionSignerPort,
    private readonly auditPort: PdpAuditPort,
    maxCacheTtlSeconds = 300,
  ) {
    this.maxCacheTtlSeconds = Math.min(Math.max(1, maxCacheTtlSeconds), 300);
  }

  public async execute(
    command: EvaluateAccessCommand,
  ): Promise<AccessDecision> {
    let rutaNormalizada: string;
    try {
      rutaNormalizada = this.routeMatcher.normalizeRoute(
        command.ruta_solicitada,
      );
    } catch (error) {
      if (error instanceof PdpSecurityRejectionError) {
        await this.auditPort.recordTransactionalSecurityEvent({
          tipoEvento: 'PDP_RECHAZO_SEGURIDAD_RUTA',
          actorIdentificacion: command.m2mClientClaims.client_id,
          sujetoIdentificacion: null,
          correoAfectado: command.email_autenticado ?? null,
          entidadAfectada: 'ruta_catalogo',
          registroAfectadoId:
            command.codigo_aplicacion ??
            command.uuid_aplicacion ??
            command.host_solicitado ??
            'DESCONOCIDA',
          valoresNuevos: {
            ruta_solicitada: command.ruta_solicitada,
            metodo_http: command.metodo_http,
            motivo: error.message,
          },
          traceId: command.traceId,
        });
      }
      throw error;
    }

    try {
      const bundle = await this.resolveApplicationBundle(command);
      this.assertM2mScopeIsolation(command.m2mClientClaims, bundle);

      const matchedRoute = this.routeMatcher.matchRoute(
        rutaNormalizada,
        command.metodo_http,
        bundle.rutas_ordenadas,
      );

      const now = command.evaluationTimestamp ?? new Date();
      const emailNormalized = command.email_autenticado?.trim().toLowerCase();

      let precomputed: PrecomputedAuthorizationDecision | null = null;
      if (emailNormalized) {
        precomputed = await this.resolvePrecomputedSubjectDecision(
          emailNormalized,
          bundle,
          now,
        );
      }

      const routeEval = this.evaluator.evaluateRouteDecision({
        bundle,
        matchedRoute,
        precomputed,
      });

      let assertionJwt = '';
      let cabecerasInyectadas: Record<string, string> | undefined;

      if (routeEval.autorizado && precomputed) {
        const signingInput: AssertionSigningInput = {
          idInterno: precomputed.id_interno,
          emailPrincipal: precomputed.email_principal,
          tipoIdentificacion: precomputed.tipo_identificacion,
          numeroIdentificacion: precomputed.numero_identificacion,
          uuidAplicacion: bundle.aplicacion_id,
          codigoAplicacion: bundle.codigo_unico,
          roles: routeEval.roles,
          permisos: routeEval.permisos,
          permisosCrud: routeEval.permisos_crud,
          contextoTerritorial: routeEval.contexto_territorial,
          requestId:
            command.atributos_contexto?.request_id ?? command.traceId,
        };

        assertionJwt =
          await this.assertionSigner.signAssertionJwt(signingInput);

        if (bundle.patron_integracion === 'PATRON_2_PEP_PERIMETRAL') {
          cabecerasInyectadas = this.assertionSigner.buildInjectedHeaders(
            signingInput,
            assertionJwt,
          );
        }
      }

      const tipoEventoAudit =
        routeEval.codigo_decision === 'AUTHZ_PERMITTED_SHADOW_MODE'
          ? 'PDP_EVALUACION_SHADOW_PERMIT'
          : routeEval.autorizado
            ? 'PDP_EVALUACION_PERMIT'
            : 'PDP_EVALUACION_DENY';

      this.auditPort.emitStreamingEvaluationEvent({
        tipoEvento: tipoEventoAudit,
        aplicacionId: bundle.aplicacion_id,
        codigoAplicacion: bundle.codigo_unico,
        idInterno: precomputed?.id_interno ?? null,
        sujetoIdentificacion: precomputed?.numero_identificacion ?? null,
        correoAfectado: emailNormalized ?? null,
        rutaNormalizada,
        metodoHttp: command.metodo_http,
        autorizado: routeEval.autorizado,
        codigoDecision: routeEval.codigo_decision,
        decisionProyectada:
          routeEval.metadatos_depuracion?.decision_proyectada,
        modoSombra: Boolean(
          routeEval.metadatos_depuracion?.modo_sombra_activo,
        ),
        rolesEfectivos: routeEval.roles,
        permisosEfectivos: routeEval.permisos,
        politicasEvaluadas: routeEval.politicas_evaluadas,
        traceId: command.traceId,
      });

      const decision: AccessDecision = {
        autorizado: routeEval.autorizado,
        codigo_decision: routeEval.codigo_decision,
        numero_identificacion: precomputed?.numero_identificacion ?? 'ANONIMO',
        tipo_identificacion: precomputed?.tipo_identificacion ?? 'CEDULA',
        roles: routeEval.roles,
        permisos: routeEval.permisos,
        permisos_crud: routeEval.permisos_crud,
        contexto_territorial: routeEval.contexto_territorial,
        assertion_jwt: assertionJwt,
        ...(cabecerasInyectadas
          ? { cabeceras_inyectadas: cabecerasInyectadas }
          : {}),
        politicas_evaluadas: routeEval.politicas_evaluadas,
        cache_ttl_segundos: routeEval.autorizado
          ? (precomputed?.ttl_segundos ?? this.maxCacheTtlSeconds)
          : 0,
        timestamp: now.toISOString(),
        ...(routeEval.metadatos_depuracion
          ? { metadatos_depuracion: routeEval.metadatos_depuracion }
          : {}),
      };

      return decision;
    } catch (error) {
      if (error instanceof PdpDomainError) {
        throw error;
      }
      throw new PdpFailCloseUnavailableError(
        'Error interno o indisponibilidad de dependencias durante evaluación de autorización (Fail-Close)',
      );
    }
  }

  private async resolveApplicationBundle(
    command: EvaluateAccessCommand,
  ): Promise<ApplicationPolicyBundle> {
    if (command.codigo_aplicacion) {
      const cached = await this.l2Cache.getPolicyBundle(
        command.codigo_aplicacion,
      );
      if (cached) {
        if (cached.estado_ciclo_vida !== 'PUBLICADO') {
          throw new PdpApplicationNotFoundError();
        }
        return cached;
      }
    }

    const bundle = await this.policyBundleRepo.findPolicyBundle({
      uuid_aplicacion: command.uuid_aplicacion,
      codigo_unico: command.codigo_aplicacion,
      host_solicitado: command.host_solicitado,
    });

    if (!bundle || bundle.estado_ciclo_vida !== 'PUBLICADO') {
      throw new PdpApplicationNotFoundError();
    }

    await this.l2Cache.setPolicyBundle(bundle, this.maxCacheTtlSeconds);
    return bundle;
  }

  private assertM2mScopeIsolation(
    claims: M2mTokenClaims,
    bundle: ApplicationPolicyBundle,
  ): void {
    if (claims.tipo_cliente === 'APLICACION_PATRON_1') {
      if (
        !claims.aplicacion_id ||
        claims.aplicacion_id !== bundle.aplicacion_id
      ) {
        throw new PdpForbiddenM2mScopeError(
          `El cliente M2M (${claims.client_id}) de Patrón 1 solo está autorizado para evaluar su propia aplicación`,
        );
      }
    }
  }

  private async resolvePrecomputedSubjectDecision(
    emailNormalized: string,
    bundle: ApplicationPolicyBundle,
    now: Date,
  ): Promise<PrecomputedAuthorizationDecision | null> {
    const cachedDecision = await this.l2Cache.getPrecomputedDecision({
      aplicacionCodigo: bundle.codigo_unico,
      versionCatalogo: bundle.version_catalogo,
      emailPrincipal: emailNormalized,
    });

    if (cachedDecision) {
      return cachedDecision;
    }

    const identityContext =
      await this.identityRepo.findAuthorizationContextByEmail(
        emailNormalized,
        bundle.aplicacion_id,
      );

    if (!identityContext) {
      return null;
    }

    const computed = this.evaluator.precomputeSubjectAuthorization(
      identityContext,
      bundle,
      now,
      this.maxCacheTtlSeconds,
    );

    await this.l2Cache.setPrecomputedDecision(
      bundle.codigo_unico,
      bundle.version_catalogo,
      computed,
      computed.ttl_segundos,
    );

    return computed;
  }
}
