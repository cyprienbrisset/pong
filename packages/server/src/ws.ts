import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CLIENT_TIMEOUT_MS,
  HEARTBEAT_MS,
  MSG,
  TICK_HZ,
  decodeInput,
  encodePong,
  messageType,
} from '@neon-pong/shared';
import type { ClientControl, ErrorCode, ServerControl } from '@neon-pong/shared';
import { config } from './config.js';
import type { Hub } from './hub.js';
import { logger } from './logger.js';
import type { Client } from './room.js';
import { sanitizeConfig } from './room.js';

/** Limite de débit à seau percé : une rafale est tolérée, un flot continu non. */
class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private rate: number, private burst: number) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Un pseudonyme est du texte affiché à d'autres : il est nettoyé sans pitié. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .normalize('NFC')
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')
    .trim()
    .slice(0, 14);
  return name.length >= 1 ? name : null;
}

function originAllowed(req: IncomingMessage): boolean {
  if (config.allowedOrigins.length === 0) return true;
  const origin = req.headers.origin;
  return typeof origin === 'string' && config.allowedOrigins.includes(origin);
}

export function attachWebSocket(server: Server, hub: Hub): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    if (!originAllowed(req)) {
      logger.warn({ origin: req.headers.origin }, 'origine WebSocket refusée');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.binaryType = 'arraybuffer';
    const id = randomUUID();
    const bucket = new Bucket(config.rateLimitMsgPerSec, config.rateLimitMsgPerSec);
    let lastSeen = Date.now();
    let roomCode: string | null = null;

    const client: Client = {
      id,
      name: 'Invité',
      side: null,
      axis: 0,
      ackSeq: 0,
      rttMs: 0,
      connected: true,
      sendBinary(data) {
        if (ws.readyState === ws.OPEN) ws.send(data, { binary: true });
      },
      sendJson(msg) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close() {
        try {
          ws.close(1000, 'salle fermée');
        } catch {
          /* socket déjà morte */
        }
      },
    };

    const fail = (code: ErrorCode, message: string) => {
      client.sendJson({ t: 'error', code, message });
    };

    ws.on('message', (raw: Buffer | ArrayBuffer, isBinary: boolean) => {
      lastSeen = Date.now();
      if (!bucket.take()) {
        logger.warn({ client: id }, 'débit dépassé, connexion fermée');
        client.sendJson({ t: 'error', code: 'rate_limited', message: 'Trop de messages.' });
        ws.close(1008, 'rate limited');
        return;
      }

      if (isBinary) {
        const buf = toArrayBuffer(raw);
        if (buf.byteLength < 2) return;
        switch (messageType(buf)) {
          case MSG.INPUT: {
            const { axis, seq } = decodeInput(buf);
            client.axis = Number.isFinite(axis) ? Math.max(-1, Math.min(1, axis)) : 0;
            // Les séquences peuvent arriver dans le désordre : on ne garde que
            // la plus récente, modulo le repli sur 16 bits.
            if (isNewer(seq, client.ackSeq)) client.ackSeq = seq;
            return;
          }
          case MSG.PING: {
            const v = new DataView(buf);
            const clientTime = v.getFloat64(8);
            client.sendBinary(encodePong(clientTime, Math.round(performance.now()), 0));
            return;
          }
          default:
            return;
        }
      }

      let msg: ClientControl;
      try {
        msg = JSON.parse(String(raw)) as ClientControl;
      } catch {
        return;
      }
      handleControl(msg);
    });

    function handleControl(msg: ClientControl): void {
      switch (msg?.t) {
        case 'join': {
          const name = cleanName(msg.name);
          if (!name) {
            fail('bad_name', 'Choisissez un pseudonyme de 1 à 14 caractères.');
            return;
          }
          client.name = name;

          const room = msg.code ? hub.get(msg.code) : hub.create(sanitizeConfig(msg.config ?? {}));
          if (!room) {
            fail(msg.code ? 'room_missing' : 'room_full', msg.code
              ? "Cette salle n'existe plus."
              : 'Le serveur est plein, réessayez dans un instant.');
            return;
          }
          const side = room.join(client);
          roomCode = room.code;
          client.sendJson({
            t: 'welcome',
            playerId: id,
            side,
            room: room.view(),
            tickHz: TICK_HZ,
          });
          return;
        }
        case 'config': {
          if (roomCode) hub.get(roomCode)?.updateConfig(id, msg.config ?? {});
          return;
        }
        case 'rematch': {
          if (roomCode) hub.get(roomCode)?.rematch(id);
          return;
        }
        case 'leave': {
          if (roomCode) hub.get(roomCode)?.leave(id);
          roomCode = null;
          return;
        }
      }
    }

    const heartbeat = setInterval(() => {
      if (Date.now() - lastSeen > CLIENT_TIMEOUT_MS) {
        logger.info({ client: id }, 'client silencieux, déconnexion');
        ws.terminate();
        return;
      }
      if (ws.readyState === ws.OPEN) ws.ping();
    }, HEARTBEAT_MS);

    ws.on('pong', () => {
      lastSeen = Date.now();
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      client.connected = false;
      if (roomCode) hub.get(roomCode)?.leave(id);
    });

    ws.on('error', (err) => {
      logger.debug({ err, client: id }, 'erreur de socket');
    });
  });

  return wss;
}

function toArrayBuffer(raw: Buffer | ArrayBuffer): ArrayBuffer {
  if (raw instanceof ArrayBuffer) return raw;
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

/** Comparaison de séquences 16 bits tolérante au repli. */
export function isNewer(seq: number, current: number): boolean {
  return ((seq - current) & 0xffff) < 0x8000;
}
