import * as C from './constants.js';
import { powerFromIndex, powerIndex } from './powerups.js';
import { paddleX } from './sim.js';
import type { MatchConfig, Side, Status, World } from './types.js';

/**
 * Deux canaux sur la même socket :
 *
 *  - les messages fréquents (entrées à 60 Hz, snapshots à 30 Hz, ping) sont
 *    binaires : un ArrayBuffer compact, sans allocation d'objet côté réception ;
 *  - les messages rares (rejoindre une salle, réglages, fin de match) sont en
 *    JSON, où la lisibilité vaut plus que les octets économisés.
 *
 * Le premier octet est toujours le type de message.
 */

export const MSG = {
  // client -> serveur
  INPUT: 1,
  PING: 2,
  // serveur -> client
  SNAPSHOT: 10,
  PONG: 11,
} as const;

/** Positions et tailles : 1/8 d'unité monde suffit largement à l'œil. */
const POS_SCALE = 8;
/** Vitesses : 1/4 d'unité par seconde, pour l'extrapolation côté client. */
const VEL_SCALE = 4;

const STATUS_CODES: Status[] = ['countdown', 'play', 'point', 'over'];

export const FX_GROW = 1 << 0;
export const FX_SHRINK = 1 << 1;
export const FX_INVERT = 1 << 2;
export const FX_SHIELD = 1 << 3;

/* ------------------------------------------------------------------ */
/* Entrées client -> serveur                                          */
/* ------------------------------------------------------------------ */

/** 8 octets : type, axe, séquence, tick client. */
export function encodeInput(seq: number, axis: number, clientTick: number): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  const v = new DataView(buf);
  v.setUint8(0, MSG.INPUT);
  v.setInt8(1, Math.round(clamp(axis, -1, 1) * 127));
  v.setUint16(2, seq & 0xffff);
  v.setUint32(4, clientTick >>> 0);
  return buf;
}

export function decodeInput(buf: ArrayBuffer): { seq: number; axis: number; clientTick: number } {
  const v = new DataView(buf);
  return {
    axis: v.getInt8(1) / 127,
    seq: v.getUint16(2),
    clientTick: v.getUint32(4),
  };
}

/**
 * Comparaison de séquences 16 bits tolérante au repli. Partagée entre le
 * serveur (ordonnancement des entrées reçues) et le client (purge des entrées
 * acquittées lors de la réconciliation) : les deux doivent s'accorder sur ce
 * qu'« être plus récent » signifie autour du repli à 65536.
 */
export function isNewer(seq: number, current: number): boolean {
  return ((seq - current) & 0xffff) < 0x8000;
}

/** Ping : l'horodatage client est renvoyé tel quel pour mesurer l'aller-retour. */
export function encodePing(clientTimeMs: number): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf);
  v.setUint8(0, MSG.PING);
  v.setFloat64(8, clientTimeMs);
  return buf;
}

export function encodePong(clientTimeMs: number, serverTimeMs: number, tick: number): ArrayBuffer {
  const buf = new ArrayBuffer(24);
  const v = new DataView(buf);
  v.setUint8(0, MSG.PONG);
  v.setUint32(4, tick >>> 0);
  v.setFloat64(8, clientTimeMs);
  v.setFloat64(16, serverTimeMs);
  return buf;
}

export function decodePong(buf: ArrayBuffer) {
  const v = new DataView(buf);
  return {
    tick: v.getUint32(4),
    clientTimeMs: v.getFloat64(8),
    serverTimeMs: v.getFloat64(16),
  };
}

/* ------------------------------------------------------------------ */
/* Snapshot serveur -> client                                         */
/* ------------------------------------------------------------------ */

export interface Snapshot {
  tick: number;
  /** Horloge monotone du serveur, en ms depuis son démarrage. */
  serverMs: number;
  /** Dernière séquence d'entrée prise en compte, pour la réconciliation. */
  ackSeq: number;
  status: Status;
  timer: number;
  scores: [number, number];
  rally: number;
  paddles: { y: number; h: number; flags: number }[];
  balls: { x: number; y: number; vx: number; vy: number; spin: number; last: Side }[];
  powerups: { x: number; y: number; type: ReturnType<typeof powerFromIndex> }[];
}

function paddleFlags(p: World['paddles'][number]): number {
  return (
    (p.fx.grow > 0 ? FX_GROW : 0) |
    (p.fx.shrink > 0 ? FX_SHRINK : 0) |
    (p.fx.invert > 0 ? FX_INVERT : 0) |
    (p.shield ? FX_SHIELD : 0)
  );
}

/** Taille de l'en-tête, en octets. Doit correspondre exactement aux écritures. */
export const SNAPSHOT_HEADER = 18;
const PADDLE_BYTES = 6;
const BALL_BYTES = 9;
const POWER_BYTES = 5;

/**
 * En-tête 18 octets, puis 6 octets par raquette, 9 par balle, 5 par bonus.
 * Une partie classique tient donc en 39 octets : à 30 Hz, cela représente
 * environ 1,2 Ko/s par joueur, en-têtes WebSocket compris.
 */
export function encodeSnapshot(w: World, ackSeq: number, serverMs: number): ArrayBuffer {
  const size =
    SNAPSHOT_HEADER +
    2 * PADDLE_BYTES +
    w.balls.length * BALL_BYTES +
    w.powerups.length * POWER_BYTES;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;

  v.setUint8(o, MSG.SNAPSHOT); o += 1;
  v.setUint8(o, STATUS_CODES.indexOf(w.status)); o += 1;
  v.setUint8(o, Math.min(255, w.scores[0])); o += 1;
  v.setUint8(o, Math.min(255, w.scores[1])); o += 1;
  v.setUint8(o, Math.min(255, w.rally)); o += 1;
  v.setUint8(o, Math.round(clamp(w.timer, 0, 25.5) * 10)); o += 1;
  v.setUint8(o, w.balls.length); o += 1;
  v.setUint8(o, w.powerups.length); o += 1;
  v.setUint16(o, ackSeq & 0xffff); o += 2;
  v.setUint32(o, w.tick >>> 0); o += 4;
  v.setUint32(o, serverMs >>> 0); o += 4;

  for (const p of w.paddles) {
    v.setInt16(o, Math.round(p.y * POS_SCALE)); o += 2;
    v.setUint16(o, Math.round(p.h * POS_SCALE)); o += 2;
    v.setUint8(o, paddleFlags(p)); o += 1;
    v.setUint8(o, 0); o += 1; // réservé (alignement + extension future)
  }

  for (const b of w.balls) {
    v.setInt16(o, Math.round(b.x * POS_SCALE)); o += 2;
    v.setInt16(o, Math.round(b.y * POS_SCALE)); o += 2;
    v.setInt16(o, Math.round(clamp(b.vx, -8000, 8000) / VEL_SCALE)); o += 2;
    v.setInt16(o, Math.round(clamp(b.vy, -8000, 8000) / VEL_SCALE)); o += 2;
    v.setInt8(o, Math.round(clamp(b.spin, -1.6, 1.6) * 78)); o += 1;
  }

  for (const pu of w.powerups) {
    v.setInt16(o, Math.round(pu.x * POS_SCALE)); o += 2;
    v.setInt16(o, Math.round(pu.y * POS_SCALE)); o += 2;
    v.setUint8(o, powerIndex(pu.type)); o += 1;
  }

  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot {
  const v = new DataView(buf);
  let o = 1;
  const status = STATUS_CODES[v.getUint8(o)] ?? 'play'; o += 1;
  const s0 = v.getUint8(o); o += 1;
  const s1 = v.getUint8(o); o += 1;
  const rally = v.getUint8(o); o += 1;
  const timer = v.getUint8(o) / 10; o += 1;
  const ballCount = v.getUint8(o); o += 1;
  const powerCount = v.getUint8(o); o += 1;
  const ackSeq = v.getUint16(o); o += 2;
  const tick = v.getUint32(o); o += 4;
  const serverMs = v.getUint32(o); o += 4;

  const paddles: Snapshot['paddles'] = [];
  for (let i = 0; i < 2; i++) {
    const y = v.getInt16(o) / POS_SCALE; o += 2;
    const h = v.getUint16(o) / POS_SCALE; o += 2;
    const flags = v.getUint8(o); o += 1;
    o += 1;
    paddles.push({ y, h, flags });
  }

  const balls: Snapshot['balls'] = [];
  for (let i = 0; i < ballCount; i++) {
    const x = v.getInt16(o) / POS_SCALE; o += 2;
    const y = v.getInt16(o) / POS_SCALE; o += 2;
    const vx = v.getInt16(o) * VEL_SCALE; o += 2;
    const vy = v.getInt16(o) * VEL_SCALE; o += 2;
    const spin = v.getInt8(o) / 78; o += 1;
    // `last` n'est pas transmis : la direction en donne une approximation
    // suffisante pour la couleur de la traînée.
    balls.push({ x, y, vx, vy, spin, last: vx >= 0 ? 0 : 1 });
  }

  const powerups: Snapshot['powerups'] = [];
  for (let i = 0; i < powerCount; i++) {
    const x = v.getInt16(o) / POS_SCALE; o += 2;
    const y = v.getInt16(o) / POS_SCALE; o += 2;
    powerups.push({ x, y, type: powerFromIndex(v.getUint8(o)) }); o += 1;
  }

  return {
    tick,
    serverMs,
    ackSeq,
    status,
    timer,
    scores: [s0, s1],
    rally,
    paddles,
    balls,
    powerups,
  };
}

/* ------------------------------------------------------------------ */
/* Messages de contrôle (JSON)                                        */
/* ------------------------------------------------------------------ */

export type ClientControl =
  | { t: 'join'; name: string; code?: string; config?: Partial<MatchConfig> }
  | { t: 'config'; config: Partial<MatchConfig> }
  | { t: 'rematch' }
  | { t: 'leave' };

export interface RoomView {
  code: string;
  config: MatchConfig;
  hostId: string;
  seats: { side: Side; id: string; name: string; bot: boolean; connected: boolean; rttMs: number }[];
  spectators: number;
}

export type ErrorCode = 'room_full' | 'room_missing' | 'bad_name' | 'rate_limited';

export type ServerControl =
  | { t: 'welcome'; playerId: string; side: Side | null; room: RoomView; tickHz: number }
  | { t: 'room'; room: RoomView }
  | { t: 'event'; events: import('./types.js').GameEvent[] }
  | { t: 'over'; winner: Side; scores: [number, number]; bestRally: number; names: [string, string] }
  | { t: 'error'; code: ErrorCode; message: string };

export function isBinary(data: unknown): data is ArrayBuffer {
  return data instanceof ArrayBuffer;
}

export function messageType(buf: ArrayBuffer): number {
  return new DataView(buf).getUint8(0);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export { paddleX, C as constants };
