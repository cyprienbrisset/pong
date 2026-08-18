import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { BUILTIN_THEMES, parseTheme } from '@neon-pong/shared';
import { config } from './config.js';
import type { Store } from './db.js';
import type { Hub } from './hub.js';
import { logger } from './logger.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/**
 * En-têtes de sécurité. Le jeu ne charge aucune ressource tierce, la CSP peut
 * donc être stricte : seule la même origine, plus la WebSocket.
 */
function securityHeaders(res: ServerResponse): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
}

function serveStatic(res: ServerResponse, urlPath: string): void {
  const root = resolve(config.publicDir);
  // Normalisation puis vérification du préfixe : la parade classique contre les
  // traversées de répertoire du type /../../etc/passwd.
  const requested = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(join(root, requested));

  if (!filePath.startsWith(root)) {
    json(res, 403, { error: 'accès refusé' });
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, 'index.html');
  }
  if (!existsSync(filePath)) {
    json(res, 404, { error: 'client non construit : lancez npm run build' });
    return;
  }

  const ext = extname(filePath);
  const isHashed = /-[A-Za-z0-9_]{8,}\./.test(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Les fichiers versionnés par Vite sont immuables ; index.html ne l'est jamais.
    'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

/** Corps JSON borné : au-delà, on coupe la connexion sans lire la suite. */
const MAX_BODY_BYTES = 16 * 1024;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('corps trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function cleanAuthor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\p{C}]/gu, '').trim().slice(0, 14);
  return name.length >= 1 ? name : null;
}

/**
 * Publication d'une charte. Tout ce qui arrive ici est hostile par défaut : la
 * charte passe par `parseTheme`, l'auteur est nettoyé comme un pseudonyme de
 * joueur, et le nombre total de chartes est plafonné pour qu'un script ne
 * remplisse pas le volume.
 */
async function handleThemePost(req: IncomingMessage, res: ServerResponse, store: Store) {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
    return;
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const author = cleanAuthor(payload.author);
  if (!author) {
    json(res, 400, { error: 'Indiquez le pseudonyme de l\'auteur.' });
    return;
  }

  const { theme, errors } = parseTheme(payload.theme);
  if (!theme) {
    json(res, 422, { error: 'Charte invalide.', details: errors });
    return;
  }

  if (store.themeAuthor(theme.id) === null && store.themeCount() >= 200) {
    json(res, 429, { error: 'Trop de chartes publiées sur ce serveur.' });
    return;
  }

  const outcome = store.saveTheme(theme, author);
  if (outcome === 'forbidden') {
    json(res, 403, { error: 'Cette charte appartient à un autre auteur. Changez d\'identifiant.' });
    return;
  }
  logger.info({ theme: theme.id, author, outcome }, 'charte publiée');
  json(res, outcome === 'created' ? 201 : 200, { status: outcome, theme });
}

export function createHttpServer(store: Store, hub: () => Hub) {
  const startedAt = Date.now();

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    securityHeaders(res);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/api/themes') {
      void handleThemePost(req, res, store);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'méthode non autorisée' });
      return;
    }

    switch (url.pathname) {
      case '/healthz':
        // Sonde utilisée par Coolify : volontairement sans accès disque.
        json(res, 200, { status: 'ok', uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
        return;

      case '/readyz': {
        try {
          store.leaderboard(1);
          json(res, 200, { status: 'ready' });
        } catch (err) {
          logger.error({ err }, 'base injoignable');
          json(res, 503, { status: 'degraded' });
        }
        return;
      }

      case '/metrics': {
        const h = hub();
        const mem = process.memoryUsage();
        const lines = [
          '# HELP neonpong_rooms Salles actives',
          '# TYPE neonpong_rooms gauge',
          `neonpong_rooms ${h.size}`,
          '# HELP neonpong_clients Clients connectés',
          '# TYPE neonpong_clients gauge',
          `neonpong_clients ${h.playerCount}`,
          '# HELP neonpong_heap_bytes Mémoire du tas',
          '# TYPE neonpong_heap_bytes gauge',
          `neonpong_heap_bytes ${mem.heapUsed}`,
        ].join('\n');
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
        res.end(`${lines}\n`);
        return;
      }

      case '/api/leaderboard': {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
        try {
          json(res, 200, { rows: store.leaderboard(limit) });
        } catch (err) {
          logger.error({ err }, 'lecture du classement impossible');
          json(res, 500, { error: 'classement indisponible' });
        }
        return;
      }

      case '/api/matches': {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
        json(res, 200, { rows: store.recentMatches(limit) });
        return;
      }

      case '/api/themes': {
        // Les chartes livrées voyagent avec la liste : le client n'a ainsi qu'une
        // seule source à consulter, et une charte livrée ne peut pas être
        // recouverte par une charte publiée (identifiants réservés).
        const shared = store.listThemes(100).map((row) => ({
          theme: row.theme,
          author: row.author,
          updatedAt: row.updatedAt,
        }));
        json(res, 200, { builtin: BUILTIN_THEMES, shared });
        return;
      }

      case '/api/rooms':
        json(res, 200, { rooms: hub().openRooms() });
        return;

      default:
        serveStatic(res, url.pathname);
    }
  });
}
