import crypto from 'node:crypto';

export type IncidentCode =
  | 'ALLOYDB_UNAVAILABLE_OR_FAILOVER'
  | 'ALLOYDB_CONNECTION_SATURATED'
  | 'ALLOYDB_QUERY_TIMEOUT'
  | 'REDIS_CACHE_UNAVAILABLE'
  | 'PUBSUB_BUS_DEGRADED'
  | 'CLOUD_TASKS_QUEUE_DEGRADED'
  | 'GWS_DIRECTORY_API_QUOTA_THROTTLED'
  | 'SYNC_DLQ_PENDING_ACCUMULATION'
  | 'RECONCILIATION_PARTITION_HEARTBEAT_EXPIRED'
  | 'PIP_INTERNAL_UNEXPECTED_FAILURE';

export type IncidentSeverity = 'CRITICA' | 'ALTA' | 'MEDIA';

export type AffectedInfrastructureComponent =
  | 'ALLOYDB_POSTGRESQL_16'
  | 'MEMORYSTORE_REDIS_L2'
  | 'CLOUD_PUBSUB_INVALIDATION'
  | 'CLOUD_TASKS_SYNC'
  | 'GOOGLE_WORKSPACE_ADMIN_SDK'
  | 'SINCRONIZADOR_GWS_DLQ'
  | 'CONCILIACION_JOB_BATCH'
  | 'PIP_IDENTITY_SERVICE';

/**
 * Reporte de diagnóstico de incidentes en lenguaje natural orientado al Administrador de Seguridad
 * e Infraestructura de Conecta MINEDEC (Subcomponente C2.2).
 *
 * Explica de forma clara y en español qué está ocurriendo, cómo afecta al servicio y a la postura
 * de seguridad (`fail-close`), cómo se levanta automáticamente la infraestructura y qué pasos
 * concretos puede ejecutar el administrador.
 */
export interface AdminIncidentDiagnosticReport {
  codigoIncidente: IncidentCode;
  severidad: IncidentSeverity;
  componenteAfectado: AffectedInfrastructureComponent;
  posturaSeguridad: 'FAIL_CLOSE_ACTIVO' | 'DEGRADACION_CONTROLADA';
  tituloLenguajeNatural: string;
  explicacionLenguajeNatural: string;
  impactoOperativoYSeguridad: string;
  comoSeLevantaYRecupera: string;
  accionesRecomendadasAdministrador: ReadonlyArray<string>;
  detallesTecnicosSanitizados: {
    sqlState?: string;
    errorCode?: string;
    mensajeOriginalSanitizado: string;
    timestampIso: string;
    traceId: string;
  };
}

/**
 * Sanitiza cualquier mensaje de error técnico para garantizar que nunca se filtren
 * cadenas de conexión, contraseñas, tokens Bearer ni llaves privadas (Constitución IX y XV).
 */
export function sanitizeTechnicalErrorMessage(rawMessage: string): string {
  return rawMessage
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://[REDACTED_DB_URI]')
    .replace(/redis(?:s)?:\/\/[^\s"']+/gi, 'redis://[REDACTED_REDIS_URI]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(password|secret|token|apikey|private_key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

interface ErrorInspection {
  message: string;
  sqlState?: string;
  errorCode?: string;
}

function inspectErrorObject(error: unknown): ErrorInspection {
  if (!error) {
    return { message: 'Error desconocido sin detalle adicional.' };
  }
  if (typeof error === 'string') {
    return { message: sanitizeTechnicalErrorMessage(error) };
  }
  if (typeof error === 'object') {
    const errRecord = error as Record<string, unknown>;
    const rawMsg =
      typeof errRecord.message === 'string'
        ? errRecord.message
        : 'Error de infraestructura detectado.';
    const code = typeof errRecord.code === 'string' ? errRecord.code : undefined;
    const sqlState =
      typeof errRecord.sqlState === 'string'
        ? errRecord.sqlState
        : code && /^[0-9A-Z]{5}$/.test(code)
          ? code
          : undefined;
    return {
      message: sanitizeTechnicalErrorMessage(rawMsg),
      sqlState,
      errorCode: code,
    };
  }
  return { message: sanitizeTechnicalErrorMessage(String(error)) };
}

/**
 * Determina si un error técnico corresponde a una caída, conmutación HA o indisponibilidad
 * de infraestructura (AlloyDB, Redis, red VPC) que requiere respuesta HTTP 503 (`fail-close`).
 */
export function isInfrastructureOutageError(error: unknown): boolean {
  const { message, sqlState, errorCode } = inspectErrorObject(error);
  const transientSqlStates = new Set([
    '57P01', // admin_shutdown (mantenimiento o inicio de failover AlloyDB)
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now (instancia AlloyDB en promoción/recovery)
    '53300', // too_many_connections
    '57014', // query_canceled / statement_timeout
    '08000', // connection_exception
    '08001', // sqlclient_unable_to_establish_sqlconnection
    '08003', // connection_does_not_exist
    '08006', // connection_failure
  ]);
  const networkCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
  ]);

  if (sqlState && transientSqlStates.has(sqlState)) {
    return true;
  }
  if (errorCode && (networkCodes.has(errorCode) || transientSqlStates.has(errorCode))) {
    return true;
  }
  return /(alloydb|postgres|database|connection terminated|connect ECONNREFUSED|timeout expired|cannot connect now|terminating connection|read-only transaction|failover)/i.test(
    message,
  );
}

/**
 * Construye un diagnóstico completo y detallado en lenguaje natural (español) para que el
 * Administrador comprenda exactamente qué ocurrió en la infraestructura, cómo se levanta
 * automáticamente el servicio y qué acciones de verificación o recuperación ejecutar.
 */
export function buildNaturalLanguageIncidentDiagnostic(
  error: unknown,
  options?: {
    traceId?: string;
    componentHint?: AffectedInfrastructureComponent;
  },
): AdminIncidentDiagnosticReport {
  const traceId = options?.traceId || crypto.randomUUID();
  const timestampIso = new Date().toISOString();
  const { message, sqlState, errorCode } = inspectErrorObject(error);

  // 1. Saturación del pool de conexiones en AlloyDB (SQLSTATE 53300)
  if (sqlState === '53300' || /too many connections|remaining connection slots/i.test(message)) {
    return {
      codigoIncidente: 'ALLOYDB_CONNECTION_SATURATED',
      severidad: 'ALTA',
      componenteAfectado: 'ALLOYDB_POSTGRESQL_16',
      posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
      tituloLenguajeNatural:
        'Saturación de conexiones simultáneas en el clúster AlloyDB for PostgreSQL 16',
      explicacionLenguajeNatural:
        'El motor de base de datos AlloyDB ha alcanzado el límite máximo de conexiones activas permitidas y rechazó abrir una nueva sesión desde el microservicio PIP. Esto suele ocurrir ante un pico extraordinario de autenticaciones no cacheadas o por transacciones retenidas.',
      impactoOperativoYSeguridad:
        'Las identidades ya almacenadas en la caché L2 (Memorystore for Redis, vigencia <= 300 s) continúan resolviéndose con normalidad. Para las consultas que requieren ir a base de datos, Conecta MINEDEC aplica su postura de seguridad Fail-Close (denegación preventiva segura HTTP 503) evitando otorgar accesos sin verificar el perfil.',
      comoSeLevantaYRecupera:
        'El pool de conexiones del servicio PIP libera automáticamente las sesiones inactivas cada 30 segundos (DB_IDLE_TIMEOUT_MS) y reintenta la conexión con retroceso exponencial. Además, GKE Autopilot y el Read Pool multi-zona de AlloyDB absorben la carga de lectura.',
      accionesRecomendadasAdministrador: [
        '1. Verifique en Cloud Monitoring la métrica `alloydb.googleapis.com/database/postgresql/backends` para identificar qué servicio consume las conexiones.',
        '2. Revise si existen consultas bloqueadas ejecutando una inspección de `pg_stat_activity` en la instancia primaria de AlloyDB.',
        '3. Si el tráfico legítimo creció de forma sostenida, incremente `alloydb_primary_cpu_count` o `alloydb_read_pool_node_count` en el repositorio `minedec-sso-terraform` vía Cloud Infrastructure Manager.',
      ],
      detallesTecnicosSanitizados: {
        sqlState: sqlState ?? '53300',
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 2. Timeout de consulta SQL en AlloyDB (SQLSTATE 57014)
  if (sqlState === '57014' || /statement timeout|query_canceled|canceling statement/i.test(message)) {
    return {
      codigoIncidente: 'ALLOYDB_QUERY_TIMEOUT',
      severidad: 'ALTA',
      componenteAfectado: 'ALLOYDB_POSTGRESQL_16',
      posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
      tituloLenguajeNatural:
        'Tiempo de espera agotado en consulta a AlloyDB for PostgreSQL 16',
      explicacionLenguajeNatural:
        'Una operación sobre la base de datos AlloyDB tardó más del umbral máximo permitido y fue cancelada preventivamente para proteger la estabilidad del clúster. Puede deberse a un bloqueo de fila (lock contention) o alta carga de CPU/IO en la instancia.',
      impactoOperativoYSeguridad:
        'La transacción afectada hizo ROLLBACK automático garantizando cero corrupción de datos (ACID) y preservando intacta la cadena SHA-256 de `auditoria_evento`. La petición actual se rechaza de forma segura (Fail-Close).',
      comoSeLevantaYRecupera:
        'La sesión SQL se limpia de inmediato y el pool de conexiones permanece operativo para las siguientes peticiones sin requerir reinicio del contenedor.',
      accionesRecomendadasAdministrador: [
        '1. Consulte en Cloud Logging el `traceId` indicado en este reporte para identificar el caso de uso exacto que superó el tiempo límite.',
        '2. Revise el panel de Query Insights de AlloyDB en Google Cloud Console para detectar bloqueos o lecturas secuenciales pesadas.',
      ],
      detallesTecnicosSanitizados: {
        sqlState: sqlState ?? '57014',
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 3. Caída, Conmutación por Error (HA Failover) o Inaccesibilidad de AlloyDB
  if (
    options?.componentHint === 'ALLOYDB_POSTGRESQL_16' ||
    isInfrastructureOutageError(error)
  ) {
    return {
      codigoIncidente: 'ALLOYDB_UNAVAILABLE_OR_FAILOVER',
      severidad: 'CRITICA',
      componenteAfectado: 'ALLOYDB_POSTGRESQL_16',
      posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
      tituloLenguajeNatural:
        'Interrupción o Conmutación de Alta Disponibilidad (Failover) en AlloyDB for PostgreSQL 16',
      explicacionLenguajeNatural:
        'El microservicio PIP perdió comunicación con la instancia primaria de AlloyDB for PostgreSQL 16 o la base de datos se encuentra ejecutando una conmutación automática de Alta Disponibilidad (Regional HA Failover). Esto ocurre cuando Google Cloud detecta un fallo físico en la zona actual, durante una ventana de mantenimiento o por una interrupción en el enlace Private Service Access de la red VPC.',
      impactoOperativoYSeguridad:
        'SEGURIDAD GARANTIZADA (FAIL-CLOSE): Conecta MINEDEC jamás otorga permisos a ciegas; cualquier evaluación que requiera base de datos y no pueda completarse es denegada de forma segura (HTTP 503) hasta confirmar la identidad. Los perfiles ya activos en la caché L2 de Memorystore for Redis siguen respondiendo durante su ventana de vida estricta (<= 300 segundos). Ningún dato ni evento de auditoría se pierde (RPO = 0).',
      comoSeLevantaYRecupera:
        '1) RECUPERACIÓN AUTOMÁTICA SIN INTERVENCIÓN (< 60 s): La instancia primaria de AlloyDB está configurada en modo `REGIONAL` (Alta Disponibilidad multi-zona). Ante la caída del nodo activo, AlloyDB promueve automáticamente el nodo standby en otra zona de la región `us-central1` en menos de 60 segundos sin pérdida de transacciones (`RPO = 0`). ' +
        '2) RECONEXIÓN AUTOMÁTICA DEL BACKEND: El cliente `PostgresDatabaseClient` del PIP descarta las conexiones rotas y reintenta conectarse automáticamente con retroceso exponencial a la dirección IP interna del clúster en cuanto termina la promoción. ' +
        '3) RESPALDOS CONTINUOS (PITR 14 DÍAS) Y DIARIOS: Si el incidente fuese un desastre mayor, AlloyDB cuenta con Continuous Backup activo (recuperación a cualquier segundo de los últimos 14 días) y respaldos diarios automatizados encriptados con `deletion_protection = true`.',
      accionesRecomendadasAdministrador: [
        '1. VERIFICAR ESTADO DEL CLÚSTER: Ejecute `gcloud alloydb clusters describe conecta-minedec-pip-<env> --region=us-central1` y `gcloud alloydb instances list --cluster=conecta-minedec-pip-<env> --region=us-central1` para confirmar si la instancia primaria está en estado `READY` o `PROMOTING`.',
        '2. COMPROBAR RECUPERACIÓN EN VIVO: Consulte el endpoint `GET /internal/v1/pip/health/detailed` del servicio PIP; en cuanto AlloyDB complete el failover (< 60 s), el estado volverá automáticamente a `OPERATIVO` sin reiniciar pods en GKE.',
        '3. CONMUTACIÓN MANUAL (SI LA ZONA PRESENTA DEGRADACIÓN PARCIAL): Puede forzar el failover hacia la zona secundaria con `gcloud alloydb clusters failover conecta-minedec-pip-<env> --region=us-central1`.',
        '4. RESTAURACIÓN POINT-IN-TIME (SOLO EN CASO DE DESASTRE MAYOR): Para levantar un clúster restaurado a un segundo exacto previo al incidente, ejecute `gcloud alloydb clusters restore conecta-minedec-pip-restored --region=us-central1 --continuous-backup-source-cluster=conecta-minedec-pip-<env> --continuous-backup-point-in-time=<TIMESTAMP_ISO8601>`.',
      ],
      detallesTecnicosSanitizados: {
        sqlState,
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 4. Degradación o caída de Memorystore for Redis (Caché L2)
  if (
    options?.componentHint === 'MEMORYSTORE_REDIS_L2' ||
    /redis|ioredis|cache/i.test(message)
  ) {
    return {
      codigoIncidente: 'REDIS_CACHE_UNAVAILABLE',
      severidad: 'ALTA',
      componenteAfectado: 'MEMORYSTORE_REDIS_L2',
      posturaSeguridad: 'DEGRADACION_CONTROLADA',
      tituloLenguajeNatural:
        'Indisponibilidad temporal de la caché L2 en Memorystore for Redis',
      explicacionLenguajeNatural:
        'El servicio PIP no pudo leer o escribir en la instancia Memorystore for Redis que actúa como caché de segundo nivel (L2, TTL <= 300 s). Esto puede deberse a una conmutación de réplica HA en Redis (`STANDARD_HA`) o rotación del secreto AUTH.',
      impactoOperativoYSeguridad:
        'El servicio continúa operando consultando directamente el clúster AlloyDB for PostgreSQL 16 (y su Read Pool). El SLA de revocación `<= 300 s` nunca se vulnera porque toda entrada previa en Redis expira de forma dura por TTL.',
      comoSeLevantaYRecupera:
        'Memorystore for Redis en nivel `STANDARD_HA` ejecuta failover automático hacia su réplica en otra zona y el adaptador `RedisCacheClient` reconecta automáticamente la sesión autenticada.',
      accionesRecomendadasAdministrador: [
        '1. Verifique el estado de la instancia con `gcloud redis instances describe conecta-minedec-pip-l2-<env> --region=us-central1`.',
        '2. Confirme que el secreto `conecta-minedec-redis-auth-<env>` en Secret Manager coincida con el `authString` vigente de la instancia.',
      ],
      detallesTecnicosSanitizados: {
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 5. Degradación en Cloud Pub/Sub (Invalidación reactiva)
  if (
    options?.componentHint === 'CLOUD_PUBSUB_INVALIDATION' ||
    /pubsub|topic|subscription/i.test(message)
  ) {
    return {
      codigoIncidente: 'PUBSUB_BUS_DEGRADED',
      severidad: 'ALTA',
      componenteAfectado: 'CLOUD_PUBSUB_INVALIDATION',
      posturaSeguridad: 'DEGRADACION_CONTROLADA',
      tituloLenguajeNatural:
        'Fallo al publicar evento de invalidación reactiva en Cloud Pub/Sub',
      explicacionLenguajeNatural:
        'Ocurrió un error al emitir el mensaje de purga reactiva de caché hacia el tópico Cloud Pub/Sub tras un cambio de identidad, contexto o anomalía.',
      impactoOperativoYSeguridad:
        'El servicio ejecuta purga directa en Redis y, en el peor escenario de partición del bus, el TTL duro de `<= 300 segundos` en Memorystore for Redis garantiza que ningún permiso revocado sobreviva más de 5 minutos.',
      comoSeLevantaYRecupera:
        'Cloud Pub/Sub reintenta automáticamente la entrega con backoff exponencial (1s a 60s) y redirige mensajes fallidos luego de 5 intentos a la cola Dead-Letter (`*-dlq`) para inspección.',
      accionesRecomendadasAdministrador: [
        '1. Revise si existen mensajes acumulados en la suscripción Dead-Letter `minedec-pip-cache-invalidation-sub-<env>-dlq-sub`.',
        '2. Verifique los permisos IAM (`roles/pubsub.publisher`) de la cuenta de servicio `sa-conecta`.',
      ],
      detallesTecnicosSanitizados: {
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 6. Degradación en Cloud Tasks (Reconciliación prioritaria de Registro Caliente)
  if (
    options?.componentHint === 'CLOUD_TASKS_SYNC' ||
    /cloud\s*tasks|queue/i.test(message)
  ) {
    return {
      codigoIncidente: 'CLOUD_TASKS_QUEUE_DEGRADED',
      severidad: 'MEDIA',
      componenteAfectado: 'CLOUD_TASKS_SYNC',
      posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
      tituloLenguajeNatural:
        'Retraso en el encolamiento de reconciliación prioritaria en Cloud Tasks',
      explicacionLenguajeNatural:
        'No fue posible encolar de forma inmediata la tarea de reconciliación prioritaria en Cloud Tasks para una cuenta recién registrada en caliente (`REGISTRO_CALIENTE`).',
      impactoOperativoYSeguridad:
        'La identidad quedó persistida de forma segura en AlloyDB con acceso limitado a su estado inicial y el Job programado de Conciliación la sincronizará en el siguiente ciclo.',
      comoSeLevantaYRecupera:
        'La cola Cloud Tasks (`minedec-pip-hot-reg-sync-<env>`) aplica reintentos automáticos con retroceso exponencial hasta 10 intentos.',
      accionesRecomendadasAdministrador: [
        '1. Inspeccione el estado de la cola con `gcloud tasks queues describe minedec-pip-hot-reg-sync-<env> --location=us-central1`.',
      ],
      detallesTecnicosSanitizados: {
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 7. Cuota de Google Workspace Admin Directory API agotada o throttled (429 / 503)
  if (
    options?.componentHint === 'GOOGLE_WORKSPACE_ADMIN_SDK' ||
    /GWS_RATE_LIMIT|rateLimitExceeded|userRateLimitExceeded|quotaExceeded|admin\.directory/i.test(
      message,
    )
  ) {
    return {
      codigoIncidente: 'GWS_DIRECTORY_API_QUOTA_THROTTLED',
      severidad: 'MEDIA',
      componenteAfectado: 'GOOGLE_WORKSPACE_ADMIN_SDK',
      posturaSeguridad: 'DEGRADACION_CONTROLADA',
      tituloLenguajeNatural:
        'Contención de cuota en Google Workspace Admin Directory API (<= 28 req/s)',
      explicacionLenguajeNatural:
        'El gobernador distribuido en Memorystore for Redis o la API de Google Workspace detectó que la tasa de consultas al directorio se acercó al techo operativo de 28 peticiones por segundo y aplicó retroceso exponencial con jitter aleatorio.',
      impactoOperativoYSeguridad:
        'El carril de alta prioridad (`REGISTRO_CALIENTE` y eventos incrementales) mantiene sus slots reservados. Los barridos batch desaceleran temporalmente sin perder ningún evento ni página gracias a los cursores en `checkpoint_conciliacion`.',
      comoSeLevantaYRecupera:
        'El gobernador `RedisDistributedRateGovernor` libera slots automáticamente en el siguiente segundo calendario y reintenta la operación sin intervención manual.',
      accionesRecomendadasAdministrador: [
        '1. Verifique en Cloud Monitoring la métrica `gwsRateGovernorBackoffTotal` para confirmar si coincide con la ventana del Job de Conciliación Masiva.',
        '2. Revise en Google Cloud Console > APIs & Services > Admin SDK API el consumo de cuota por minuto del proyecto.',
      ],
      detallesTecnicosSanitizados: {
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 8. Acumulación de eventos fallidos en Dead-Letter Queue (DLQ) del Sincronizador
  if (
    options?.componentHint === 'SINCRONIZADOR_GWS_DLQ' ||
    /DLQ|registro_fallo_sincronizacion|DEAD_LETTER/i.test(message)
  ) {
    return {
      codigoIncidente: 'SYNC_DLQ_PENDING_ACCUMULATION',
      severidad: 'ALTA',
      componenteAfectado: 'SINCRONIZADOR_GWS_DLQ',
      posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
      tituloLenguajeNatural:
        'Evento de sincronización derivado a la bandeja Dead-Letter (DLQ) tras agotar reintentos',
      explicacionLenguajeNatural:
        'Un mensaje proveniente de Google Workspace o de la cola de reconciliación falló de forma persistente tras agotar sus 5 intentos con backoff exponencial y fue almacenado de manera segura en `registro_fallo_sincronizacion`.',
      impactoOperativoYSeguridad:
        'El fallo se aísla para no bloquear el resto de la cola Pub/Sub (`HTTP 200` tras persistir en DLQ). La identidad afectada conserva su postura segura previa en AlloyDB.',
      comoSeLevantaYRecupera:
        'El Superadministrador puede consultar la bandeja en `GET /internal/v1/sync/dlq` y disparar el reprocesamiento puntual en `POST /internal/v1/sync/dlq/{idFallo}/replay`.',
      accionesRecomendadasAdministrador: [
        '1. Consulte `GET /internal/v1/sync/dlq?estado=PENDIENTE_REVISION` para inspeccionar el `codigoError` y el `detalleError` del evento.',
        '2. Una vez corregida la causa raíz, ejecute `POST /internal/v1/sync/dlq/{idFallo}/replay` para reinyectar y cerrar el fallo.',
      ],
      detallesTecnicosSanitizados: {
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 9. Expiración de latido (heartbeat) en partición del Job de Conciliación Masiva
  if (
    options?.componentHint === 'CONCILIACION_JOB_BATCH' ||
    /heartbeat|checkpoint_conciliacion|advisory_lock/i.test(message)
  ) {
    return {
      codigoIncidente: 'RECONCILIATION_PARTITION_HEARTBEAT_EXPIRED',
      severidad: 'MEDIA',
      componenteAfectado: 'CONCILIACION_JOB_BATCH',
      posturaSeguridad: 'DEGRADACION_CONTROLADA',
      tituloLenguajeNatural:
        'Reclamación automática de partición huérfana en el Job de Conciliación Masiva',
      explicacionLenguajeNatural:
        'Un worker del Cloud Run Job de Conciliación dejó de reportar latido (`heartbeat_at > 5 min`) en `checkpoint_conciliacion` mientras procesaba una Unidad Organizativa, posiblemente por preempción o reinicio del contenedor.',
      impactoOperativoYSeguridad:
        'Cero pérdida de progreso ni corrupción de datos: el último `next_page_token` quedó guardado transaccionalmente en AlloyDB al cierre de la última página de 500 usuarios.',
      comoSeLevantaYRecupera:
        'Otro worker activo adquiere el bloqueo consultivo `pg_try_advisory_lock` de la partición y reanuda exactamente desde el último `next_page_token` registrado.',
      accionesRecomendadasAdministrador: [
        '1. Verifique el avance de las particiones en `GET /internal/v1/sync/reconciliation/checkpoints`.',
        '2. Inspeccione los logs de ejecución de `conecta-conciliacion-job` en Cloud Run Jobs para verificar si hubo límite de memoria.',
      ],
      detallesTecnicosSanitizados: {
        errorCode,
        mensajeOriginalSanitizado: message,
        timestampIso,
        traceId,
      },
    };
  }

  // 10. Fallback general con explicación en lenguaje natural
  return {
    codigoIncidente: 'PIP_INTERNAL_UNEXPECTED_FAILURE',
    severidad: 'ALTA',
    componenteAfectado: options?.componentHint ?? 'PIP_IDENTITY_SERVICE',
    posturaSeguridad: 'FAIL_CLOSE_ACTIVO',
    tituloLenguajeNatural:
      'Error interno controlado en el Motor de Perfil e Identidades (PIP)',
    explicacionLenguajeNatural:
      'Se produjo una excepción interna no prevista durante el procesamiento de la solicitud en el microservicio PIP. El sistema interceptó el fallo de manera segura sin exponer datos sensibles ni comprometer las reglas de autorización.',
    impactoOperativoYSeguridad:
      'La operación actual fue abortada aplicando la política Fail-Close (denegación segura ante fallo). Cualquier transacción SQL abierta ejecutó ROLLBACK automático.',
    comoSeLevantaYRecupera:
      'El proceso Node.js en GKE Autopilot sigue activo y saludable para atender nuevas peticiones; Kubernetes monitorea continuamente la sonda `/healthz`.',
    accionesRecomendadasAdministrador: [
      '1. Busque en Cloud Logging el identificador de traza (`traceId`) adjunto en este reporte para inspeccionar el span OpenTelemetry y el contexto exacto del fallo.',
      '2. Verifique el estado integral de las dependencias en `GET /internal/v1/pip/health/detailed`.',
    ],
    detallesTecnicosSanitizados: {
      sqlState,
      errorCode,
      mensajeOriginalSanitizado: message,
      timestampIso,
      traceId,
    },
  };
}

export function buildGwsSyncIncidentDiagnostic(params: {
  scenario: string;
  domain?: string;
  orgUnitPath?: string;
  httpStatusGws?: number | null;
  pendingDlqCount?: number;
  errorMessage?: string;
}): AdminIncidentDiagnosticReport {
  const hintMap: Record<string, AffectedInfrastructureComponent> = {
    GWS_QUOTA_THROTTLED: 'GOOGLE_WORKSPACE_ADMIN_SDK',
    DLQ_PENDING_ACCUMULATION: 'SINCRONIZADOR_GWS_DLQ',
    PARTITION_HEARTBEAT_EXPIRED: 'CONCILIACION_JOB_BATCH',
  };
  return buildNaturalLanguageIncidentDiagnostic(
    new Error(
      params.errorMessage ??
        `${params.scenario} (${params.domain ?? 'minedec'} / ${params.orgUnitPath ?? '/'}) HTTP ${params.httpStatusGws ?? 'N/A'}`,
    ),
    {
      componentHint: hintMap[params.scenario] ?? 'SINCRONIZADOR_GWS_DLQ',
    },
  );
}
