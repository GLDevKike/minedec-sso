/**
 * Política de retroceso exponencial con variación aleatoria `(2^n) segundos + jitter (0..1000 ms)`
 * (`n = 0..4`, máximo 5 intentos) con lectura prioritaria de la cabecera HTTP `Retry-After`
 * ante respuestas `429 Too Many Requests` o `503 Service Unavailable` de Google Workspace (Spec 002 - T057 / US5).
 */
export interface BackoffComputationInput {
  /** Índice del intento fallido (`0..4` o `1..5`). */
  attemptIndex: number;
  /** Valor opcional de cabecera `Retry-After` (segundos enteros o fecha HTTP). */
  retryAfterHeader?: string | number | null;
  /** Generador opcional de jitter `0..1000 ms` (por defecto `Math.random() * 1000`). */
  jitterMsGenerator?: () => number;
}

export interface BackoffDecision {
  shouldRetry: boolean;
  attemptNumber: number;
  maxAttempts: number;
  backoffMs: number;
  baseExponentialMs: number;
  jitterMs: number;
  honoredRetryAfter: boolean;
}

export class ExponentialBackoffPolicy {
  public static readonly MAX_ATTEMPTS = 5;

  /**
   * Calcula el tiempo de espera en milisegundos conforme a la fórmula canónica:
   * `wait_ms = max(Retry-After_ms, (2^n * 1000) + jitter(0..1000))` para `n = 0..4`.
   *
   * @param attemptZeroBased Índice base 0 (`0` para el primer reintento -> `2^0 = 1s`, `4` para el quinto -> `2^4 = 16s`).
   */
  public static computeDelayMs(
    attemptZeroBased: number,
    retryAfterHeader?: string | number | null,
    jitterMsGenerator: () => number = () => Math.floor(Math.random() * 1001),
  ): BackoffDecision {
    const normalizedN = Math.max(0, Math.min(4, Math.floor(attemptZeroBased)));
    const attemptNumber = normalizedN + 1;
    const rawJitter = jitterMsGenerator();
    const jitterMs = Math.max(0, Math.min(1000, Math.floor(rawJitter)));
    const baseExponentialMs = Math.pow(2, normalizedN) * 1000;
    const computedFormulaMs = baseExponentialMs + jitterMs;

    const retryAfterMs = ExponentialBackoffPolicy.parseRetryAfterMs(retryAfterHeader);
    const honoredRetryAfter = retryAfterMs !== null && retryAfterMs > computedFormulaMs;
    const backoffMs = honoredRetryAfter ? retryAfterMs! : computedFormulaMs;

    return {
      shouldRetry: attemptZeroBased < ExponentialBackoffPolicy.MAX_ATTEMPTS,
      attemptNumber,
      maxAttempts: ExponentialBackoffPolicy.MAX_ATTEMPTS,
      backoffMs,
      baseExponentialMs,
      jitterMs,
      honoredRetryAfter,
    };
  }

  /**
   * Parsea la cabecera HTTP `Retry-After` en milisegundos (soporta segundos enteros o fecha HTTP).
   */
  public static parseRetryAfterMs(retryAfterHeader?: string | number | null): number | null {
    if (retryAfterHeader === undefined || retryAfterHeader === null || retryAfterHeader === '') {
      return null;
    }
    if (typeof retryAfterHeader === 'number' && Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
      return Math.ceil(retryAfterHeader * 1000);
    }
    const raw = String(retryAfterHeader).trim();
    const numericSeconds = Number(raw);
    if (Number.isFinite(numericSeconds) && numericSeconds > 0) {
      return Math.ceil(numericSeconds * 1000);
    }
    const parsedDateMs = Date.parse(raw);
    if (!Number.isNaN(parsedDateMs)) {
      const deltaMs = parsedDateMs - Date.now();
      return deltaMs > 0 ? deltaMs : 0;
    }
    return null;
  }

  /**
   * Ejecuta una operación asíncrona aplicando hasta 5 intentos con retroceso exponencial.
   * Si agota los 5 intentos o el error es no recuperable (`isRetryable = false`), lanza un error enriquecido
   * con el número de intentos realizados y el último `backoffMs`.
   */
  public static async executeWithRetry<T>(
    operation: (attemptNumber: number) => Promise<T>,
    options: {
      isRetryable?: (error: unknown) => boolean;
      extractRetryAfter?: (error: unknown) => string | number | null | undefined;
      sleepFn?: (ms: number) => Promise<void>;
      jitterMsGenerator?: () => number;
      maxAttempts?: number;
    } = {},
  ): Promise<{ result: T; attemptsMade: number; lastBackoffMs: number }> {
    const maxAttempts = options.maxAttempts ?? ExponentialBackoffPolicy.MAX_ATTEMPTS;
    const sleepFn = options.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const isRetryable =
      options.isRetryable ??
      ((err: unknown) => {
        if (err && typeof err === 'object') {
          const status = (err as Record<string, unknown>).httpStatus ?? (err as Record<string, unknown>).status;
          if (status === 429 || status === 503 || status === 502 || status === 504) {
            return true;
          }
          if ((err as Record<string, unknown>).retryable === false) {
            return false;
          }
        }
        return true;
      });

    let lastBackoffMs = 0;
    let lastError: unknown;

    for (let n = 0; n < maxAttempts; n++) {
      const attemptNumber = n + 1;
      try {
        const result = await operation(attemptNumber);
        return { result, attemptsMade: attemptNumber, lastBackoffMs };
      } catch (error) {
        lastError = error;
        const canRetry = isRetryable(error);
        const retryAfter = options.extractRetryAfter ? options.extractRetryAfter(error) : undefined;
        const decision = ExponentialBackoffPolicy.computeDelayMs(
          n,
          retryAfter,
          options.jitterMsGenerator,
        );
        lastBackoffMs = decision.backoffMs;

        if (!canRetry || attemptNumber >= maxAttempts) {
          if (error && typeof error === 'object') {
            (error as Record<string, unknown>).attemptsMade = attemptNumber;
            (error as Record<string, unknown>).lastBackoffMs = lastBackoffMs;
          }
          throw error;
        }

        await sleepFn(decision.backoffMs);
      }
    }

    throw lastError;
  }
}


export function computeExponentialBackoffWithJitter(
  attemptOneBased: number,
  jitterGenerator: () => number = () => Math.random(),
): {
  baseDelayMs: number;
  jitterMs: number;
  totalDelayMs: number;
} {
  const n = Math.max(0, Math.min(4, Math.floor(attemptOneBased - 1)));
  const baseDelayMs = Math.pow(2, n) * 1000;
  const rawRandom = jitterGenerator();
  const jitterMs =
    rawRandom > 1
      ? Math.min(1000, Math.floor(rawRandom))
      : Math.round(Math.max(0, Math.min(1, rawRandom)) * 1000);
  return {
    baseDelayMs,
    jitterMs,
    totalDelayMs: baseDelayMs + jitterMs,
  };
}
