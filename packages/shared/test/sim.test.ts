import { describe, expect, it } from 'vitest';
import {
  BALL_SPEED_MAX,
  DEFAULT_CONFIG,
  FIELD_H,
  FIELD_W,
  PADDLE_SPEED,
  TICK_DT,
  createWorld,
  paddleX,
  predictPaddle,
  stepWorld,
} from '../src/index.js';
import type { MatchConfig, World } from '../src/types.js';

function run(w: World, ticks: number, axes: [number, number] = [0, 0]) {
  for (let i = 0; i < ticks; i++) {
    stepWorld(w, axes);
    w.events.length = 0;
  }
  return w;
}

const cfg = (over: Partial<MatchConfig> = {}): MatchConfig => ({ ...DEFAULT_CONFIG, ...over });

describe('déterminisme', () => {
  it('produit un état identique pour la même graine et les mêmes entrées', () => {
    const a = run(createWorld(cfg(), 12345), 600, [0.7, -0.4]);
    const b = run(createWorld(cfg(), 12345), 600, [0.7, -0.4]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('divergerait avec une graine différente', () => {
    const a = run(createWorld(cfg(), 1), 600, [0.7, -0.4]);
    const b = run(createWorld(cfg(), 2), 600, [0.7, -0.4]);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("n'utilise jamais Math.random", () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random appelé dans la simulation');
    };
    try {
      expect(() => run(createWorld(cfg({ arena: 'chaos' }), 999), 900, [1, -1])).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});

describe('invariants physiques', () => {
  it('garde toujours les balles dans le terrain en hauteur', () => {
    const w = createWorld(cfg({ arena: 'bumpers' }), 7);
    for (let i = 0; i < 3600; i++) {
      stepWorld(w, [Math.sin(i / 30), Math.cos(i / 25)]);
      w.events.length = 0;
      for (const b of w.balls) {
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThanOrEqual(FIELD_H);
      }
    }
  });

  it('ne dépasse jamais la vitesse maximale', () => {
    const w = createWorld(cfg({ arena: 'pilier', target: 99 }), 42);
    for (let i = 0; i < 7200; i++) {
      stepWorld(w, [0, 0]);
      w.events.length = 0;
      for (const b of w.balls) {
        expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(BALL_SPEED_MAX + 1);
      }
    }
  });

  it('maintient les raquettes dans le terrain', () => {
    const w = createWorld(cfg(), 3);
    run(w, 300, [-1, 1]);
    for (const p of w.paddles) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.h).toBeLessThanOrEqual(FIELD_H + 0.001);
    }
  });
});

describe('règles du jeu', () => {
  it('accorde le point au camp opposé quand la balle sort', () => {
    const w = createWorld(cfg(), 5);
    run(w, 120); // fin du décompte
    w.balls[0] = { ...w.balls[0], x: 40, y: FIELD_H / 2, vx: -900, vy: 0, spin: 0 };
    w.paddles[0].y = 0; // on dégage la raquette gauche
    run(w, 12);
    expect(w.scores[1]).toBe(1);
    expect(w.scores[0]).toBe(0);
  });

  it('termine la manche au score cible', () => {
    const w = createWorld(cfg({ target: 1 }), 5);
    run(w, 120);
    w.balls[0] = { ...w.balls[0], x: 40, y: 500, vx: -900, vy: 0, spin: 0 };
    w.paddles[0].y = 0;
    run(w, 12);
    expect(w.status).toBe('over');
  });

  it('le bouclier renvoie la balle une seule fois', () => {
    const w = createWorld(cfg(), 5);
    run(w, 120);
    w.paddles[0].shield = true;
    w.balls[0] = { ...w.balls[0], x: 40, y: 300, vx: -900, vy: 0, spin: 0 };
    w.paddles[0].y = 0;
    run(w, 6);
    expect(w.scores[1]).toBe(0);
    expect(w.paddles[0].shield).toBe(false);
    expect(w.balls[0].vx).toBeGreaterThan(0);
  });

  it('une frappe de raquette renvoie la balle et accélère', () => {
    const w = createWorld(cfg({ powerups: false }), 5);
    run(w, 120);
    const before = 500;
    w.paddles[0].y = FIELD_H / 2 - w.paddles[0].h / 2;
    w.balls[0] = {
      ...w.balls[0],
      x: paddleX(0) + 20,
      y: FIELD_H / 2,
      vx: -before,
      vy: 0,
      spin: 0,
    };
    run(w, 4);
    expect(w.balls[0].vx).toBeGreaterThan(0);
    expect(Math.hypot(w.balls[0].vx, w.balls[0].vy)).toBeGreaterThan(before);
  });
});

describe('prédiction locale', () => {
  it('reproduit exactement le déplacement serveur', () => {
    const w = createWorld(cfg(), 8);
    const start = w.paddles[0].y;
    stepWorld(w, [1, 0]);
    expect(w.paddles[0].y).toBeCloseTo(predictPaddle(start, w.paddles[0].h, 1, false), 10);
  });

  it('respecte la vitesse nominale', () => {
    const y = predictPaddle(100, 104, 1, false);
    expect(y - 100).toBeCloseTo(PADDLE_SPEED * TICK_DT, 6);
  });

  it("inverse la direction quand l'effet d'inversion est actif", () => {
    expect(predictPaddle(300, 104, 1, true)).toBeLessThan(300);
  });

  it('ne sort jamais du terrain', () => {
    expect(predictPaddle(FIELD_H, 104, 1, false)).toBe(FIELD_H - 104);
    expect(predictPaddle(0, 104, -1, false)).toBe(0);
  });
});

describe('terrains', () => {
  it('joue sans blocage sur tous les terrains', () => {
    for (const arena of ['classique', 'pilier', 'bumpers', 'tunnel', 'chaos'] as const) {
      const w = createWorld(cfg({ arena, target: 99 }), 2024);
      run(w, 3600, [0.3, -0.3]);
      // Hors pause entre deux points, une balle doit toujours être en jeu.
      expect(w.status === 'point' || w.balls.length > 0).toBe(true);
      for (const b of w.balls) {
        expect(b.x).toBeGreaterThan(-50);
        expect(b.x).toBeLessThan(FIELD_W + 50);
      }
    }
  });
});
