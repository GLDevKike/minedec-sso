import {
  AMIE_CODE_REGEX,
  ALLOWED_PIP_SQL_IDENTIFIERS,
  AlloyDbAdvisoryLockManager,
  assertReadOnlyHttpMethod,
  assertReadOnlyWorkspaceScopes,
  buildProvisionalTempIdentifier,
  CIRCUITO_CODE_REGEX,
  computeAuditEventHashSha256,
  computeCanonicalGwsProfileHash,
  computeExponentialBackoffWithJitter,
  computePartitionAdvisoryLockKey,
  detectRuntimePlatformMetadata,
  DISTRITO_CODE_REGEX,
  enforceHardMaxTtlSeconds,
  evaluateMinedecPerfilMatrix,
  evaluateTemporalValidity,
  ExponentialBackoffPolicy,
  extractOrCreateOtelSpanContext,
  GENESIS_AUDIT_HASH_SHA256,
  getLogger,
  GWS_ADMIN_REPORTS_AUDIT_READONLY_SCOPE,
  GWS_DIRECTORY_USER_READONLY_SCOPE,
  GwsDirectoryReadOnlyAdapter,
  HARD_MAX_REDIS_TTL_SECONDS,
  hasGwsProfileChanged,
  InMemoryRedisCacheClient,
  isPartitionHeartbeatOrphaned,
  mapRawGoogleDirectoryUser,
  normalizeAndValidateNaturalPersonDocument,
  normalizeToOtelTraceId,
  PipMetricsCollector,
  PROVISIONAL_TEMP_ID_REGEX,
  RedisCacheClient,
  safeSqlIdentifier,
  SyncDiagnosticBuilder,
  TransactionalAuditEventWriter,
  UpsertWorkspaceAccountRequestSchema,
  validateEcuadorianCedula,
  withOtelSpan,
  ZONA_CODE_REGEX,
} from '../../../src';

describe('T015 - Validación de Identificadores de Persona Natural y Matriz MINEDEC_Perfil (@minedec/shared)', () => {
  describe('Algoritmo Módulo 10 Registro Civil (CEDULA 10 dígitos)', () => {
    it('acepta cédulas ecuatorianas válidas (provincias 01-24 y 30)', () => {
      expect(validateEcuadorianCedula('1710034065')).toBe(true);
      expect(validateEcuadorianCedula('0910000009')).toBe(true);
    });

    it('rechaza cédulas con longitud distinta de 10, provincia inválida, tercer dígito >= 6 o dígito verificador erróneo', () => {
      expect(validateEcuadorianCedula('171003406')).toBe(false);
      expect(validateEcuadorianCedula('0010034065')).toBe(false);
      expect(validateEcuadorianCedula('2510034065')).toBe(false);
      expect(validateEcuadorianCedula('1760034065')).toBe(false);
      expect(validateEcuadorianCedula('1710034064')).toBe(false);
    });
  });

  describe('Normalización de RUC de Persona Natural (13 dígitos) y Rechazo de RUC Societario (Constitución X.2)', () => {
    it('normaliza un RUC de 13 dígitos de persona natural (tercer dígito 0..5, sufijo 001..999) a CEDULA de 10 dígitos', () => {
      const result = normalizeAndValidateNaturalPersonDocument('CEDULA', '1710034065001');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.tipoIdentificacion).toBe('CEDULA');
        expect(result.numeroIdentificacion).toBe('1710034065');
        expect(result.normalizedFromNaturalPersonRuc).toBe(true);
      }
    });

    it('normaliza un RUC de 13 dígitos de persona natural incluso cuando se envía como RUC', () => {
      const result = normalizeAndValidateNaturalPersonDocument('RUC', '1710034065002');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.tipoIdentificacion).toBe('CEDULA');
        expect(result.numeroIdentificacion).toBe('1710034065');
        expect(result.normalizedFromNaturalPersonRuc).toBe(true);
      }
    });

    it('rechaza RUC de sociedad privada (tercer dígito 9) y entidad pública (tercer dígito 6) como SIN_IDENTIFICACION_VALIDA', () => {
      const rucPrivado = normalizeAndValidateNaturalPersonDocument('CEDULA', '1790016919001');
      expect(rucPrivado.valid).toBe(false);
      if (!rucPrivado.valid) {
        expect(rucPrivado.codigoCausal).toBe('SIN_IDENTIFICACION_VALIDA');
        expect(rucPrivado.motivo).toContain('personas naturales');
      }

      const rucPublico = normalizeAndValidateNaturalPersonDocument('RUC', '1760001550001');
      expect(rucPublico.valid).toBe(false);
      if (!rucPublico.valid) {
        expect(rucPublico.codigoCausal).toBe('SIN_IDENTIFICACION_VALIDA');
      }
    });

    it('rechaza RUC de 13 dígitos con sufijo 000 como SIN_IDENTIFICACION_VALIDA', () => {
      const rucSufijoCero = normalizeAndValidateNaturalPersonDocument('CEDULA', '1710034065000');
      expect(rucSufijoCero.valid).toBe(false);
      if (!rucSufijoCero.valid) {
        expect(rucSufijoCero.codigoCausal).toBe('SIN_IDENTIFICACION_VALIDA');
      }
    });

    it('valida PASAPORTE, CODIGO_MINEDEC e identificador provisional JIT (TEMP-*)', () => {
      const pasaporteOk = normalizeAndValidateNaturalPersonDocument('PASAPORTE', 'ab1234567');
      expect(pasaporteOk.valid).toBe(true);
      if (pasaporteOk.valid) {
        expect(pasaporteOk.tipoIdentificacion).toBe('PASAPORTE');
        expect(pasaporteOk.numeroIdentificacion).toBe('AB1234567');
      }

      const pasaporteBad = normalizeAndValidateNaturalPersonDocument('PASAPORTE', '12');
      expect(pasaporteBad.valid).toBe(false);
      if (!pasaporteBad.valid) {
        expect(pasaporteBad.codigoCausal).toBe('SIN_IDENTIFICACION_VALIDA');
      }

      const codigoOk = normalizeAndValidateNaturalPersonDocument('CODIGO_MINEDEC', 'minedec-20260001');
      expect(codigoOk.valid).toBe(true);
      if (codigoOk.valid) {
        expect(codigoOk.tipoIdentificacion).toBe('CODIGO_MINEDEC');
        expect(codigoOk.numeroIdentificacion).toBe('MINEDEC-20260001');
      }

      const codigoBad = normalizeAndValidateNaturalPersonDocument('CODIGO_MINEDEC', 'INVALID-CODE');
      expect(codigoBad.valid).toBe(false);
      if (!codigoBad.valid) {
        expect(codigoBad.codigoCausal).toBe('SIN_IDENTIFICACION_VALIDA');
      }

      const tempId = buildProvisionalTempIdentifier('109876543210987654321');
      expect(PROVISIONAL_TEMP_ID_REGEX.test(tempId)).toBe(true);
      const tempResult = normalizeAndValidateNaturalPersonDocument('CODIGO_MINEDEC', tempId, {
        allowProvisionalTemp: true,
      });
      expect(tempResult.valid).toBe(true);
    });

    it('valida expresiones regulares territoriales (ZONA, DISTRITO, CIRCUITO, AMIE)', () => {
      expect(ZONA_CODE_REGEX.test('09')).toBe(true);
      expect(DISTRITO_CODE_REGEX.test('17D05')).toBe(true);
      expect(CIRCUITO_CODE_REGEX.test('17D05C01')).toBe(true);
      expect(AMIE_CODE_REGEX.test('17H00123')).toBe(true);
      expect(AMIE_CODE_REGEX.test('INVALID')).toBe(false);
    });
  });

  describe('Matriz Condicional MINEDEC_Perfil y Vigencia Temporal', () => {
    it('evalúa correctamente perfiles DOCENTE, ESTUDIANTE y ADMINISTRATIVO sin anomalías cuando están completos', () => {
      const docenteInput = UpsertWorkspaceAccountRequestSchema.parse({
        googleSubId: 'sub-docente-100',
        emailPrincipal: 'juan.perez@docentes.educacion.gob.ec',
        nombreCompleto: 'Juan Pérez',
        orgUnitPath: '/Docentes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065',
          tipoUsuario: 'DOCENTE',
          subtipoUsuario: 'DOCENTE_NOMBRAMIENTO',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '17H00123',
          regimenEscolar: 'SIERRA_AMAZONIA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
          docenteMultisede: true,
        },
      });

      const evaluation = evaluateMinedecPerfilMatrix(docenteInput.minedecPerfil);

      expect(evaluation.efectoAccesoResultante).toBe('COMPLETO');
      expect(evaluation.anomaliasDetectadas).toHaveLength(0);
      expect(evaluation.validDocument).toBe(true);
    });

    it('detecta anomalías no bloqueantes en ESTUDIANTE con AMIE malformado y deriva nivelAcademico desde gradoCurso', () => {
      const estudianteInput = UpsertWorkspaceAccountRequestSchema.parse({
        googleSubId: 'sub-est-200',
        emailPrincipal: 'maria.lopez@estudiante.edu.ec',
        nombreCompleto: 'María López',
        orgUnitPath: '/Estudiantes/Zona9',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CODIGO_MINEDEC',
          numeroIdentificacion: 'MINEDEC-20260001',
          tipoUsuario: 'ESTUDIANTE',
          subtipoUsuario: 'ESTUDIANTE_REGULAR',
          nivelEstructura: 'INSTITUCION_EDUCATIVA',
          zonaDistritoCircuito: '09/17D05/17D05C01',
          codigoInstitucion: '99-INVALID',
          regimenEscolar: 'SIERRA_AMAZONIA',
          modalidadEducativa: 'PRESENCIAL',
          jornada: 'MATUTINA',
          gradoCurso: '3BGU',
        },
      });

      const evaluation = evaluateMinedecPerfilMatrix(estudianteInput.minedecPerfil);

      expect(evaluation.nivelAcademicoDerivado).toBe('BGU');
      expect(evaluation.efectoAccesoResultante).toBe('RESTRINGIDA_SOLO_AUTENTICADA');
      expect(evaluation.anomaliasDetectadas.map((a) => a.codigoCausal)).toContain(
        'FORMATO_AMIE_INVALIDO',
      );
    });

    it('detecta vigencia temporal expirada o fechas malformadas en subtipos temporales (PASANTE / CONTRATISTA)', () => {
      const expiredEval = evaluateTemporalValidity(
        '2025-01-01',
        '2025-06-01',
        new Date('2026-10-18T12:00:00Z'),
      );
      expect(expiredEval.validRange).toBe(true);
      expect(expiredEval.isExpired).toBe(true);

      const invertedEval = evaluateTemporalValidity('2026-12-01', '2026-01-01');
      expect(invertedEval.validRange).toBe(false);

      const pasanteSinFechas = UpsertWorkspaceAccountRequestSchema.parse({
        googleSubId: 'sub-pasante-300',
        emailPrincipal: 'carlos.vega@educacion.gob.ec',
        nombreCompleto: 'Carlos Vega',
        orgUnitPath: '/Administrativos/Pasantes',
        suspendedEnGws: false,
        origenSincronizacion: 'EVENTO_AUDIT_LOG',
        minedecPerfil: {
          tipoIdentificacion: 'CEDULA',
          numeroIdentificacion: '1710034065001',
          tipoUsuario: 'ADMINISTRATIVO',
          subtipoUsuario: 'PASANTE',
          nivelEstructura: 'PLANTA_CENTRAL',
          viceministerio: 'GESTION_EDUCATIVA',
          codigoDependenciaAdmin: 'DNTIC-01',
        },
      });

      const matrixEval = evaluateMinedecPerfilMatrix(pasanteSinFechas.minedecPerfil);
      expect(matrixEval.numeroIdentificacionNormalizado).toBe('1710034065');
      expect(matrixEval.anomaliasDetectadas.map((a) => a.codigoCausal)).toContain(
        'VIGENCIA_INVALIDA',
      );
    });
  });

  describe('Primitivas Compartidas (@minedec/shared): SQL Allowlist, Redis, Métricas, Auditoría, GWS ReadOnly y Diagnósticos', () => {
    it('valida safeSqlIdentifier, TTL Redis <= 300 s, métricas y auditoría SHA-256', async () => {
      expect(safeSqlIdentifier('persona_identidad', ALLOWED_PIP_SQL_IDENTIFIERS)).toBe(
        'persona_identidad',
      );
      expect(() => safeSqlIdentifier('DROP TABLE persona_identidad')).toThrow(
        /SQL_SECURITY_VIOLATION/,
      );
      expect(() => safeSqlIdentifier('tabla_no_permitida')).toThrow(
        /SQL_SECURITY_VIOLATION/,
      );

      expect(enforceHardMaxTtlSeconds(600)).toBe(HARD_MAX_REDIS_TTL_SECONDS);
      expect(() => enforceHardMaxTtlSeconds(0)).toThrow(/REDIS_TTL_VIOLATION/);

      const cache = new InMemoryRedisCacheClient();
      await cache.setWithTtl('test:key', 'valor', 250);
      expect(await cache.get('test:key')).toBe('valor');
      expect(await cache.ttl('test:key')).toBeLessThanOrEqual(250);
      await cache.unlinkKeys(['test:key']);
      expect(await cache.get('test:key')).toBeNull();

      const metrics = new PipMetricsCollector();
      metrics.recordCacheHit();
      metrics.recordCacheMiss();
      metrics.recordResolveRequest();
      metrics.recordCacheInvalidation();
      metrics.recordHotRegistration();
      metrics.incrementActiveAnomaly('BLOQUEANTE');
      metrics.recordAnomalyResolved('MANUAL_ADMIN', 'BLOQUEANTE');
      metrics.setActiveAnomaliesCount('RESTRINGIDA', 2);
      metrics.recordSyncEventProcessed('UPSERT');
      metrics.recordSyncSkippedUnchangedHash();
      metrics.setSyncDlqPendingRecords(3);
      metrics.incrementSyncDlqPending();
      metrics.decrementSyncDlqPending();
      metrics.recordGwsRateGovernorBackoff();
      metrics.recordReconciliationPageCompleted();
      metrics.recordOrphanAccountSuspended(2);
      const snap = metrics.getSnapshot();
      expect(snap.cacheHits).toBe(1);
      expect(snap.cacheHitRatio).toBe(0.5);
      expect(snap.resolveCount).toBe(1);
      expect(snap.cacheInvalidationsCount).toBe(1);
      expect(snap.activeAnomaliesByEffect.BLOQUEANTE).toBe(0);
      expect(snap.activeAnomaliesByEffect.RESTRINGIDA).toBe(2);
      expect(snap.syncEventsProcessedTotal).toBe(1);
      expect(snap.syncEventsSkippedUnchangedHashTotal).toBe(1);
      expect(snap.syncDlqPendingGauge).toBe(3);
      expect(snap.gwsRateGovernorBackoffTotal).toBe(1);
      expect(snap.reconciliationPagesCompletedTotal).toBe(1);
      expect(snap.orphanAccountsSuspendedTotal).toBe(2);
      metrics.reset();
      expect(metrics.getSnapshot().resolveCount).toBe(0);

      expect(detectRuntimePlatformMetadata({ CLOUD_RUN_JOB: 'sso-conciliacion-job' }).runtimePlatform).toBe(
        'CLOUD_RUN_JOB',
      );
      expect(detectRuntimePlatformMetadata({ K_SERVICE: 'sso-sincronizador' }).runtimePlatform).toBe(
        'CLOUD_RUN_SERVICE',
      );
      expect(detectRuntimePlatformMetadata({ K8S_POD_NAME: 'pip-pod-1' }).runtimePlatform).toBe(
        'GKE_AUTOPILOT',
      );
      expect(detectRuntimePlatformMetadata({}).runtimePlatform).toBe('LOCAL_NODE');

      const logger = getLogger('unit-test-service').withTraceId('trace-unit-1', 'span-unit-1');
      logger.info({ event: 'test' }, 'Evento info');
      logger.warn({ event: 'warn' }, 'Evento warn');
      logger.debug({ event: 'debug' }, 'Evento debug');
      expect(logger).toBeDefined();

      const hash1 = computeAuditEventHashSha256({
        eventoId: 'ev-1',
        fechaEventoIso: '2026-10-18T00:00:00.000Z',
        tipoEvento: 'IDENTIDAD_SINCRONIZADA',
        actorIdentificacion: 'SYSTEM',
        sujetoIdentificacion: 'id-1',
        valoresNuevosJson: '{"ok":true}',
        hashEventoAnteriorSha256: GENESIS_AUDIT_HASH_SHA256,
      });
      expect(hash1).toHaveLength(64);

      const mockQueries: string[] = [];
      const auditWriter = new TransactionalAuditEventWriter({
        query: async (text: string) => {
          mockQueries.push(text);
          return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
        },
      });
      const appended = await auditWriter.appendEvent({
        tipoEvento: 'IDENTIDAD_SINCRONIZADA',
        actorIdentificacion: 'SYSTEM',
        origenCanal: 'PIP_INGEST',
        entidadAfectada: 'persona_identidad',
        registroAfectadoId: 'id-1',
      });
      expect(appended.hashEventoAnteriorSha256).toBe(GENESIS_AUDIT_HASH_SHA256);
      expect(appended.hashEventoSha256).toHaveLength(64);
      expect(mockQueries).toHaveLength(3);
      expect(mockQueries[0]).toContain('pg_advisory_xact_lock');

      const fakeIoredis = {
        get: async (k: string) => (k === 'hit' ? '{"ok":true}' : k === 'bad-json' ? '{bad' : null),
        set: async () => 'OK',
        incr: async () => 1,
        expire: async () => 1,
        hgetall: async () => ({ a: '1' }),
        pipeline: () => ({
          del: function () { return this; },
          hset: function () { return this; },
          expire: function () { return this; },
          exec: async () => [],
        }),
        unlink: async (...keys: string[]) => keys.length,
        ttl: async () => 250,
        quit: async () => 'OK',
      };
      const redisWrapper = new RedisCacheClient(fakeIoredis as never);
      expect(redisWrapper.keyBySub('s1')).toBe('pip:profile:sub:s1');
      expect(redisWrapper.keyByEmail('A@B.EC')).toBe('pip:profile:email:a@b.ec');
      expect(redisWrapper.keyByInternalId('id1')).toBe('pip:profile:id:id1');
      expect(redisWrapper.keyByDoc('cedula', '1710034065')).toBe('pip:profile:doc:CEDULA:1710034065');
      expect(await redisWrapper.get('hit')).toBe('{"ok":true}');
      expect(await redisWrapper.getJson('hit')).toEqual({ ok: true });
      expect(await redisWrapper.getJson('bad-json')).toBeNull();
      expect(await redisWrapper.getJson('miss')).toBeNull();
      await redisWrapper.setWithTtl('k1', 'v1', 200);
      await redisWrapper.setJson('kjson', { a: 1 }, 200);
      expect(await redisWrapper.incrWithTtl('kincr', 10)).toBe(1);
      expect(await redisWrapper.hgetall('h1')).toEqual({ a: '1' });
      await redisWrapper.hsetWithTtl('h1', {}, 200);
      await redisWrapper.hsetWithTtl('h1', { f1: 'v1' }, 200);
      expect(await redisWrapper.unlinkKeys([])).toBe(0);
      expect(await redisWrapper.deleteKeys(['k1', 'k2', 'k1'])).toBe(2);
      expect(await redisWrapper.ttl('k1')).toBe(250);
      await redisWrapper.close();

      const fallbackRedis = new RedisCacheClient();
      await fallbackRedis.setJson('fk1', { ok: 1 }, 60);
      expect(await fallbackRedis.getJson('fk1')).toEqual({ ok: 1 });
      expect(await fallbackRedis.incrWithTtl('fincr', 60)).toBe(1);
      expect(await fallbackRedis.incrWithTtl('fincr', 60)).toBe(2);
      await fallbackRedis.hsetWithTtl('fh1', { x: 'y' }, 60);
      expect(await fallbackRedis.hgetall('fh1')).toEqual({ x: 'y' });
      expect(await fallbackRedis.ttl('fh1')).toBeGreaterThan(0);
      expect(await fallbackRedis.deleteKeys(['fk1', 'fh1'])).toBe(2);
      await fallbackRedis.close();

      const inMem = new InMemoryRedisCacheClient();
      expect(await inMem.hgetall('missing-hash')).toEqual({});
      await inMem.hsetWithTtl('my-hash', { field1: 'val1' }, 120);
      expect(await inMem.hgetall('my-hash')).toEqual({ field1: 'val1' });
      expect(await inMem.ttl('my-hash')).toBeGreaterThan(0);
      expect(await inMem.ttl('non-existent')).toBe(-2);
      expect(await inMem.unlinkKeys(['  ', 'my-hash'])).toBe(1);
      await inMem.close();
    });

    it('valida SyncDiagnosticBuilder, ExponentialBackoffPolicy, AlloyDbAdvisoryLockManager, hash GWS, GwsDirectoryReadOnlyAdapter y OTel tracing', async () => {
      // SyncDiagnosticBuilder
      const scenarios = [
        'GWS_QUOTA_THROTTLED',
        'DLQ_EVENT_EXHAUSTED',
        'PARTITION_ORPHAN_RECOVERED',
        'PARTITION_CONFLICT_ACTIVE',
        'INVALID_GWS_PAYLOAD',
        'HEALTH_SUMMARY',
      ] as const;
      for (const escenario of scenarios) {
        const diag = SyncDiagnosticBuilder.build({
          escenario,
          dominio: 'educacion.gob.ec',
          orgUnitPath: '/Docentes',
          googleUserId: 'sub-1',
          idEventoExterno: 'ev-1',
          httpStatusGws: 429,
          intentosRealizados: 5,
          pendientesDlq: 2,
          modoIngesta: 'LOTE_LIST_500',
          reqPorSegundoActual: 18,
          detalleError: 'Error con token ya29.secret123',
        });
        expect(diag.componenteAfectado).toContain('1. Componente afectado');
        expect(diag.impactoOperativo).toContain('2. Impacto operativo');
        expect(diag.mitigacionActiva).toContain('3. Mitigación activa');
        expect(diag.accionRecomendada).toContain('4. Acción recomendada');
      }
      const builder = new SyncDiagnosticBuilder();
      for (const escenario of scenarios) {
        const minDiag = SyncDiagnosticBuilder.build({ escenario });
        expect(minDiag.componenteAfectado).toContain('1. Componente afectado');
      }
      const lockDiag = builder.buildPartitionLockConflictDiagnostic({
        dominio: 'educacion.gob.ec',
        orgUnitPath: '/Docentes',
      });
      expect(lockDiag.mensajeConsolidado).toContain('409 Conflict');

      // ExponentialBackoffPolicy
      const delay0 = ExponentialBackoffPolicy.computeDelayMs(0, null, () => 250);
      expect(delay0.backoffMs).toBe(1250);
      expect(delay0.honoredRetryAfter).toBe(false);

      const delayRetryAfter = ExponentialBackoffPolicy.computeDelayMs(0, '5', () => 100);
      expect(delayRetryAfter.backoffMs).toBe(5000);
      expect(delayRetryAfter.honoredRetryAfter).toBe(true);

      expect(ExponentialBackoffPolicy.parseRetryAfterMs(undefined)).toBeNull();
      expect(ExponentialBackoffPolicy.parseRetryAfterMs(3)).toBe(3000);
      expect(ExponentialBackoffPolicy.parseRetryAfterMs(new Date(Date.now() + 4000).toUTCString())).toBeGreaterThan(0);

      let tries = 0;
      const retrySuccess = await ExponentialBackoffPolicy.executeWithRetry(
        async (attempt) => {
          tries = attempt;
          if (attempt < 2) {
            const err = new Error('Transient 503') as Error & { httpStatus?: number };
            err.httpStatus = 503;
            throw err;
          }
          return 'OK';
        },
        { sleepFn: async () => undefined, jitterMsGenerator: () => 50 },
      );
      expect(retrySuccess.result).toBe('OK');
      expect(retrySuccess.attemptsMade).toBe(2);
      expect(tries).toBe(2);

      const jitterRes = computeExponentialBackoffWithJitter(3, () => 0.5);
      expect(jitterRes.baseDelayMs).toBe(4000);
      expect(jitterRes.jitterMs).toBe(500);

      // AlloyDbAdvisoryLockManager
      const key1 = computePartitionAdvisoryLockKey('educacion.gob.ec', '/Docentes', 'BARRIDO_DELTA_DIARIO');
      expect(BigInt(key1)).toBeGreaterThan(0n);
      expect(() => computePartitionAdvisoryLockKey('   ')).toThrow(/no puede ser vacío/);
      expect(isPartitionHeartbeatOrphaned(null)).toBe(true);
      expect(isPartitionHeartbeatOrphaned(new Date().toISOString(), 15)).toBe(false);

      const lockMgr = new AlloyDbAdvisoryLockManager();
      const acq = await lockMgr.tryAcquirePartitionLock('educacion.gob.ec', '/Docentes');
      expect(acq.acquired).toBe(true);
      expect(await lockMgr.releasePartitionLock('educacion.gob.ec', '/Docentes')).toBe(true);
      const withLockRes = await lockMgr.withPartitionLock('educacion.gob.ec:/Docentes', async (k) => k);
      expect(withLockRes.executed).toBe(true);

      // Hash GWS
      const h1 = computeCanonicalGwsProfileHash({
        googleSubId: 'sub-1',
        emailPrincipal: 'user@educacion.gob.ec',
        nombreCompleto: 'User Uno',
        orgUnitPath: '/Docentes',
        minedecPerfil: { tipoIdentificacion: 'CEDULA', numeroIdentificacion: '1710034065' },
      });
      expect(h1).toHaveLength(64);
      expect(hasGwsProfileChanged(null, h1)).toBe(true);
      expect(hasGwsProfileChanged(h1, h1)).toBe(false);

      // GwsDirectoryReadOnlyAdapter
      expect(() => assertReadOnlyWorkspaceScopes([])).toThrow(/al menos un scope/);
      expect(() => assertReadOnlyWorkspaceScopes(['https://www.googleapis.com/auth/admin.directory.user'])).toThrow(
        /Scope prohibido/,
      );
      expect(() =>
        assertReadOnlyWorkspaceScopes([
          GWS_DIRECTORY_USER_READONLY_SCOPE,
          GWS_ADMIN_REPORTS_AUDIT_READONLY_SCOPE,
        ]),
      ).not.toThrow();
      expect(() => assertReadOnlyHttpMethod('POST')).toThrow(/Operación HTTP/);
      expect(() => assertReadOnlyHttpMethod('GET')).not.toThrow();

      const mappedUser = mapRawGoogleDirectoryUser({
        id: 'sub-999',
        primaryEmail: 'Docente.Test@Educacion.Gob.Ec',
        name: { givenName: 'Docente', familyName: 'Test', fullName: 'Docente Test' },
        orgUnitPath: '/Docentes',
        suspended: false,
        customSchemas: {
          MINEDEC_Perfil: {
            tipoIdentificacion: 'CEDULA',
            numeroIdentificacion: '1710034065',
          },
        },
      });
      expect(mappedUser.emailPrincipal).toBe('docente.test@educacion.gob.ec');

      const gwsAdapter = new GwsDirectoryReadOnlyAdapter({
        gwsHttpTransport: {
          getUser: async ({ userKey }) =>
            userKey === 'sub-999' ? mappedUser : null,
          listUsers: async () => ({ users: [mappedUser], nextPageToken: null }),
          listAdminAuditActivities: async () => [],
        },
      });
      const fetched = await gwsAdapter.getUserReadOnly('sub-999');
      expect(fetched?.googleSubId).toBe('sub-999');
      const listed = await gwsAdapter.listUsersReadOnly({ domain: 'educacion.gob.ec', orgUnitPath: '/Docentes' });
      expect(listed.users).toHaveLength(1);
      const audits = await gwsAdapter.listAdminUserAuditEvents({ startTimeIso: '2026-10-18T00:00:00Z' });
      expect(audits).toEqual([]);

      // OTel Tracing
      expect(normalizeToOtelTraceId('550e8400-e29b-41d4-a716-446655440000')).toHaveLength(32);
      const ctxW3c = extractOrCreateOtelSpanContext({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      });
      expect(ctxW3c.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(ctxW3c.parentSpanId).toBe('00f067aa0ba902b7');

      const ctxCloud = extractOrCreateOtelSpanContext({
        'x-cloud-trace-context': '4bf92f3577b34da6a3ce929d0e0e4736/12345;o=1',
      });
      expect(ctxCloud.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');

      const spanRes = await withOtelSpan(
        'test.span',
        { parentContext: ctxW3c, attributes: { component: 'shared' } },
        async (spanCtx) => spanCtx.traceId,
      );
      expect(spanRes).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    });
  });
});
