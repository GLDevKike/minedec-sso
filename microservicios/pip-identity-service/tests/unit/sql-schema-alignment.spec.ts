import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALLOWED_PIP_SQL_IDENTIFIERS } from '@minedec/shared';

const PIP_ROOT_DIR = path.resolve(__dirname, '../..');
const WORKSPACE_ROOT_DIR = path.resolve(PIP_ROOT_DIR, '../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PIP_ROOT_DIR, relativePath), 'utf8');
}

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT_DIR, relativePath), 'utf8');
}

function extractSqlTableColumns(sqlContent: string): Record<string, Set<string>> {
  const tables: Record<string, Set<string>> = {};
  const createTableRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi;
  let match: RegExpExecArray | null;
  while ((match = createTableRegex.exec(sqlContent)) !== null) {
    const tableName = match[1].toLowerCase();
    const body = match[2];
    const cols = new Set<string>();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (
        !line ||
        line.startsWith('--') ||
        /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(line)
      ) {
        continue;
      }
      const colMatch =
        /^([a-z0-9_]+)\s+(UUID|VARCHAR|CHAR|TEXT|BOOLEAN|DATE|TIMESTAMPTZ|JSONB|BIGSERIAL|INTEGER|BIGINT)\b/i.exec(
          line,
        );
      if (colMatch) {
        cols.add(colMatch[1].toLowerCase());
      }
    }
    tables[tableName] = cols;
  }

  const alterAddColRegex =
    /ALTER\s+TABLE\s+([a-z0-9_]+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)\s+/gi;
  let alterMatch: RegExpExecArray | null;
  while ((alterMatch = alterAddColRegex.exec(sqlContent)) !== null) {
    const tableName = alterMatch[1].toLowerCase();
    const colName = alterMatch[2].toLowerCase();
    if (!tables[tableName]) {
      tables[tableName] = new Set<string>();
    }
    tables[tableName].add(colName);
  }

  return tables;
}

function extractDbmlTableColumns(dbmlContent: string): Record<string, Set<string>> {
  const tables: Record<string, Set<string>> = {};
  const tableRegex = /Table\s+([a-z0-9_]+)(?:\s*\[[^\]]*\])?\s*\{([\s\S]*?)\n\}/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(dbmlContent)) !== null) {
    const tableName = match[1].toLowerCase();
    const body = match[2];
    const cols = new Set<string>();
    let inIndexes = false;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('Note:')) {
        continue;
      }
      if (/^Indexes\s*\{/i.test(line)) {
        inIndexes = true;
        continue;
      }
      if (inIndexes) {
        if (line.startsWith('}')) {
          inIndexes = false;
        }
        continue;
      }
      const colMatch = /^([a-z0-9_]+)\s+[a-z0-9_()[\]]+/i.exec(line);
      if (colMatch) {
        cols.add(colMatch[1].toLowerCase());
      }
    }
    tables[tableName] = cols;
  }
  return tables;
}

function extractInsertStatements(source: string): Array<{ table: string; columns: string[] }> {
  const results: Array<{ table: string; columns: string[] }> = [];
  const varMap = new Map<string, string>();
  const varRegex =
    /const\s+([a-zA-Z0-9_]+)\s*=\s*quotePipIdentifier\(\s*['"]([a-z0-9_]+)['"]\s*\)/g;
  let vMatch: RegExpExecArray | null;
  while ((vMatch = varRegex.exec(source)) !== null) {
    varMap.set(vMatch[1], vMatch[2].toLowerCase());
  }

  const insertRegex =
    /INSERT\s+INTO\s+(?:([a-z0-9_]+)|\$\{([a-zA-Z0-9_]+)\})\s*\(([\s\S]*?)\)\s*VALUES/gi;
  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(source)) !== null) {
    const rawTable = match[1] ? match[1].toLowerCase() : varMap.get(match[2] ?? '') ?? '';
    if (!rawTable) continue;
    const columns = match[3]
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0);
    results.push({ table: rawTable, columns });
  }
  return results;
}

describe('Auditoría de Esquema Relacional 3FN/BCNF (DDL 001..005 vs DBML Etapas 1..3 y Maestro vs Repositorios PostgreSQL)', () => {
  const ddlSql001 = readRepoFile('migrations/001_init_pip_identity_schema.sql');
  const ddlSql003 = readRepoFile('migrations/003_sync_reconciliation_schema.sql');
  const ddlSql004 = readRepoFile('migrations/004_sso_oidc_broker_schema.sql');
  const ddlSql005 = readRepoFile('migrations/005_motor_pdp_authorization_schema.sql');
  const ddlSqlEtapa1 = `${ddlSql001}\n${ddlSql003}`;
  const ddlSqlFull = `${ddlSql001}\n${ddlSql003}\n${ddlSql004}\n${ddlSql005}`;
  const seedSql = readRepoFile('migrations/002_seed_minedec_catalogs.sql');
  const dbmlEtapa1 = readWorkspaceFile('minedec-sso/docs/esquemas-bd/etapa-1-identidad-pip-auditoria.dbml');
  const dbmlEtapa2 = readWorkspaceFile('minedec-sso/docs/esquemas-bd/etapa-2-autorizacion-pdp-pap-rbac-abac.dbml');
  const dbmlEtapa3 = readWorkspaceFile('minedec-sso/docs/esquemas-bd/etapa-3-seguridad-m2m-jwks-publicador.dbml');
  const dbmlMaestro = readWorkspaceFile('minedec-sso/docs/esquemas-bd/00-esquema-maestro-completo.dbml');
  const dataModelMd = readWorkspaceFile('minedec-sso/specs/001-modelo-identidades-perfil/data-model.md');

  const ddlTablesEtapa1 = extractSqlTableColumns(ddlSqlEtapa1);
  const ddlTables004 = extractSqlTableColumns(ddlSql004);
  const ddlTables005 = extractSqlTableColumns(ddlSql005);
  const ddlTablesFull = extractSqlTableColumns(ddlSqlFull);

  const dbmlTablesEtapa1 = extractDbmlTableColumns(dbmlEtapa1);
  const dbmlTablesEtapa2 = extractDbmlTableColumns(dbmlEtapa2);
  const dbmlTablesEtapa3 = extractDbmlTableColumns(dbmlEtapa3);
  const dbmlTablesMaestro = extractDbmlTableColumns(dbmlMaestro);

  const expectedEtapa1Tables = [
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
  ];

  const expectedFeature003Tables = [
    'aplicacion',
    'cliente_oidc',
    'cliente_oidc_redirect_uri',
    'llave_jwks_rotacion',
  ];

  const expectedFeature004Tables = [
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
  ];

  const expectedAllImplementedTables = [
    ...expectedEtapa1Tables,
    ...expectedFeature003Tables,
    ...expectedFeature004Tables,
  ];

  it('define exactamente las 11 tablas canónicas de Etapa 1 tanto en migrations/{001,003}*.sql como en etapa-1-identidad-pip-auditoria.dbml', () => {
    expect(Object.keys(ddlTablesEtapa1).sort()).toEqual([...expectedEtapa1Tables].sort());
    expect(Object.keys(dbmlTablesEtapa1).sort()).toEqual([...expectedEtapa1Tables].sort());
  });

  it('mantiene paridad 1:1 campo por campo entre migrations/{001,003}*.sql y etapa-1-identidad-pip-auditoria.dbml', () => {
    for (const table of expectedEtapa1Tables) {
      const sqlCols = Array.from(ddlTablesEtapa1[table] ?? []).sort();
      const dbmlCols = Array.from(dbmlTablesEtapa1[table] ?? []).sort();
      expect({ table, columns: dbmlCols }).toEqual({ table, columns: sqlCols });
    }
  });

  it('mantiene paridad 1:1 campo por campo entre migrations/{004,005}*.sql y los esquemas DBML de Etapa 2, Etapa 3 y 00-esquema-maestro-completo.dbml (T047, T048)', () => {
    expect(Object.keys(ddlTables004).sort()).toEqual([...expectedFeature003Tables].sort());
    expect(Object.keys(ddlTables005).sort()).toEqual(
      ['aplicacion', ...expectedFeature004Tables].sort(),
    );

    expect(Array.from(ddlTablesFull['aplicacion'] ?? []).sort()).toEqual(
      Array.from(dbmlTablesEtapa2['aplicacion'] ?? []).sort(),
    );

    for (const table of ['cliente_oidc', 'cliente_oidc_redirect_uri', 'llave_jwks_rotacion', 'credencial_m2m']) {
      const sqlCols = Array.from(ddlTablesFull[table] ?? []).sort();
      const dbmlCols = Array.from(dbmlTablesEtapa3[table] ?? []).sort();
      expect({ table, columns: dbmlCols }).toEqual({ table, columns: sqlCols });
    }

    for (const table of expectedAllImplementedTables) {
      const expectedCols = Array.from(ddlTablesFull[table] ?? []).sort();
      const masterCols = Array.from(dbmlTablesMaestro[table] ?? []).sort();
      expect({ table, columns: masterCols }).toEqual({ table, columns: expectedCols });
    }

    const etapa2OwnTables = [
      'aplicacion',
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
      'redis_l2_pdp_app_bundle',
      'redis_l2_pdp_authz_decision',
    ];
    for (const table of etapa2OwnTables) {
      const etapa2Cols = Array.from(dbmlTablesEtapa2[table] ?? []).sort();
      const masterCols = Array.from(dbmlTablesMaestro[table] ?? []).sort();
      expect({ table, columns: masterCols }).toEqual({
        table,
        columns: etapa2Cols,
      });
    }

    const etapa3OwnTables = [
      'cliente_oidc',
      'cliente_oidc_redirect_uri',
      'credencial_m2m',
      'llave_jwks_rotacion',
      'despliegue_infraestructura',
      'redis_l2_oidc_session',
      'redis_l2_oidc_grant_code',
    ];
    for (const table of etapa3OwnTables) {
      const etapa3Cols = Array.from(dbmlTablesEtapa3[table] ?? []).sort();
      const masterCols = Array.from(dbmlTablesMaestro[table] ?? []).sort();
      expect({ table, columns: masterCols }).toEqual({
        table,
        columns: etapa3Cols,
      });
    }
  });

  it('verifica que todas las columnas usadas en INSERT INTO de 002_seed_minedec_catalogs.sql, 004_sso_oidc_broker_schema.sql y 005_motor_pdp_authorization_schema.sql existen en el DDL', () => {
    const seedInserts = [
      ...extractInsertStatements(seedSql),
      ...extractInsertStatements(ddlSql004),
      ...extractInsertStatements(ddlSql005),
    ];
    expect(seedInserts.length).toBeGreaterThanOrEqual(4);
    for (const stmt of seedInserts) {
      const tableCols = ddlTablesFull[stmt.table];
      expect(tableCols).toBeDefined();
      for (const col of stmt.columns) {
        expect(tableCols?.has(col)).toBe(true);
      }
    }
  });

  it('verifica que todas las sentencias INSERT INTO en los repositorios PostgreSQL y AuditEventWriter coinciden con las columnas del DDL', () => {
    const repoFiles = [
      'microservicios/pip-identity-service/src/infrastructure/persistence/pg-identity.repository.ts',
      'microservicios/pip-identity-service/src/infrastructure/persistence/pg-catalog.repository.ts',
      'microservicios/pip-identity-service/src/infrastructure/persistence/pg-context-assignment.repository.ts',
      'microservicios/pip-identity-service/src/infrastructure/persistence/pg-anomaly.repository.ts',
      'microservicios/sincronizador/src/infrastructure/persistence/alloydb-sync-state.repository.ts',
      'microservicios/sincronizador/src/infrastructure/persistence/alloydb-sync-identity.repository.ts',
      'microservicios/sso-oidc/src/infrastructure/crypto/alloydb-secretmanager-jwks.adapter.ts',
      'microservicios/motor-pdp/src/infrastructure/database/repositories/alloydb-pdp-jwks-key.repository.ts',
      'microservicios/shared/src/audit/audit-event-writer.ts',
    ];

    for (const file of repoFiles) {
      const content = readWorkspaceFile(file);
      const inserts = extractInsertStatements(content);
      expect(inserts.length).toBeGreaterThan(0);

      for (const stmt of inserts) {
        const tableCols = ddlTablesFull[stmt.table];
        expect(tableCols).toBeDefined();
        for (const col of stmt.columns) {
          expect({
            file,
            table: stmt.table,
            column: col,
            existsInDdl: tableCols?.has(col),
          }).toEqual({
            file,
            table: stmt.table,
            column: col,
            existsInDdl: true,
          });
        }
      }
    }
  });

  it('incluye todas las tablas y columnas del DDL acumulado (001..005) dentro de la lista blanca ALLOWED_PIP_SQL_IDENTIFIERS', () => {
    const allowedSet = new Set<string>(ALLOWED_PIP_SQL_IDENTIFIERS);
    for (const table of expectedAllImplementedTables) {
      expect(allowedSet.has(table)).toBe(true);
      for (const col of ddlTablesFull[table] ?? []) {
        expect({ table, col, inAllowlist: allowedSet.has(col) }).toEqual({
          table,
          col,
          inAllowlist: true,
        });
      }
    }
  });

  it('garantiza los invariantes de defensa en profundidad en AlloyDB (triggers de inmutabilidad, índices funcionales LOWER, segregación JWKS por servicio_emisor y bloqueo consultivo SHA-256)', () => {
    expect(ddlSqlFull).toContain('CREATE TRIGGER trg_enforce_cedula_immutability');
    expect(ddlSqlFull).toContain('CREATE TRIGGER trg_enforce_auditoria_append_only');
    expect(ddlSqlFull).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_dominio_lower');
    expect(ddlSqlFull).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_email_lower');
    expect(ddlSql004).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_llave_jwks_activa_por_emisor');
    expect(ddlSql004).toContain("CHECK (servicio_emisor IN ('SSO_OIDC', 'MOTOR_PDP'))");

    const auditWriterSource = readWorkspaceFile('microservicios/shared/src/audit/audit-event-writer.ts');
    expect(auditWriterSource).toContain('pg_advisory_xact_lock');

    expect(dataModelMd).toContain('trg_enforce_cedula_immutability');
    expect(dataModelMd).toContain('trg_enforce_auditoria_append_only');
    expect(dataModelMd).toContain('pg_advisory_xact_lock');
  });
});
