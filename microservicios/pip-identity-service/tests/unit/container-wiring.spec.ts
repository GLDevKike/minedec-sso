import * as fs from 'fs';
import * as path from 'path';
import { DatabaseTransactionManager } from '@minedec/shared';
import { createPipContainer, PIP_TYPES } from '../../src/container';
import { HotRegistrationUseCase } from '../../src/application/use-cases/hot-registration.use-case';
import { UpsertDirectoryIdentityUseCase } from '../../src/application/upsert-directory-identity.usecase';
import { ManageCatalogsUseCase } from '../../src/application/manage-catalogs.usecase';
import { ManageMultisedeContextUseCase } from '../../src/application/manage-multisede-context.usecase';
import { ResolveIdentityUseCase } from '../../src/application/resolve-identity.usecase';
import { ManageAnomaliesUseCase } from '../../src/application/manage-anomalies.usecase';

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

describe('T048 - Arquitectura Hexagonal y Cableado de InversifyJS en Composition Root (pip-identity-service)', () => {
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

  it('resuelve exitosamente todos los servicios de dominio, puertos, casos de uso y controladores desde createPipContainer()', () => {
    const container = createPipContainer({
      sqlExecutor: mockTxManager,
    });

    for (const [symbolName, symbolToken] of Object.entries(PIP_TYPES)) {
      const resolvedInstance = container.get<unknown>(symbolToken);
      expect(resolvedInstance).toBeDefined();
      expect(symbolName.length).toBeGreaterThan(0);
    }

    expect(
      container.get<UpsertDirectoryIdentityUseCase>(PIP_TYPES.UpsertDirectoryIdentityUseCase),
    ).toBeInstanceOf(UpsertDirectoryIdentityUseCase);
    expect(
      container.get<ManageCatalogsUseCase>(PIP_TYPES.ManageCatalogsUseCase),
    ).toBeInstanceOf(ManageCatalogsUseCase);
    expect(
      container.get<ManageMultisedeContextUseCase>(PIP_TYPES.ManageMultisedeContextUseCase),
    ).toBeInstanceOf(ManageMultisedeContextUseCase);
    expect(
      container.get<ResolveIdentityUseCase>(PIP_TYPES.ResolveIdentityUseCase),
    ).toBeInstanceOf(ResolveIdentityUseCase);
    expect(
      container.get<ManageAnomaliesUseCase>(PIP_TYPES.ManageAnomaliesUseCase),
    ).toBeInstanceOf(ManageAnomaliesUseCase);
    expect(
      container.get<HotRegistrationUseCase>(PIP_TYPES.HotRegistrationUseCase),
    ).toBeInstanceOf(HotRegistrationUseCase);
  });

  it('verifica estáticamente que ningún archivo bajo domain/ ni application/ importa inversify, reflect-metadata o express ni usa @injectable/@inject', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const protectedDirs = [
      path.join(rootDir, 'src/domain'),
      path.join(rootDir, 'src/application'),
    ];

    const tsFiles = protectedDirs.flatMap((dir) => collectTypeScriptFiles(dir));
    expect(tsFiles.length).toBeGreaterThanOrEqual(5);

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
