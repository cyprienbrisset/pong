import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  FX_GROW,
  FX_SHIELD,
  MSG,
  createWorld,
  decodeInput,
  decodePong,
  decodeSnapshot,
  encodeInput,
  encodePong,
  encodeSnapshot,
  messageType,
  stepWorld,
} from '../src/index.js';

describe('entrées', () => {
  it('conserve la séquence et le tick', () => {
    const d = decodeInput(encodeInput(65535, 0, 123456));
    expect(d.seq).toBe(65535);
    expect(d.clientTick).toBe(123456);
  });

  it('quantifie l\'axe à moins de 1 %', () => {
    for (const axis of [-1, -0.5, 0, 0.25, 0.99, 1]) {
      expect(decodeInput(encodeInput(1, axis, 0)).axis).toBeCloseTo(axis, 2);
    }
  });

  it('borne les axes hors limites', () => {
    expect(decodeInput(encodeInput(1, 5, 0)).axis).toBeCloseTo(1, 5);
    expect(decodeInput(encodeInput(1, -5, 0)).axis).toBeCloseTo(-1, 5);
  });

  it('annonce le bon type de message', () => {
    expect(messageType(encodeInput(1, 0, 0))).toBe(MSG.INPUT);
  });
});

describe('ping', () => {
  it('renvoie les horodatages intacts', () => {
    const now = Date.now();
    const d = decodePong(encodePong(now, now + 3, 900));
    expect(d.clientTimeMs).toBe(now);
    expect(d.serverTimeMs).toBe(now + 3);
    expect(d.tick).toBe(900);
  });
});

describe('snapshot', () => {
  const world = () => {
    const w = createWorld({ ...DEFAULT_CONFIG, arena: 'bumpers' }, 4242);
    for (let i = 0; i < 400; i++) {
      stepWorld(w, [0.5, -0.5]);
      w.events.length = 0;
    }
    return w;
  };

  it('reconstruit un état fidèle à un huitième d\'unité', () => {
    const w = world();
    const snap = decodeSnapshot(encodeSnapshot(w, 77, 123_456));
    expect(snap.tick).toBe(w.tick);
    expect(snap.ackSeq).toBe(77);
    expect(snap.serverMs).toBe(123_456);
    expect(snap.status).toBe(w.status);
    expect(snap.scores).toEqual(w.scores);
    expect(snap.balls.length).toBe(w.balls.length);
    snap.balls.forEach((b, i) => {
      expect(b.x).toBeCloseTo(w.balls[i].x, 0);
      expect(b.y).toBeCloseTo(w.balls[i].y, 0);
      expect(b.vx).toBeCloseTo(w.balls[i].vx, -1);
    });
    snap.paddles.forEach((p, i) => {
      expect(p.y).toBeCloseTo(w.paddles[i].y, 0);
      expect(p.h).toBeCloseTo(w.paddles[i].h, 0);
    });
  });

  it('transporte les drapeaux d\'effet', () => {
    const w = world();
    w.paddles[0].fx.grow = 5;
    w.paddles[0].shield = true;
    const snap = decodeSnapshot(encodeSnapshot(w, 0, 0));
    expect(snap.paddles[0].flags & FX_GROW).toBeTruthy();
    expect(snap.paddles[0].flags & FX_SHIELD).toBeTruthy();
    expect(snap.paddles[1].flags).toBe(0);
  });

  it('reste sous les 40 octets en configuration nominale', () => {
    const w = world();
    expect(encodeSnapshot(w, 0, 0).byteLength).toBeLessThanOrEqual(40);
  });

  it('supporte plusieurs balles et bonus simultanés', () => {
    const w = world();
    w.balls.push({ ...w.balls[0], id: 99 }, { ...w.balls[0], id: 100 });
    w.powerups.push({ id: 1, type: 'turbo', x: 500, y: 200 });
    const snap = decodeSnapshot(encodeSnapshot(w, 0, 0));
    expect(snap.balls.length).toBe(3);
    expect(snap.powerups[0].type).toBe('turbo');
    expect(snap.powerups[0].x).toBeCloseTo(500, 1);
  });
});
