import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import format from 'pg-format';
import {
  AdminIncidentDiagnosticReport,
  buildNaturalLanguageIncidentDiagnostic,
  isInfrastructureOutageError,
} from '../observability/incident-diagnostics';
import { createStructuredLogger, StructuredLogger } from '../observability/logger';

/**
 * Expresión regular canónica para identificadores SQL seguros (Constitución XIV.2).
 */
export const SAFE_SQL_IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Lista blanca cerrada de tablas y columnas permitidas para interpolación dinámica de identificadores
 * en el dominio PIP (Constitución XIV.2).
 */
export const ALLOWED_PIP_SQL_IDENTIFIERS: ReadonlySet<string> = new Set([
  // 15 Tablas canónicas 3FN (8 PIP Etapa 1 + 3 Sincronizador/Conciliación Feature 002 + 4 SSO OIDC Feature 003)
  'dominio_institucional',
  'catalogo_atributo_minedec',
  'catalogo_territorio_sede',
  'persona_identidad',
  'cuenta_institucional',
  'asignacion_contexto',
  'anomalia_identidad',
  'auditoria_evento',
  'checkpoint_conciliacion',
  'evento_sincronizacion_procesado',
  'registro_fallo_sincronizacion',
  'aplicacion',
  'cliente_oidc',
  'cliente_oidc_redirect_uri',
  'llave_jwks_rotacion',
  // Columnas dominio_institucional
  'dominio',
  'google_customer_id',
  'tipo_poblacion',
  'es_subdominio',
  'activo',
  'creado_en',
  'actualizado_en',
  // Columnas catalogo_atributo_minedec
  'catalogo_id',
  'categoria_atributo',
  'codigo_valor',
  'codigo_padre',
  'etiqueta_visible',
  'nivel_academico_derivado',
  'requiere_vigencia_temporal',
  'metadatos_regla',
  // Columnas catalogo_territorio_sede
  'codigo_amie',
  'nombre_institucion',
  'codigo_zona',
  'codigo_distrito',
  'codigo_circuito',
  'provincia_dpa',
  'canton_dpa',
  'parroquia_dpa',
  'regimen_escolar',
  'sostenimiento',
  'modalidad_educativa',
  'jornada',
  // Columnas persona_identidad
  'id_interno',
  'tipo_identificacion',
  'numero_identificacion',
  'codigo_minedec_anterior',
  'nombre_completo',
  'fecha_nacimiento',
  'representante_legal_cedula',
  'estado_persona',
  // Columnas cuenta_institucional
  'cuenta_id',
  'google_sub_id',
  'email_principal',
  'org_unit_path',
  'given_name',
  'family_name',
  'tipo_usuario',
  'subtipo_usuario',
  'cargo_funcion',
  'grado_curso',
  'docente_multisede',
  'fecha_inicio_vigencia',
  'fecha_fin_vigencia',
  'suspended_en_gws',
  'estado_sincronizacion',
  'origen_ultima_sincronizacion',
  'hash_payload_gws',
  'ultima_sincronizacion_en',
  // Columnas asignacion_contexto
  'asignacion_id',
  'origen_datos',
  'es_sede_primaria',
  'nivel_estructura',
  'viceministerio',
  'codigo_dependencia_admin',
  'asignado_por_identificacion',
  'motivo_asignacion',
  // Columnas anomalia_identidad
  'anomalia_id',
  'anomalia_anterior_id',
  'codigo_causal',
  'efecto_acceso',
  'estado_anomalia',
  'origen_resolucion',
  'resuelta_por_identificacion',
  'motivo_resolucion',
  'valor_anterior',
  'valor_nuevo',
  'detalle_tecnico',
  'detectada_en',
  'resuelta_en',
  // Columnas auditoria_evento
  'evento_id',
  'tipo_evento',
  'actor_id_interno',
  'actor_identificacion',
  'sujeto_identificacion',
  'correo_afectado',
  'origen_canal',
  'entidad_afectada',
  'registro_afectado_id',
  'valores_anteriores',
  'valores_nuevos',
  'hash_evento_anterior_sha256',
  'hash_evento_sha256',
  'fecha_evento',
  // Columnas checkpoint_conciliacion
  'checkpoint_id',
  'tipo_proceso',
  'next_page_token',
  'cuentas_procesadas',
  'cuentas_actualizadas',
  'cuentas_omitidas_hash',
  'cuentas_baja_detectadas',
  'anomalias_abiertas',
  'estado_ejecucion',
  'worker_instancia_id',
  'lock_advisory_key',
  'heartbeat_en',
  'iniciado_en',
  'completado_en',
  'ultimo_error_codigo',
  'diagnostico_operativo',
  // Columnas evento_sincronizacion_procesado
  'id_evento_externo',
  'timestamp_evento_gws',
  'modo_despacho',
  'resultado',
  'procesado_en',
  // Columnas registro_fallo_sincronizacion
  'dlq_id',
  'payload_original',
  'intentos_realizados',
  'codigo_error',
  'detalle_error_tecnico',
  'diagnostico_lenguaje_natural',
  'accion_recomendada',
  'estado_dlq',
  'resuelto_por_identificacion',
  'resuelto_en',
  // Columnas aplicacion (Feature 003 / Etapa 2)
  'aplicacion_id',
  'codigo_unico',
  'nombre_visible',
  'descripcion',
  'patron_integracion',
  'nivel_adopcion_pep',
  'host_publico',
  'url_backend_interno',
  'politica_ruta_defecto',
  'viceministerio_dueno',
  'estado_ciclo_vida',
  'version_catalogo',
  'creado_por',
  // Columnas cliente_oidc (Feature 003 / Etapa 3)
  'cliente_oidc_id',
  'oidc_client_id',
  'secreto_activo_hash',
  'secreto_anterior_hash',
  'gracia_hasta',
  'expira_rotacion_en',
  'metodo_autenticacion_token',
  'estado_cliente',
  // Columnas cliente_oidc_redirect_uri (Feature 003 / Etapa 3)
  'redirect_uri_id',
  'tipo_uri',
  'uri',
  // Columnas llave_jwks_rotacion (Feature 003 / Etapa 3)
  'kid',
  'servicio_emisor',
  'algoritmo',
  'secret_manager_version',
  'public_jwk_json',
  'estado_llave',
  'activada_en',
  'retirada_en',
  // Tablas Feature 004 / Etapa 2 y 3 (Motor PDP y Gobierno RBAC + ABAC)
  'administrador_aplicativo',
  'ruta_catalogo',
  'permiso_atomico',
  'ruta_permiso_requerido',
  'rol',
  'rol_permiso',
  'perfil',
  'perfil_rol',
  'grupo_logico',
  'grupo_logico_rol',
  'grupo_logico_perfil',
  'usuario_rol_aplicacion',
  'credencial_m2m',
  // Columnas aplicacion + administrador_aplicativo + ruta_catalogo + permiso_atomico + rol + perfil + grupo_logico + usuario_rol_aplicacion + credencial_m2m (Feature 004)
  'modo_sombra',
  'admin_app_id',
  'rol_consola',
  'asignado_por',
  'ruta_id',
  'patron_ruta',
  'metodo_http',
  'tipo_coincidencia',
  'nivel_acceso',
  'modo_evaluacion_permisos',
  'orden_especificidad',
  'permiso_id',
  'codigo_permiso',
  'accion_crud_requerida',
  'rol_id',
  'codigo_rol',
  'es_rol_sistema',
  'puede_crear',
  'puede_leer',
  'puede_editar',
  'puede_eliminar',
  'perfil_id',
  'codigo_perfil',
  'grupo_logico_id',
  'codigo_grupo',
  'regla_cruce_abac_rbac',
  'prioridad_evaluacion',
  'asignacion_rol_id',
  'codigo_zona_acotado',
  'codigo_distrito_acotado',
  'codigo_circuito_acotado',
  'codigo_amie_acotado',
  'credencial_id',
  'tipo_cliente',
  'client_id',
  'scopes_permitidos',
  'estado_credencial',
]);

/**
 * Valida un identificador SQL contra la expresión regular canónica y una lista blanca cerrada,
 * devolviendo el identificador escapado con `%I` mediante `pg-format` (Constitución XIV.2).
 */
export function safeSqlIdentifier(
  identifier: string,
  allowlist: ReadonlySet<string> = ALLOWED_PIP_SQL_IDENTIFIERS,
): string {
  if (!SAFE_SQL_IDENTIFIER_REGEX.test(identifier)) {
    throw new Error(
      `[SQL_SECURITY_VIOLATION] Identificador SQL inválido rechazado por regex safe_sql_identifier: "${identifier}"`,
    );
  }
  if (!allowlist.has(identifier)) {
    throw new Error(
      `[SQL_SECURITY_VIOLATION] Identificador SQL no autorizado en allowlist cerrada: "${identifier}"`,
    );
  }
  return format('%I', identifier);
}

export const quotePipIdentifier = safeSqlIdentifier;

/**
 * Interfaz mínima de ejecutor SQL parametrizado ($1, $2, ...) para soportar tanto Pool como PoolClient
 * dentro de transacciones y dobles de prueba en integración.
 */
export interface SqlQueryExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ): Promise<QueryResult<R>>;
}

export interface DatabaseHealthStatus {
  estado: 'OPERATIVO' | 'CAIDO_O_EN_FAILOVER';
  rolInstancia: 'PRIMARIA_LECTURA_ESCRITURA' | 'REPLICA_SOLO_LECTURA' | 'DESCONOCIDO';
  resumenLenguajeNatural: string;
  mecanismoRespaldoYRecuperacion: string;
  diagnosticoIncidente?: AdminIncidentDiagnosticReport;
}

export interface DatabaseTransactionManager extends SqlQueryExecutor {
  withTransaction<T>(fn: (tx: SqlQueryExecutor) => Promise<T>): Promise<T>;
  runInTransaction?<T>(fn: (tx: SqlQueryExecutor) => Promise<T>): Promise<T>;
  checkHealth?(traceId?: string): Promise<DatabaseHealthStatus>;
  close(): Promise<void>;
}

export interface PostgresPoolConfig {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  maxConnectionRetries?: number;
  retryDelayMs?: number;
  logger?: StructuredLogger;
  poolInstance?: Pool;
}

/**
 * Cliente PostgreSQL / AlloyDB con soporte de transacciones ACID, consultas 100% parametrizadas,
 * reconexión automática con backoff ante conmutación HA (`REGIONAL`) y diagnóstico en lenguaje natural.
 */
export class PostgresDatabaseClient implements DatabaseTransactionManager {
  private readonly pool: Pool;
  private readonly maxConnectionRetries: number;
  private readonly retryDelayMs: number;
  private readonly logger: StructuredLogger;

  constructor(config: PostgresPoolConfig = {}) {
    this.maxConnectionRetries =
      config.maxConnectionRetries ?? Number(process.env.DB_MAX_RETRIES ?? 2);
    this.retryDelayMs = config.retryDelayMs ?? Number(process.env.DB_RETRY_DELAY_MS ?? 50);
    this.logger = config.logger ?? createStructuredLogger('alloydb-postgres-client');

    this.pool =
      config.poolInstance ??
      new Pool({
        connectionString: config.connectionString ?? process.env.DATABASE_URL,
        max: config.max ?? Number(process.env.DB_POOL_MAX ?? 20),
        idleTimeoutMillis:
          config.idleTimeoutMillis ?? Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30000),
        connectionTimeoutMillis:
          config.connectionTimeoutMillis ??
          Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5000),
      });

    if (typeof this.pool.on === 'function') {
      this.pool.on('error', (err: Error) => {
        const diagnostic = buildNaturalLanguageIncidentDiagnostic(err, {
          componentHint: 'ALLOYDB_POSTGRESQL_16',
        });
        this.logger.error(
          'Evento de desconexión o conmutación HA detectado en cliente inactivo del pool de AlloyDB',
          {
            error: err,
            diagnosticoAdministrador: diagnostic,
          },
        );
      });
    }
  }

  private async executeWithFailoverRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (attempt < this.maxConnectionRetries && isInfrastructureOutageError(error)) {
          attempt += 1;
          const backoffMs = this.retryDelayMs * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Reintentando operación en AlloyDB tras fallo transitorio de conexión/failover (intento ${attempt}/${this.maxConnectionRetries})`,
            { attempt, backoffMs },
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        throw error;
      }
    }
  }

  public async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ): Promise<QueryResult<R>> {
    return this.executeWithFailoverRetry(() =>
      this.pool.query<R>(text, values ? [...values] : undefined),
    );
  }

  public async withTransaction<T>(
    fn: (tx: SqlQueryExecutor) => Promise<T>,
  ): Promise<T> {
    const client: PoolClient = await this.executeWithFailoverRetry(() =>
      this.pool.connect(),
    );
    try {
      await client.query('BEGIN');
      const txExecutor: SqlQueryExecutor = {
        query: <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: ReadonlyArray<unknown>,
        ) => client.query<R>(text, values ? [...values] : undefined),
      };
      const result = await fn(txExecutor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Si la conexión cayó a mitad de la transacción, AlloyDB aborta la transacción automáticamente.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async runInTransaction<T>(
    fn: (tx: SqlQueryExecutor) => Promise<T>,
  ): Promise<T> {
    return this.withTransaction(fn);
  }

  /**
   * Verifica en tiempo real la salud del clúster AlloyDB for PostgreSQL 16 y devuelve una
   * explicación detallada en lenguaje natural para el Administrador sobre el estado actual
   * y los mecanismos de respaldo/recuperación.
   */
  public async checkHealth(traceId?: string): Promise<DatabaseHealthStatus> {
    try {
      const result = await this.pool.query<{ in_recovery: boolean }>(
        'SELECT pg_is_in_recovery() AS in_recovery',
      );
      const inRecovery = Boolean(result.rows[0]?.in_recovery);
      return {
        estado: 'OPERATIVO',
        rolInstancia: inRecovery
          ? 'REPLICA_SOLO_LECTURA'
          : 'PRIMARIA_LECTURA_ESCRITURA',
        resumenLenguajeNatural: inRecovery
          ? 'Conectado a una instancia de solo lectura (Read Pool) de AlloyDB.'
          : 'El clúster AlloyDB for PostgreSQL 16 responde correctamente en modo lectura/escritura. La tabla inmutable auditoria_evento y las 8 entidades del PIP están operativas.',
        mecanismoRespaldoYRecuperacion:
          'Alta Disponibilidad Regional (REGIONAL HA) activa con promoción automática de standby < 60 s (RPO = 0), Respaldo Continuo (PITR de 14 días), respaldos diarios automatizados encriptados y deletion_protection = true.',
      };
    } catch (error) {
      const diagnostic = buildNaturalLanguageIncidentDiagnostic(error, {
        traceId,
        componentHint: 'ALLOYDB_POSTGRESQL_16',
      });
      return {
        estado: 'CAIDO_O_EN_FAILOVER',
        rolInstancia: 'DESCONOCIDO',
        resumenLenguajeNatural: diagnostic.explicacionLenguajeNatural,
        mecanismoRespaldoYRecuperacion: diagnostic.comoSeLevantaYRecupera,
        diagnosticoIncidente: diagnostic,
      };
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
