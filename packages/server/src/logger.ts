import pino from 'pino';
import { config } from './config.js';

/**
 * Journalisation structurée. En développement, sortie lisible ; en production,
 * du JSON ligne par ligne que Coolify agrège tel quel.
 */
export const logger = pino({
  level: config.logLevel,
  base: undefined,
  redact: config.logIps ? [] : ['ip', 'remoteAddress', 'req.headers["x-forwarded-for"]'],
  transport:
    config.env === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
