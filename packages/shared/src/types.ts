export type Side = 0 | 1;

export type ArenaId = 'classique' | 'pilier' | 'bumpers' | 'tunnel' | 'chaos';

export type PowerType = 'multi' | 'grow' | 'shrink' | 'slow' | 'turbo' | 'shield' | 'invert';

export type Difficulty = 0 | 1 | 2 | 3;

export interface MatchConfig {
  arena: ArenaId;
  /** Points nécessaires pour remporter la manche. */
  target: number;
  powerups: boolean;
  /** Vrai si le côté droit est tenu par un bot. */
  bot: boolean;
  botLevel: Difficulty;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  /** Dernier joueur à avoir touché la balle (attribution des bonus). */
  last: Side;
}

export interface Paddle {
  side: Side;
  y: number;
  /** Hauteur courante, interpolée vers la cible imposée par les effets. */
  h: number;
  /** Vitesse verticale du dernier tick, utilisée pour donner de l'effet. */
  vy: number;
  fx: { grow: number; shrink: number; invert: number };
  shield: boolean;
}

export interface PowerUp {
  id: number;
  type: PowerType;
  x: number;
  y: number;
}

export type Obstacle =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'bar'; x: number; y: number; len: number; thick: number; angle: number };

export type Status = 'countdown' | 'play' | 'point' | 'over';

/** Événements produits par un tick : consommés par le son, les particules, les logs. */
export type GameEvent =
  | { t: 'paddle'; side: Side; x: number; y: number; speed: number }
  | { t: 'wall'; x: number; y: number }
  | { t: 'obstacle'; x: number; y: number }
  | { t: 'power'; type: PowerType; side: Side; x: number; y: number }
  | { t: 'shield'; side: Side; x: number; y: number }
  | { t: 'goal'; side: Side; scores: [number, number] }
  | { t: 'over'; winner: Side; scores: [number, number]; bestRally: number };

export interface World {
  tick: number;
  /** État du générateur pseudo-aléatoire : rend la simulation reproductible. */
  seed: number;
  status: Status;
  /** Décompte du statut courant, en secondes. */
  timer: number;
  serveTo: Side;
  balls: Ball[];
  paddles: [Paddle, Paddle];
  powerups: PowerUp[];
  global: { slow: number; turbo: number };
  rally: number;
  bestRally: number;
  scores: [number, number];
  powerClock: number;
  nextId: number;
  config: MatchConfig;
  /** Vidé par l'appelant après chaque tick. */
  events: GameEvent[];
}

/** Une intention de déplacement, exprimée sur [-1, 1] (haut négatif). */
export interface InputCmd {
  seq: number;
  axis: number;
}
