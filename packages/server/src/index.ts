import { config } from './config.js';
import { Store } from './db.js';
import { Hub } from './hub.js';
import { createHttpServer } from './http.js';
import { logger } from './logger.js';
import { attachWebSocket } from './ws.js';

const store = new Store();
const hub = new Hub(store);
const server = createHttpServer(store, () => hub);
const wss = attachWebSocket(server, hub);

server.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port, env: config.env, publicDir: config.publicDir },
    'Neon Pong en écoute',
  );
});

/**
 * Arrêt propre : Coolify envoie SIGTERM lors d'un redéploiement. On ferme les
 * sockets, on arrête les boucles, puis on ferme la base — dans cet ordre, sinon
 * un tick en cours peut écrire dans une base déjà fermée.
 */
let closing = false;
function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'arrêt demandé');

  const timeout = setTimeout(() => {
    logger.warn('arrêt forcé après 10 s');
    process.exit(1);
  }, 10_000);
  timeout.unref();

  hub.shutdown();
  wss.close();
  server.close(() => {
    store.close();
    logger.info('arrêt terminé');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'promesse rejetée non gérée');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'exception non interceptée');
  shutdown('uncaughtException');
});
