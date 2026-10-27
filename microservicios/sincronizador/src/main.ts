import { getLogger } from '@minedec/shared';
import { createSincronizadorContainer } from './container';
import { createSincronizadorHttpApp } from './infrastructure/http/app';

export async function startSincronizadorServer(
  port = Number(process.env.PORT ?? 8080),
  host = '0.0.0.0',
) {
  const logger = getLogger();
  const container = createSincronizadorContainer();
  const app = createSincronizadorHttpApp(container);

  const server = app.listen(port, host, () => {
    logger.info({ port, host, service: 'sincronizador' }, 'Sincronizador de Identidades iniciado');
  });

  return { app, server };
}

if (require.main === module) {
  void startSincronizadorServer();
}
