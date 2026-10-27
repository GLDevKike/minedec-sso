import pino, { Logger as PinoLogger } from 'pino';
import crypto from 'node:crypto';
import {
  AdminIncidentDiagnosticReport,
  buildNaturalLanguageIncidentDiagnostic,
} from './incident-diagnostics';
import { generateHexSpanId, normalizeToOtelTraceId } from './otel-tracing';

/**
 * Campos sensibles redactados automáticamente en todos los logs JSON (Constitución IX y XV).
 */
export const REDACTED_LOG_PATHS: ReadonlyArray<string> = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'authorization',
  'password',
  'secret',
  'clientSecret',
  'client_secret',
  'privateKey',
  'accessToken',
  'access_token',
  'assertion_jwt',
  'assertionJwt',
  'X-Minedec-Assertion',
  'x-minedec-assertion',
  'headers["X-Minedec-Assertion"]',
  'headers["x-minedec-assertion"]',
  'idToken',
  'id_token',
  'logoutToken',
  'logout_token',
  'refreshToken',
  'code',
  'code_verifier',
  'codeVerifier',
  '*.password',
  '*.secret',
  '*.clientSecret',
  '*.client_secret',
  '*.privateKey',
  '*.accessToken',
  '*.access_token',
  '*.assertion_jwt',
  '*.assertionJwt',
  '*.idToken',
  '*.id_token',
  '*.logoutToken',
  '*.logout_token',
  '*.code',
  '*.code_verifier',
  '*.codeVerifier',
];

export type CloudLoggingSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export type RuntimePlatform =
  | 'CLOUD_RUN_SERVICE'
  | 'CLOUD_RUN_JOB'
  | 'GKE_AUTOPILOT'
  | 'LOCAL_NODE';

export interface RuntimePlatformContext {
  runtimePlatform: RuntimePlatform;
  runtimeMetadata: Record<string, string>;
}

/**
 * Detecta automáticamente la plataforma de cómputo en tiempo de ejecución (Cloud Run Job,
 * Cloud Run Service, GKE Autopilot o nodo local) e inyecta los metadatos operativos (`T083`).
 */
export function detectRuntimePlatformMetadata(
  env: NodeJS.ProcessEnv = process.env,
): RuntimePlatformContext {
  if (env.CLOUD_RUN_JOB) {
    return {
      runtimePlatform: 'CLOUD_RUN_JOB',
      runtimeMetadata: {
        cloudRunJob: env.CLOUD_RUN_JOB,
        cloudRunExecution: env.CLOUD_RUN_EXECUTION ?? '',
        cloudRunTaskIndex: env.CLOUD_RUN_TASK_INDEX ?? '0',
        cloudRunTaskAttempt: env.CLOUD_RUN_TASK_ATTEMPT ?? '0',
      },
    };
  }

  if (env.K_SERVICE) {
    return {
      runtimePlatform: 'CLOUD_RUN_SERVICE',
      runtimeMetadata: {
        cloudRunService: env.K_SERVICE,
        cloudRunRevision: env.K_REVISION ?? '',
        cloudRunConfiguration: env.K_CONFIGURATION ?? '',
      },
    };
  }

  if (env.K8S_POD_NAME || env.KUBERNETES_SERVICE_HOST) {
    return {
      runtimePlatform: 'GKE_AUTOPILOT',
      runtimeMetadata: {
        k8sPodName: env.K8S_POD_NAME ?? env.HOSTNAME ?? '',
        k8sNamespace: env.K8S_NAMESPACE ?? 'conecta-minedec',
      },
    };
  }

  return {
    runtimePlatform: 'LOCAL_NODE',
    runtimeMetadata: {
      hostname: env.HOSTNAME ?? 'localhost',
    },
  };
}

export interface StructuredLogger {
  info(msgOrContext: string | Record<string, unknown>, contextOrMsg?: Record<string, unknown> | string): void;
  warn(msgOrContext: string | Record<string, unknown>, contextOrMsg?: Record<string, unknown> | string): void;
  error(msgOrContext: string | Record<string, unknown>, contextOrMsg?: Record<string, unknown> | string): void;
  debug(msgOrContext: string | Record<string, unknown>, contextOrMsg?: Record<string, unknown> | string): void;
  withTraceId(traceId: string, spanId?: string): StructuredLogger;
}

/**
 * Logger JSON estandarizado para Google Cloud Logging y OpenTelemetry.
 * Incluye correlación W3C (`logging.googleapis.com/trace`, `logging.googleapis.com/spanId`),
 * severidad mapeada, plataforma de ejecución (GKE Autopilot / Cloud Run Service / Cloud Run Job)
 * y diagnóstico automático en lenguaje natural para el Administrador ante errores (`T083`).
 */
export class PinoStructuredLogger implements StructuredLogger {
  private readonly logger: PinoLogger;
  private readonly componentName: string;
  private readonly defaultTraceId?: string;
  private readonly defaultSpanId?: string;
  private readonly gcpProjectId: string;
  private readonly runtimePlatform: RuntimePlatform;
  private readonly runtimeMetadata: Record<string, string>;
  private readonly env?: NodeJS.ProcessEnv;

  constructor(options?: {
    componentName?: string;
    level?: string;
    traceId?: string;
    spanId?: string;
    gcpProjectId?: string;
    pinoInstance?: PinoLogger;
    env?: NodeJS.ProcessEnv;
  }) {
    this.componentName = options?.componentName?.trim() || 'conecta-minedec-pip';
    this.defaultTraceId = options?.traceId;
    this.defaultSpanId = options?.spanId;
    this.env = options?.env;
    this.gcpProjectId =
      options?.gcpProjectId ?? process.env.GCP_PROJECT_ID ?? 'minedec-sso-c22';

    const platformInfo = detectRuntimePlatformMetadata(options?.env ?? process.env);
    this.runtimePlatform = platformInfo.runtimePlatform;
    this.runtimeMetadata = platformInfo.runtimeMetadata;

    this.logger =
      options?.pinoInstance ??
      pino({
        level:
          options?.level ??
          (process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info')),
        redact: {
          paths: [...REDACTED_LOG_PATHS],
          censor: '[REDACTED_MINEDEC_SECRET]',
        },
        base: {
          service: this.componentName,
          component: 'C2.2',
          runtimePlatform: this.runtimePlatform,
          runtimeMetadata: this.runtimeMetadata,
          serviceContext: {
            service: this.componentName,
            version: process.env.SERVICE_VERSION ?? '1.0.0',
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      });
  }

  private enrichContext(
    severity: CloudLoggingSeverity,
    context?: Record<string, unknown>,
  ): Record<string, unknown> {
    const rawTraceId =
      (typeof context?.traceId === 'string' && context.traceId) ||
      this.defaultTraceId ||
      crypto.randomUUID();
    const otelTraceId = normalizeToOtelTraceId(rawTraceId);
    const spanId =
      (typeof context?.spanId === 'string' && context.spanId) ||
      this.defaultSpanId ||
      generateHexSpanId();

    const enriched: Record<string, unknown> = {
      ...context,
      severity,
      service: this.componentName,
      component: 'C2.2',
      runtimePlatform: this.runtimePlatform,
      runtimeMetadata: this.runtimeMetadata,
      serviceContext: {
        service: this.componentName,
        version: process.env.SERVICE_VERSION ?? '1.0.0',
      },
      traceId: rawTraceId,
      spanId,
      'otel.trace_id': otelTraceId,
      'otel.span_id': spanId,
      'logging.googleapis.com/trace': `projects/${this.gcpProjectId}/traces/${otelTraceId}`,
      'logging.googleapis.com/spanId': spanId,
      'logging.googleapis.com/trace_sampled': true,
    };

    if (
      (severity === 'ERROR' || severity === 'CRITICAL') &&
      !enriched.diagnosticoAdministrador
    ) {
      const errorSource = context?.error ?? context?.err;
      if (errorSource) {
        const diagnostic: AdminIncidentDiagnosticReport =
          buildNaturalLanguageIncidentDiagnostic(errorSource, { traceId: rawTraceId });
        enriched.diagnosticoAdministrador = diagnostic;
      }
    }

    return enriched;
  }

  private normalizeArgs(
    msgOrContext: string | Record<string, unknown>,
    contextOrMsg?: Record<string, unknown> | string,
  ): { msg: string; context?: Record<string, unknown> } {
    if (typeof msgOrContext === 'string') {
      return {
        msg: msgOrContext,
        context: typeof contextOrMsg === 'object' ? contextOrMsg : undefined,
      };
    }
    return {
      msg: typeof contextOrMsg === 'string' ? contextOrMsg : 'Structured log event',
      context: msgOrContext,
    };
  }

  public info(
    msgOrContext: string | Record<string, unknown>,
    contextOrMsg?: Record<string, unknown> | string,
  ): void {
    const { msg, context } = this.normalizeArgs(msgOrContext, contextOrMsg);
    this.logger.info(this.enrichContext('INFO', context), msg);
  }

  public warn(
    msgOrContext: string | Record<string, unknown>,
    contextOrMsg?: Record<string, unknown> | string,
  ): void {
    const { msg, context } = this.normalizeArgs(msgOrContext, contextOrMsg);
    this.logger.warn(this.enrichContext('WARNING', context), msg);
  }

  public error(
    msgOrContext: string | Record<string, unknown>,
    contextOrMsg?: Record<string, unknown> | string,
  ): void {
    const { msg, context } = this.normalizeArgs(msgOrContext, contextOrMsg);
    this.logger.error(this.enrichContext('ERROR', context), msg);
  }

  public debug(
    msgOrContext: string | Record<string, unknown>,
    contextOrMsg?: Record<string, unknown> | string,
  ): void {
    const { msg, context } = this.normalizeArgs(msgOrContext, contextOrMsg);
    this.logger.debug(this.enrichContext('DEBUG', context), msg);
  }

  public withTraceId(traceId: string, spanId?: string): StructuredLogger {
    return new PinoStructuredLogger({
      componentName: this.componentName,
      traceId,
      spanId,
      gcpProjectId: this.gcpProjectId,
      pinoInstance: this.logger,
      env: this.env,
    });
  }
}

export function createStructuredLogger(
  componentName = 'conecta-minedec-pip',
  options?: {
    level?: string;
    traceId?: string;
    spanId?: string;
    gcpProjectId?: string;
    pinoInstance?: PinoLogger;
    env?: NodeJS.ProcessEnv;
  },
): StructuredLogger {
  return new PinoStructuredLogger({
    ...options,
    componentName,
  });
}

export function getLogger(
  componentName = 'conecta-minedec-pip',
  options?: {
    level?: string;
    traceId?: string;
    spanId?: string;
    gcpProjectId?: string;
    pinoInstance?: PinoLogger;
    env?: NodeJS.ProcessEnv;
  },
): StructuredLogger {
  return createStructuredLogger(componentName, options);
}
