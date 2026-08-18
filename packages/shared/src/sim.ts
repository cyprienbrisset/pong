import { getArena } from './arenas.js';
import * as C from './constants.js';
import { POWER_ORDER } from './powerups.js';
import { randInt, randRange } from './rng.js';
import type { Ball, InputCmd, MatchConfig, Obstacle, Paddle, PowerType, Side, World } from './types.js';

/* ------------------------------------------------------------------ */
/* Création                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_CONFIG: MatchConfig = {
  arena: 'classique',
  target: 7,
  powerups: true,
  bot: false,
  botLevel: 1,
};

function makePaddle(side: Side): Paddle {
  return {
    side,
    y: C.FIELD_H / 2 - C.PADDLE_H / 2,
    h: C.PADDLE_H,
    vy: 0,
    fx: { grow: 0, shrink: 0, invert: 0 },
    shield: false,
  };
}

export function paddleX(side: Side): number {
  return side === 0 ? C.PADDLE_MARGIN : C.FIELD_W - C.PADDLE_MARGIN - C.PADDLE_W;
}

export function createWorld(config: MatchConfig, seed: number): World {
  const w: World = {
    tick: 0,
    seed,
    status: 'countdown',
    timer: C.COUNTDOWN_S,
    serveTo: 0,
    balls: [],
    paddles: [makePaddle(0), makePaddle(1)],
    powerups: [],
    global: { slow: 0, turbo: 0 },
    rally: 0,
    bestRally: 0,
    scores: [0, 0],
    powerClock: C.POWERUP_FIRST_S,
    nextId: 1,
    config,
    events: [],
  };
  const first = randInt(w.seed, 2);
  w.seed = first.seed;
  w.serveTo = (first.value === 0 ? 0 : 1) as Side;
  spawnBall(w, w.serveTo === 0 ? -1 : 1);
  return w;
}

function spawnBall(w: World, dir: -1 | 1, speed = C.BALL_SPEED_MIN): void {
  const a = randRange(w.seed, -0.25, 0.25);
  w.seed = a.seed;
  const off = randRange(w.seed, -60, 60);
  w.seed = off.seed;
  w.balls.push({
    id: w.nextId++,
    x: C.FIELD_W / 2,
    y: C.FIELD_H / 2 + off.value,
    vx: Math.cos(a.value) * speed * dir,
    vy: Math.sin(a.value) * speed,
    spin: 0,
    last: dir > 0 ? 0 : 1,
  });
}

/* ------------------------------------------------------------------ */
/* Boucle de simulation                                               */
/* ------------------------------------------------------------------ */

/**
 * Avance le monde d'un tick de durée fixe.
 *
 * `axes` contient l'intention de chaque camp sur [-1, 1]. La fonction est
 * déterministe : mêmes entrées + même graine = même sortie, bit pour bit.
 * Les événements produits sont accumulés dans `w.events`, à l'appelant de les
 * consommer puis de vider le tableau.
 */
export function stepWorld(w: World, axes: [number, number]): void {
  w.tick++;

  switch (w.status) {
    case 'countdown':
      movePaddles(w, axes);
      updateEffects(w);
      w.timer -= C.TICK_DT;
      if (w.timer <= 0) {
        w.status = 'play';
        w.timer = 0;
      }
      return;

    case 'point':
      w.timer -= C.TICK_DT;
      if (w.timer <= 0) beginServe(w);
      return;

    case 'over':
      return;

    case 'play':
      break;
  }

  movePaddles(w, axes);
  updateEffects(w);
  maybeSpawnPower(w);

  const obstacles = obstaclesFor(w);
  const dt = C.TICK_DT / C.SUBSTEPS;
  for (let s = 0; s < C.SUBSTEPS; s++) {
    for (const b of w.balls) stepBall(w, b, dt, obstacles);
  }
  resolveGoals(w);
}

/** Obstacles du tick courant : fonction pure du terrain et du temps. */
export function obstaclesFor(w: World): Obstacle[] {
  return getArena(w.config.arena).obstaclesAt(w.tick * C.TICK_DT);
}

function movePaddles(w: World, axes: [number, number]): void {
  for (const p of w.paddles) {
    const raw = clamp(axes[p.side] ?? 0, -1, 1);
    const dir = p.fx.invert > 0 ? -raw : raw;
    const before = p.y;
    p.y = clamp(p.y + dir * C.PADDLE_SPEED * C.TICK_DT, 0, C.FIELD_H - p.h);
    p.vy = (p.y - before) / C.TICK_DT;
  }
}

function updateEffects(w: World): void {
  for (const p of w.paddles) {
    p.fx.grow = Math.max(0, p.fx.grow - C.TICK_DT);
    p.fx.shrink = Math.max(0, p.fx.shrink - C.TICK_DT);
    p.fx.invert = Math.max(0, p.fx.invert - C.TICK_DT);
    const target =
      C.PADDLE_H * (p.fx.grow > 0 ? C.GROW_SCALE : 1) * (p.fx.shrink > 0 ? C.SHRINK_SCALE : 1);
    const mid = p.y + p.h / 2;
    // Transition douce : une raquette qui change de taille d'un coup fait rater
    // des balles sans que le joueur comprenne pourquoi.
    p.h += (target - p.h) * Math.min(1, C.TICK_DT * 8);
    p.y = clamp(mid - p.h / 2, 0, C.FIELD_H - p.h);
  }
  w.global.slow = Math.max(0, w.global.slow - C.TICK_DT);
  w.global.turbo = Math.max(0, w.global.turbo - C.TICK_DT);
}

function speedFactor(w: World): number {
  let f = 1;
  if (w.global.slow > 0) f *= C.SLOW_FACTOR;
  if (w.global.turbo > 0) f *= C.TURBO_FACTOR;
  return f;
}

function stepBall(w: World, b: Ball, dt: number, obstacles: Obstacle[]): void {
  const f = speedFactor(w);
  b.vy += b.spin * C.SPIN_FORCE * dt;
  b.spin *= 1 - C.SPIN_DECAY * dt;
  b.x += b.vx * f * dt;
  b.y += b.vy * f * dt;

  if (b.y < C.BALL_R) {
    b.y = C.BALL_R;
    b.vy = Math.abs(b.vy);
    b.spin *= -0.6;
    w.events.push({ t: 'wall', x: b.x, y: b.y });
  } else if (b.y > C.FIELD_H - C.BALL_R) {
    b.y = C.FIELD_H - C.BALL_R;
    b.vy = -Math.abs(b.vy);
    b.spin *= -0.6;
    w.events.push({ t: 'wall', x: b.x, y: b.y });
  }

  for (const o of obstacles) {
    const hit =
      o.kind === 'circle'
        ? hitCircle(b, o.x, o.y, o.r, 1.03)
        : o.kind === 'rect'
          ? hitRect(b, o.x, o.y, o.w, o.h)
          : hitBar(b, o.x, o.y, o.len, o.thick, o.angle);
    if (hit) w.events.push({ t: 'obstacle', x: b.x, y: b.y });
  }

  for (const p of w.paddles) hitPaddle(w, b, p);

  if (w.config.powerups) {
    for (let i = w.powerups.length - 1; i >= 0; i--) {
      const pu = w.powerups[i];
      if (dist(b.x, b.y, pu.x, pu.y) < C.POWERUP_R + C.BALL_R) {
        w.powerups.splice(i, 1);
        applyPower(w, pu.type, b);
      }
    }
  }

  clampSpeed(b);
}

function clampSpeed(b: Ball): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > C.BALL_SPEED_MAX) {
    const k = C.BALL_SPEED_MAX / sp;
    b.vx *= k;
    b.vy *= k;
  } else if (sp < C.BALL_SPEED_MIN * 0.8 && sp > 0) {
    const k = (C.BALL_SPEED_MIN * 0.8) / sp;
    b.vx *= k;
    b.vy *= k;
  }
}

/* ------------------------------------------------------------------ */
/* Collisions                                                          */
/* ------------------------------------------------------------------ */

function reflect(b: Ball, nx: number, ny: number, boost: number): void {
  const dot = b.vx * nx + b.vy * ny;
  b.vx = (b.vx - 2 * dot * nx) * boost;
  b.vy = (b.vy - 2 * dot * ny) * boost;
  b.spin *= -0.5;
}

function hitCircle(b: Ball, cx: number, cy: number, r: number, boost: number): boolean {
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d = Math.hypot(dx, dy) || 1;
  if (d > r + C.BALL_R) return false;
  const nx = dx / d;
  const ny = dy / d;
  b.x = cx + nx * (r + C.BALL_R + 0.5);
  b.y = cy + ny * (r + C.BALL_R + 0.5);
  reflect(b, nx, ny, boost);
  return true;
}

function hitRect(b: Ball, rx: number, ry: number, rw: number, rh: number): boolean {
  const px = clamp(b.x, rx, rx + rw);
  const py = clamp(b.y, ry, ry + rh);
  const dx = b.x - px;
  const dy = b.y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 > C.BALL_R * C.BALL_R) return false;

  let nx: number;
  let ny: number;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
  } else {
    // Centre à l'intérieur du rectangle (obstacle mobile qui a rattrapé la
    // balle) : on sort par la face la plus proche.
    const left = b.x - rx;
    const right = rx + rw - b.x;
    const top = b.y - ry;
    const bottom = ry + rh - b.y;
    const min = Math.min(left, right, top, bottom);
    nx = min === left ? -1 : min === right ? 1 : 0;
    ny = min === top ? -1 : min === bottom ? 1 : 0;
  }
  b.x = px + nx * (C.BALL_R + 0.5);
  b.y = py + ny * (C.BALL_R + 0.5);
  reflect(b, nx, ny, 1.02);
  return true;
}

/** Une barre pivotante est traitée comme une capsule : exact et peu coûteux. */
function hitBar(b: Ball, x: number, y: number, len: number, thick: number, angle: number): boolean {
  const hx = (Math.cos(angle) * len) / 2;
  const hy = (Math.sin(angle) * len) / 2;
  const ax = x - hx;
  const ay = y - hy;
  const abx = 2 * hx;
  const aby = 2 * hy;
  const denom = abx * abx + aby * aby || 1;
  const t = clamp(((b.x - ax) * abx + (b.y - ay) * aby) / denom, 0, 1);
  return hitCircle(b, ax + abx * t, ay + aby * t, thick / 2, 1.03);
}

function hitPaddle(w: World, b: Ball, p: Paddle): boolean {
  const px = paddleX(p.side);
  const cx = clamp(b.x, px, px + C.PADDLE_W);
  const cy = clamp(b.y, p.y, p.y + p.h);
  if ((b.x - cx) ** 2 + (b.y - cy) ** 2 > C.BALL_R * C.BALL_R) return false;
  // On ignore une balle qui s'éloigne déjà : évite le double rebond quand la
  // raquette poursuit la balle.
  const incoming = p.side === 0 ? b.vx < 0 : b.vx > 0;
  if (!incoming) return false;

  const rel = clamp((b.y - (p.y + p.h / 2)) / (p.h / 2), -1, 1);
  const speed = Math.min(C.BALL_SPEED_MAX, Math.hypot(b.vx, b.vy) * C.BALL_SPEED_GAIN + 14);
  const angle = rel * C.MAX_BOUNCE_ANGLE;
  const dir = p.side === 0 ? 1 : -1;
  b.vx = Math.cos(angle) * speed * dir;
  b.vy = Math.sin(angle) * speed;
  // L'effet vient du mouvement de la raquette au contact : c'est ce qui
  // récompense le geste et distingue ce Pong de l'original.
  b.spin = clamp(b.spin * 0.2 + p.vy * 0.0022 + rel * 0.25, -C.SPIN_MAX, C.SPIN_MAX);
  b.x = p.side === 0 ? px + C.PADDLE_W + C.BALL_R + 0.5 : px - C.BALL_R - 0.5;
  b.last = p.side;
  w.rally++;
  w.bestRally = Math.max(w.bestRally, w.rally);
  w.events.push({ t: 'paddle', side: p.side, x: b.x, y: b.y, speed });
  return true;
}

/* ------------------------------------------------------------------ */
/* Bonus                                                              */
/* ------------------------------------------------------------------ */

function maybeSpawnPower(w: World): void {
  if (!w.config.powerups) return;
  w.powerClock -= C.TICK_DT;
  if (w.powerClock > 0 || w.powerups.length >= C.POWERUP_MAX_ON_FIELD) return;

  const gap = randRange(w.seed, C.POWERUP_MIN_GAP_S, C.POWERUP_MAX_GAP_S);
  w.seed = gap.seed;
  w.powerClock = gap.value;

  const pick = randInt(w.seed, POWER_ORDER.length);
  w.seed = pick.seed;
  const type = POWER_ORDER[pick.value];

  const obstacles = obstaclesFor(w);
  let x = C.FIELD_W / 2;
  let y = C.FIELD_H / 2;
  for (let tries = 0; tries < 24; tries++) {
    const rx = randRange(w.seed, C.FIELD_W * 0.3, C.FIELD_W * 0.7);
    w.seed = rx.seed;
    const ry = randRange(w.seed, 70, C.FIELD_H - 70);
    w.seed = ry.seed;
    x = rx.value;
    y = ry.value;
    if (!nearObstacle(x, y, obstacles)) break;
  }
  w.powerups.push({ id: w.nextId++, type, x, y });
}

function nearObstacle(x: number, y: number, obstacles: Obstacle[]): boolean {
  return obstacles.some((o) => {
    if (o.kind === 'circle') return dist(x, y, o.x, o.y) < o.r + 60;
    if (o.kind === 'rect') return dist(x, y, o.x + o.w / 2, o.y + o.h / 2) < 70;
    return dist(x, y, o.x, o.y) < o.len / 2 + 40;
  });
}

function applyPower(w: World, type: PowerType, ball: Ball): void {
  const me = w.paddles[ball.last];
  const foe = w.paddles[(1 - ball.last) as Side];
  switch (type) {
    case 'multi': {
      const sp = Math.hypot(ball.vx, ball.vy);
      const base = Math.atan2(ball.vy, ball.vx);
      for (const delta of [0.42, -0.42]) {
        w.balls.push({
          id: w.nextId++,
          x: ball.x,
          y: ball.y,
          vx: Math.cos(base + delta) * sp,
          vy: Math.sin(base + delta) * sp,
          spin: 0,
          last: ball.last,
        });
      }
      break;
    }
    case 'grow':
      me.fx.grow = C.FX_GROW_S;
      break;
    case 'shrink':
      foe.fx.shrink = C.FX_SHRINK_S;
      break;
    case 'slow':
      w.global.slow = C.FX_GLOBAL_S;
      w.global.turbo = 0;
      break;
    case 'turbo':
      w.global.turbo = C.FX_GLOBAL_S;
      w.global.slow = 0;
      break;
    case 'shield':
      me.shield = true;
      break;
    case 'invert':
      foe.fx.invert = C.FX_INVERT_S;
      break;
  }
  w.events.push({ t: 'power', type, side: ball.last, x: ball.x, y: ball.y });
}

/* ------------------------------------------------------------------ */
/* Points et fin de manche                                            */
/* ------------------------------------------------------------------ */

function resolveGoals(w: World): void {
  for (let i = w.balls.length - 1; i >= 0; i--) {
    const b = w.balls[i];
    if (b.x > C.BALL_R && b.x < C.FIELD_W - C.BALL_R) continue;

    const conceder: Side = b.x <= C.BALL_R ? 0 : 1;
    const p = w.paddles[conceder];
    if (p.shield) {
      p.shield = false;
      b.vx = Math.abs(b.vx) * (conceder === 0 ? 1 : -1);
      b.x = conceder === 0 ? C.BALL_R + 2 : C.FIELD_W - C.BALL_R - 2;
      w.events.push({ t: 'shield', side: conceder, x: b.x, y: b.y });
      continue;
    }
    scorePoint(w, (1 - conceder) as Side);
    return;
  }
}

function scorePoint(w: World, winner: Side): void {
  w.scores[winner]++;
  w.events.push({ t: 'goal', side: winner, scores: [...w.scores] as [number, number] });
  w.serveTo = (1 - winner) as Side;
  w.balls.length = 0;
  w.powerups.length = 0;
  w.rally = 0;
  w.global.slow = 0;
  w.global.turbo = 0;
  for (const p of w.paddles) {
    p.fx = { grow: 0, shrink: 0, invert: 0 };
    p.shield = false;
  }
  if (w.scores[winner] >= w.config.target) {
    w.status = 'over';
    w.timer = 0;
    w.events.push({
      t: 'over',
      winner,
      scores: [...w.scores] as [number, number],
      bestRally: w.bestRally,
    });
  } else {
    w.status = 'point';
    w.timer = C.POINT_PAUSE_S;
  }
}

function beginServe(w: World): void {
  spawnBall(w, w.serveTo === 0 ? -1 : 1);
  w.status = 'countdown';
  w.timer = C.COUNTDOWN_S;
  w.powerClock = C.POWERUP_FIRST_S;
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Applique une entrée à une raquette isolée. Utilisé par la prédiction locale
 * du client : c'est la seule portion de physique rejouée côté navigateur, et
 * elle est volontairement identique à `movePaddles`.
 */
export function predictPaddle(y: number, h: number, axis: number, inverted: boolean): number {
  const dir = inverted ? -clamp(axis, -1, 1) : clamp(axis, -1, 1);
  return clamp(y + dir * C.PADDLE_SPEED * C.TICK_DT, 0, C.FIELD_H - h);
}

export type { InputCmd };
