/**
 * Punto de Entrada del Servidor HTTP — Motor de Autorización Central (`motor-pdp`) (`T016`).
 */

import { StructuredLogger } from '@minedec/shared';
import { createMotorPdpApp } from './app';
import { createMotorPdpContainer } from './container';
import { MotorPdpEnvConfig } from './infrastructure/http/schemas/pdp-zod.schemas';
import { TYPES } from './types';

export async function bootstrapMotorPdpServer(): Promise<void> {
  const container = createMotorPdpContainer();
  const env = container.get<MotorPdpEnvConfig>(TYPES.EnvConfig);
  const logger = container.get<StructuredLogger>(TYPES.Logger);
  const app = createMotorPdpApp(container);

  const server = app.listen(env.PORT, () => {
    logger.info('Servicio motor-pdp iniciado en GKE Autopilot', {
      port: env.PORT,
      issuer: env.PDP_ISSUER_URL,
      nodeEnv: env.NODE_ENV,
    });
  });

  const shutdown = (signal: string): void => {
    logger.info(`Señal ${signal} recibida, cerrando motor-pdp de forma limpia`);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  bootstrapMotorPdpServer().catch((error: unknown) => {
    process.stderr.write(
      `Error fatal al iniciar motor-pdp: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
