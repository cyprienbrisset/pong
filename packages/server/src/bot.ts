import {
  BALL_R,
  FIELD_H,
  PADDLE_SPEED,
  PADDLE_W,
  TICK_DT,
  paddleX,
} from '@neon-pong/shared';
import type { Difficulty, Side, World } from '@neon-pong/shared';

/**
 * Le bot vit côté serveur et n'a accès qu'à ce qu'un humain pourrait voir : il
 * ne triche pas sur la physique, il se contente de prédire, avec une erreur et
 * un temps de réaction calibrés par niveau.
 */
export interface BotProfile {
  name: string;
  /** Vitesse maximale utilisable, en unités par seconde. */
  speed: number;
  /** Écart d'estimation, en unités monde. */
  noise: number;
  /** Délai avant réévaluation de la cible, en secondes. */
  react: number;
}

export const BOT_PROFILES: Record<Difficulty, BotProfile> = {
  0: { name: 'Tranquille', speed: 330, noise: 100, react: 0.3 },
  1: { name: 'Correct', speed: 470, noise: 48, react: 0.17 },
  2: { name: 'Costaud', speed: 620, noise: 20, react: 0.09 },
  3: { name: 'Inhumain', speed: 790, noise: 7, react: 0.03 },
};

export class Bot {
  private target = FIELD_H / 2;
  private clock = 0;
  private profile: BotProfile;

  constructor(
    private side: Side,
    level: Difficulty,
    private rand: () => number = Math.random,
  ) {
    this.profile = BOT_PROFILES[level];
  }

  get label(): string {
    return `IA · ${this.profile.name}`;
  }

  /** Renvoie l'axe à appliquer, sur [-1, 1]. */
  think(w: World): number {
    const p = w.paddles[this.side];
    this.clock -= TICK_DT;
    if (this.clock <= 0) {
      this.clock = this.profile.react;
      this.target = this.estimate(w);
    }
    const centre = p.y + p.h / 2;
    const delta = this.target - centre;
    if (Math.abs(delta) < 6) return 0;
    // On plafonne à la vitesse du profil, exprimée en fraction de la vitesse
    // nominale d'une raquette : le bot ne peut pas être plus rapide qu'un humain
    // au niveau maximal.
    const cap = Math.min(1, this.profile.speed / PADDLE_SPEED);
    return Math.sign(delta) * Math.min(1, Math.abs(delta) / 40) * cap;
  }

  /** Simule la trajectoire jusqu'à la ligne de but, rebonds sur les murs compris. */
  private estimate(w: World): number {
    const goalX = this.side === 0 ? paddleX(0) + PADDLE_W + BALL_R : paddleX(1) - BALL_R;
    const incoming = w.balls
      .filter((b) => (this.side === 0 ? b.vx < 0 : b.vx > 0))
      .sort((a, b) => Math.abs(a.x - goalX) - Math.abs(b.x - goalX))[0];

    if (!incoming) {
      // Rien ne vient : on revient vers le centre, en se laissant dériver.
      return FIELD_H / 2 + this.jitter(this.profile.noise * 1.4);
    }

    let { x, y, vx, vy } = incoming;
    const step = 1 / 240;
    let guard = 0;
    while (guard++ < 2400 && (this.side === 0 ? x > goalX : x < goalX)) {
      x += vx * step;
      y += vy * step;
      if (y < BALL_R) {
        y = BALL_R;
        vy = Math.abs(vy);
      } else if (y > FIELD_H - BALL_R) {
        y = FIELD_H - BALL_R;
        vy = -Math.abs(vy);
      }
    }
    return y + this.jitter(this.profile.noise);
  }

  private jitter(amount: number): number {
    return (this.rand() * 2 - 1) * amount;
  }
}
