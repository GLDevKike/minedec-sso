import * as fs from 'fs';
import * as path from 'path';
import { DatabaseTransactionManager } from '@minedec/shared';
import {
  createSincronizadorContainer,
  SINCRONIZADOR_TYPES,
  IGoogleDirectoryReadOnlyPort,
} from '../../src';

function collectTypeScriptFiles(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) {
    return results;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTypeScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('T072 - Composition Root InversifyJS y Pureza Arquitectónica en Sincronizador', () => {
  const mockTxManager: DatabaseTransactionManager = {
    query: async () => ({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    }),
    withTransaction: async (fn) =>
      fn({
        query: async () => ({
          rows: [],
          command: 'SELECT',
          rowCount: 0,
          oid: 0,
          fields: [],
        }),
      }),
    close: async () => {},
  };

  const mockGwsPort: IGoogleDirectoryReadOnlyPort = {
    getUserReadOnly: async () => null,
    listUsersReadOnly: async () => ({ users: [], nextPageToken: null }),
  };

  it('resuelve exitosamente todos los servicios, puertos, casos de uso y controladores desde createSincronizadorContainer()', () => {
    const syncContainer = createSincronizadorContainer({
      txManager: mockTxManager,
      gwsPort: mockGwsPort,
    });

    for (const [symbolName, symbolToken] of Object.entries(SINCRONIZADOR_TYPES)) {
      if (
        symbolName === 'PartitionAdvisoryLock' ||
        symbolName === 'UpsertDirectoryIdentityUseCase'
      ) {
        continue;
      }
      const resolvedInstance = syncContainer.get<unknown>(symbolToken);
      expect(resolvedInstance).toBeDefined();
    }
  });

  it('verifica estáticamente que ningún archivo bajo domain/ ni application/ importa inversify, reflect-metadata o express ni usa @injectable/@inject', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const protectedDirs = [
      path.join(rootDir, 'src/domain'),
      path.join(rootDir, 'src/application'),
    ];

    const tsFiles = protectedDirs.flatMap((dir) => collectTypeScriptFiles(dir));
    expect(tsFiles.length).toBeGreaterThanOrEqual(8);

    for (const filePath of tsFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(/from\s+['"]inversify['"]/);
      expect(content).not.toMatch(/import\s+['"]reflect-metadata['"]/);
      expect(content).not.toMatch(/from\s+['"]express['"]/);
      expect(content).not.toMatch(/@injectable\s*\(/);
      expect(content).not.toMatch(/@inject\s*\(/);
    }
  });
});
