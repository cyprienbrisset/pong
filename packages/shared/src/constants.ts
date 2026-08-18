/**
 * Constantes de simulation. Toute valeur qui influence la physique vit ici :
 * client et serveur DOIVENT partager exactement les mêmes nombres, sinon la
 * prédiction locale divergera de la simulation autoritative.
 */

/** Largeur logique du terrain, en unités monde (= pixels à l'échelle 1). */
export const FIELD_W = 1000;
/** Hauteur logique du terrain. */
export const FIELD_H = 600;

/** Fréquence de la simulation. Fixe, jamais dérivée du framerate. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
/** Un snapshot est émis un tick sur deux. */
export const SNAPSHOT_EVERY = 2;
/** Sous-pas de collision par tick (anti-tunneling à haute vitesse). */
export const SUBSTEPS = 6;

export const PADDLE_W = 14;
export const PADDLE_H = 104;
export const PADDLE_MARGIN = 26;
export const PADDLE_SPEED = 620;

export const BALL_R = 9;
export const BALL_SPEED_MIN = 380;
export const BALL_SPEED_MAX = 1020;
/** Gain de vitesse à chaque frappe de raquette. */
export const BALL_SPEED_GAIN = 1.055;
/** Ouverture maximale d'un renvoi, en radians (~53°). */
export const MAX_BOUNCE_ANGLE = 0.92;
/** Force de l'effet Magnus : accélération latérale par unité de spin. */
export const SPIN_FORCE = 210;
/** Amortissement du spin, par seconde. */
export const SPIN_DECAY = 0.5;
export const SPIN_MAX = 1.6;

export const SLOW_FACTOR = 0.62;
export const TURBO_FACTOR = 1.34;

export const COUNTDOWN_S = 1.9;
export const POINT_PAUSE_S = 0.7;

export const POWERUP_R = 19;
export const POWERUP_FIRST_S = 5.5;
export const POWERUP_MIN_GAP_S = 7;
export const POWERUP_MAX_GAP_S = 12;
export const POWERUP_MAX_ON_FIELD = 2;

/** Durées d'effet, en secondes. */
export const FX_GROW_S = 12;
export const FX_SHRINK_S = 10;
export const FX_INVERT_S = 8;
export const FX_GLOBAL_S = 6;
export const GROW_SCALE = 1.55;
export const SHRINK_SCALE = 0.62;

/** Réseau. */
export const INPUT_HZ = 60;
/** Tampon d'interpolation client, en millisecondes. */
export const INTERP_DELAY_MS = 100;
/** Un client sans le moindre paquet pendant ce délai est considéré parti. */
export const CLIENT_TIMEOUT_MS = 15_000;
export const HEARTBEAT_MS = 2_000;
