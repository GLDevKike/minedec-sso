import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '**/dist/**',
      'build/**',
      'coverage/**',
      '**/*.min.js',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Regla Constitucional (Principios III, V y VI):
    // Prohibición estricta de importar inversify o reflect-metadata en domain/ y application/
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'inversify',
              message:
                'PROHIBIDO por Constitución MINEDEC v2.11.0 (Principios III y VI): InversifyJS solo puede importarse en el Composition Root (container.ts). Las capas domain/ y application/ deben permanecer 100% libres de decoradores o acoplamiento al contenedor IoC.',
            },
            {
              name: 'reflect-metadata',
              message:
                'PROHIBIDO por Constitución MINEDEC v2.11.0: reflect-metadata solo puede importarse en el Composition Root (container.ts / index.ts).',
            },
            {
              name: 'express',
              message:
                'PROHIBIDO por Arquitectura Hexagonal: Las capas domain/ y application/ no pueden acoplarse a Express HTTP.',
            },
            {
              name: '@google-cloud/secret-manager',
              message:
                'PROHIBIDO por Arquitectura Hexagonal: Los SDKs de GCP solo pueden importarse en adaptadores de infrastructure/.',
            },
            {
              name: '@google-cloud/pubsub',
              message:
                'PROHIBIDO por Arquitectura Hexagonal: Los SDKs de GCP solo pueden importarse en adaptadores de infrastructure/.',
            },
            {
              name: '@google-cloud/tasks',
              message:
                'PROHIBIDO por Arquitectura Hexagonal: Los SDKs de GCP solo pueden importarse en adaptadores de infrastructure/.',
            },
          ],
        },
      ],
    },
  },
);
