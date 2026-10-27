import crypto from 'node:crypto';
import { StructuredLogger } from './logger';

/**
 * Contexto de traza distribuida compatible con el estándar W3C Trace Context (`traceparent`)
 * y con Google Cloud Trace (`X-Cloud-Trace-Context`).
 */
export interface OtelSpanContext {
  /** Identificador de traza de 32 caracteres hexadecimales (128 bits) */
  traceId: string;
  /** Identificador de span actual de 16 caracteres hexadecimales (64 bits) */
  spanId: string;
  /** Identificador de span padre (si provino de una cabecera entrante) */
  parentSpanId?: string;
  /** Flags de muestreo W3C ('01' = sampled, '00' = not sampled) */
  traceFlags: '01' | '00';
  /** Indica si la traza está marcada para muestreo en Cloud Trace */
  sampled: boolean;
  /** Cabecera estándar W3C: `00-<traceId>-<spanId>-<traceFlags>` */
  traceparent: string;
  /** Cabecera estándar GCP: `<traceId>/<spanIdDecimal>;o=<1|0>` */
  cloudTraceContext: string;
}

export interface OtelSpanTelemetry {
  name: string;
  kind: 'SERVER' | 'CLIENT' | 'INTERNAL' | 'PRODUCER' | 'CONSUMER';
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeIso: string;
  endTimeIso: string;
  durationMs: number;
  status: 'OK' | 'ERROR';
  attributes: Record<string, string | number | boolean>;
  errorMessage?: string;
}

const W3C_TRACEPARENT_REGEX =
  /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

const CLOUD_TRACE_CONTEXT_REGEX =
  /^([0-9a-f]{32})(?:\/([0-9]+))?(?:;o=([01]))?$/i;

export function generateHexTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateHexSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Normaliza cualquier identificador de traza (UUID v4 o hex) a 32 caracteres hexadecimales en minúsculas
 * para compatibilidad con OpenTelemetry y Google Cloud Trace.
 */
export function normalizeToOtelTraceId(rawTraceId?: string): string {
  if (!rawTraceId || rawTraceId.trim().length === 0) {
    return generateHexTraceId();
  }
  const compact = rawTraceId.trim().replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{32}$/.test(compact) && compact !== '00000000000000000000000000000000') {
    return compact;
  }
  return crypto.createHash('sha256').update(rawTraceId.trim()).digest('hex').slice(0, 32);
}

/**
 * Convierte un spanId de 16 caracteres hexadecimales a representación decimal uint64 para `X-Cloud-Trace-Context`.
 */
export function hexSpanIdToDecimal(spanIdHex: string): string {
  try {
    return BigInt(`0x${spanIdHex}`).toString(10);
  } catch {
    return '1';
  }
}

/**
 * Extrae el contexto OpenTelemetry desde las cabeceras HTTP entrantes (`traceparent`,
 * `x-cloud-trace-context` o `x-trace-id`) o genera un nuevo span raíz si no existe.
 */
export function extractOrCreateOtelSpanContext(
  headers: Record<string, string | string[] | undefined>,
): OtelSpanContext {
  const getHeader = (name: string): string | undefined => {
    const val = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(val)) {
      return val[0];
    }
    return val;
  };

  const rawTraceparent = getHeader('traceparent')?.trim();
  if (rawTraceparent) {
    const match = W3C_TRACEPARENT_REGEX.exec(rawTraceparent);
    if (match) {
      const traceId = match[1].toLowerCase();
      const parentSpanId = match[2].toLowerCase();
      const sampled = (parseInt(match[3], 16) & 1) === 1;
      const traceFlags: '01' | '00' = sampled ? '01' : '00';
      const spanId = generateHexSpanId();
      return {
        traceId,
        spanId,
        parentSpanId,
        traceFlags,
        sampled,
        traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
        cloudTraceContext: `${traceId}/${hexSpanIdToDecimal(spanId)};o=${sampled ? '1' : '0'}`,
      };
    }
  }

  const rawCloudTrace = getHeader('x-cloud-trace-context')?.trim();
  if (rawCloudTrace) {
    const match = CLOUD_TRACE_CONTEXT_REGEX.exec(rawCloudTrace);
    if (match) {
      const traceId = match[1].toLowerCase();
      let parentSpanId: string | undefined;
      if (match[2]) {
        try {
          parentSpanId = BigInt(match[2]).toString(16).padStart(16, '0').slice(0, 16);
        } catch {
          parentSpanId = undefined;
        }
      }
      const sampled = match[3] !== '0';
      const traceFlags: '01' | '00' = sampled ? '01' : '00';
      const spanId = generateHexSpanId();
      return {
        traceId,
        spanId,
        parentSpanId,
        traceFlags,
        sampled,
        traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
        cloudTraceContext: `${traceId}/${hexSpanIdToDecimal(spanId)};o=${sampled ? '1' : '0'}`,
      };
    }
  }

  const rawTraceId = getHeader('x-trace-id')?.trim();
  const traceId = rawTraceId ? normalizeToOtelTraceId(rawTraceId) : generateHexTraceId();
  const spanId = generateHexSpanId();
  return {
    traceId,
    spanId,
    traceFlags: '01',
    sampled: true,
    traceparent: `00-${traceId}-${spanId}-01`,
    cloudTraceContext: `${traceId}/${hexSpanIdToDecimal(spanId)};o=1`,
  };
}

/**
 * Ejecuta una operación instrumentada con un Span OpenTelemetry, midiendo su duración
 * y registrando telemetría estructurada en caso de éxito o fallo.
 */
export async function withOtelSpan<T>(
  name: string,
  options: {
    kind?: OtelSpanTelemetry['kind'];
    parentContext?: Partial<OtelSpanContext>;
    attributes?: Record<string, string | number | boolean>;
    logger?: StructuredLogger;
    onSpanEnd?: (span: OtelSpanTelemetry) => void;
  },
  fn: (spanContext: OtelSpanContext) => Promise<T>,
): Promise<T> {
  const traceId = normalizeToOtelTraceId(options.parentContext?.traceId);
  const parentSpanId = options.parentContext?.spanId;
  const sampled = options.parentContext?.sampled ?? true;
  const traceFlags: '01' | '00' = sampled ? '01' : '00';
  const spanId = generateHexSpanId();

  const spanContext: OtelSpanContext = {
    traceId,
    spanId,
    parentSpanId,
    traceFlags,
    sampled,
    traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
    cloudTraceContext: `${traceId}/${hexSpanIdToDecimal(spanId)};o=${sampled ? '1' : '0'}`,
  };

  const startPerf = performance.now();
  const startTimeIso = new Date().toISOString();

  try {
    const result = await fn(spanContext);
    const durationMs = Number((performance.now() - startPerf).toFixed(3));
    const telemetry: OtelSpanTelemetry = {
      name,
      kind: options.kind ?? 'INTERNAL',
      traceId,
      spanId,
      parentSpanId,
      startTimeIso,
      endTimeIso: new Date().toISOString(),
      durationMs,
      status: 'OK',
      attributes: { ...(options.attributes ?? {}) },
    };
    options.onSpanEnd?.(telemetry);
    options.logger?.debug(`Span OpenTelemetry completado: ${name}`, {
      traceId,
      spanId,
      parentSpanId,
      otelSpan: telemetry,
    });
    return result;
  } catch (error) {
    const durationMs = Number((performance.now() - startPerf).toFixed(3));
    const errorMessage = error instanceof Error ? error.message : String(error);
    const telemetry: OtelSpanTelemetry = {
      name,
      kind: options.kind ?? 'INTERNAL',
      traceId,
      spanId,
      parentSpanId,
      startTimeIso,
      endTimeIso: new Date().toISOString(),
      durationMs,
      status: 'ERROR',
      attributes: { ...(options.attributes ?? {}) },
      errorMessage,
    };
    options.onSpanEnd?.(telemetry);
    options.logger?.error(`Span OpenTelemetry falló en operación: ${name}`, {
      traceId,
      spanId,
      parentSpanId,
      otelSpan: telemetry,
      error,
    });
    throw error;
  }
}
