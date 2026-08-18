/**
 * Configuration par variables d'environnement. Tout est validé au démarrage :
 * un déploiement Coolify mal paramétré doit échouer immédiatement et bruyamment,
 * pas se dégrader silencieusement en production.
 */

function int(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} doit être un entier entre ${min} et ${max} (reçu : ${raw})`);
  }
  return n;
}

function str(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? def : raw;
}

function bool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  return ['1', 'true', 'yes', 'oui'].includes(raw.toLowerCase());
}

export const config = {
  env: str('NODE_ENV', 'development'),
  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 3000, 1, 65535),

  /** Répertoire des fichiers statiques du client (build Vite). */
  publicDir: str('PUBLIC_DIR', new URL('../../client/dist', import.meta.url).pathname),

  /** Chemin de la base SQLite. Sur Coolify, pointer vers un volume persistant. */
  dbPath: str('DB_PATH', './data/neon-pong.db'),

  /** Nombre maximal de salles simultanées : garde-fou mémoire. */
  maxRooms: int('MAX_ROOMS', 64, 1, 1000),
  /** Une salle vide est détruite après ce délai. */
  roomIdleMs: int('ROOM_IDLE_MS', 60_000, 5_000, 3_600_000),

  /** Limitation de débit par connexion, en messages par seconde. */
  rateLimitMsgPerSec: int('RATE_LIMIT_MSG_PER_SEC', 180, 30, 2000),

  /** Origines autorisées à ouvrir la WebSocket. Vide = tout accepter (dev). */
  allowedOrigins: str('ALLOWED_ORIGINS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  logLevel: str('LOG_LEVEL', 'info'),
  /** Journalise les IP. Coupé par défaut : rien d'utile, et c'est une donnée personnelle. */
  logIps: bool('LOG_IPS', false),
} as const;

export type Config = typeof config;
