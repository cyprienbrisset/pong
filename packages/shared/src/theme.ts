/**
 * Chartes graphiques.
 *
 * Un thème porte deux choses. Les **jetons** sont des couleurs. Les **traits**
 * sont structurels : une raquette en contour, une ligne en tiret, une rémanence
 * longue ou un décalage d'encre ne se décrivent pas avec une teinte. Sans eux,
 * les quatre directions se réduiraient à la même maquette repeinte.
 *
 * Le même fichier sert au rendu canvas, aux variables CSS de l'interface et à la
 * validation côté serveur : une charte publiée par un collègue traverse le
 * réseau, elle doit donc être vérifiée avant d'atteindre le DOM ou le canvas.
 */

export interface ThemeTokens {
  /** Décor derrière l'aire de jeu. */
  hall: string;
  panel: string;
  /** Cadre de sol autour de la table. */
  floor: string;
  /** Aire de jeu. */
  table: string;
  /** Lignes de terrain et médiane. */
  lines: string;
  /** Quadrillage de fond. Prévoir une couleur très peu contrastée. */
  grid: string;
  /** Camp gauche puis camp droit. */
  sideA: string;
  sideB: string;
  ball: string;
  /** Rémanence de la balle. Utiliser une couleur à alpha (#RRGGBBAA). */
  trail: string;
  obstacle: string;
  accent: string;
  ink: string;
  inkMuted: string;
}

export type PaddleFill = 'solid' | 'outline';
export type FontFamily = 'condensed' | 'mono' | 'grotesk';

export interface ThemeTraits {
  /** Rayon du halo, en pixels. 0 = aplat mat. */
  glow: number;
  /** Largeur du cadre de sol. 0 = pas de cadre, la table occupe tout. */
  tableInset: number;
  /** Longueur de tiret des lignes. 0 = trait plein. */
  lineDash: number;
  /** Raquette pleine ou en simple contour. */
  paddleFill: PaddleFill;
  /** Nombre de positions conservées pour la rémanence. 0 = aucune. */
  trailLength: number;
  /** Décalage de repérage d'impression, en pixels. 0 = aucun. */
  misregister: number;
  /** Lignes de balayage cathodique sur l'aire de jeu. */
  scanlines: boolean;
  /** Arc d'angle tracé au point de rebond, comme sur un schéma. */
  showAngles: boolean;
  font: FontFamily;
}

export interface Theme {
  id: string;
  name: string;
  /** Vrai pour les chartes livrées avec le jeu : elles ne sont pas modifiables. */
  builtin: boolean;
  tokens: ThemeTokens;
  traits: ThemeTraits;
}

/* ------------------------------------------------------------------ */
/* Chartes livrées                                                    */
/* ------------------------------------------------------------------ */

export const BUILTIN_THEMES: Theme[] = [
  {
    id: 'gym',
    name: 'Table de gymnase',
    builtin: true,
    tokens: {
      hall: '#16223a',
      panel: '#1e2d49',
      floor: '#c8632a',
      table: '#1b4fa0',
      lines: '#f2f2f0',
      grid: '#f2f2f012',
      sideA: '#e03c31',
      sideB: '#141414',
      ball: '#f5e14b',
      trail: '#f5e14b8c',
      obstacle: '#f2f2f0',
      accent: '#f5e14b',
      ink: '#f7f6f2',
      inkMuted: '#9db4d4',
    },
    traits: {
      glow: 0,
      tableInset: 14,
      lineDash: 0,
      paddleFill: 'solid',
      trailLength: 6,
      misregister: 0,
      scanlines: false,
      showAngles: false,
      font: 'condensed',
    },
  },
  {
    id: 'oscilloscope',
    name: 'Oscilloscope',
    builtin: true,
    tokens: {
      hall: '#050d08',
      panel: '#0b1a10',
      floor: '#071109',
      table: '#071109',
      lines: '#2e6b45',
      grid: '#123d24',
      sideA: '#7cffb2',
      sideB: '#7cffb2',
      ball: '#d8ffe8',
      trail: '#7cffb273',
      obstacle: '#7cffb2',
      accent: '#f2c14e',
      ink: '#d8ffe8',
      inkMuted: '#4e8c68',
    },
    traits: {
      glow: 18,
      tableInset: 0,
      lineDash: 6,
      paddleFill: 'solid',
      // La rémanence est l'élément signature : le faisceau persiste longtemps.
      trailLength: 22,
      misregister: 0,
      scanlines: true,
      showAngles: false,
      font: 'mono',
    },
  },
  {
    id: 'blueprint',
    name: 'Plan technique',
    builtin: true,
    tokens: {
      hall: '#071d33',
      panel: '#0e3358',
      floor: '#0b2e4f',
      table: '#0b2e4f',
      lines: '#3a6e9e',
      grid: '#1a4a78',
      sideA: '#bfe3ff',
      sideB: '#bfe3ff',
      ball: '#bfe3ff',
      trail: '#bfe3ff59',
      obstacle: '#7fa9ce',
      accent: '#f2c14e',
      ink: '#e4f2ff',
      inkMuted: '#7fa9ce',
    },
    traits: {
      glow: 0,
      tableInset: 0,
      lineDash: 4,
      paddleFill: 'outline',
      trailLength: 10,
      misregister: 0,
      scanlines: false,
      showAngles: true,
      font: 'mono',
    },
  },
  {
    id: 'riso',
    name: 'Risographie',
    builtin: true,
    tokens: {
      hall: '#e8e1d2',
      panel: '#d9d2c2',
      floor: '#d9d2c2',
      table: '#f4efe4',
      lines: '#101010',
      grid: '#1010100f',
      sideA: '#101010',
      sideB: '#ff4d2e',
      ball: '#ff4d2e',
      trail: '#ff4d2e40',
      obstacle: '#2b6e5c',
      accent: '#ff4d2e',
      ink: '#101010',
      inkMuted: '#6b6355',
    },
    traits: {
      glow: 0,
      tableInset: 10,
      lineDash: 10,
      paddleFill: 'solid',
      trailLength: 4,
      misregister: 3,
      scanlines: false,
      showAngles: false,
      font: 'grotesk',
    },
  },
  {
    id: 'neon',
    name: 'Néon rétro',
    builtin: true,
    tokens: {
      hall: '#04050c',
      panel: '#0a0f1e',
      floor: '#02030a',
      table: '#02030a',
      lines: '#6e83a673',
      grid: '#14284a',
      sideA: '#22e6ff',
      sideB: '#ff2fd0',
      ball: '#e9fbff',
      trail: '#e9fbff66',
      obstacle: '#ffcf3d',
      accent: '#ffcf3d',
      ink: '#e9fbff',
      inkMuted: '#6e83a6',
    },
    traits: {
      glow: 24,
      tableInset: 0,
      lineDash: 14,
      paddleFill: 'solid',
      trailLength: 16,
      misregister: 0,
      scanlines: true,
      showAngles: false,
      font: 'mono',
    },
  },
];

export const DEFAULT_THEME_ID = 'gym';

export function builtinTheme(id: string): Theme {
  return BUILTIN_THEMES.find((t) => t.id === id) ?? BUILTIN_THEMES[0];
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Une couleur de thème est **exclusivement** une notation hexadécimale.
 *
 * C'est une décision de sécurité, pas de style. Ces valeurs finissent dans des
 * variables CSS et dans `ctx.fillStyle` ; accepter `rgb()`, `var()` ou une
 * chaîne libre ouvrirait la porte à l'injection de CSS par une charte publiée.
 * L'alpha se note sur quatre ou huit chiffres (#RGBA, #RRGGBBAA).
 */
export const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,23}$/;

export const TOKEN_KEYS: (keyof ThemeTokens)[] = [
  'hall',
  'panel',
  'floor',
  'table',
  'lines',
  'grid',
  'sideA',
  'sideB',
  'ball',
  'trail',
  'obstacle',
  'accent',
  'ink',
  'inkMuted',
];

/** Libellés destinés au formulaire d'édition. */
export const TOKEN_LABELS: Record<keyof ThemeTokens, string> = {
  hall: 'Décor',
  panel: 'Panneaux',
  floor: 'Cadre de sol',
  table: 'Aire de jeu',
  lines: 'Lignes',
  grid: 'Quadrillage',
  sideA: 'Camp gauche',
  sideB: 'Camp droit',
  ball: 'Balle',
  trail: 'Rémanence',
  obstacle: 'Obstacles',
  accent: 'Accent',
  ink: 'Texte',
  inkMuted: 'Texte discret',
};

const TRAIT_BOUNDS = {
  glow: [0, 30],
  tableInset: [0, 30],
  lineDash: [0, 24],
  trailLength: [0, 24],
  misregister: [0, 5],
} as const;

const PADDLE_FILLS: PaddleFill[] = ['solid', 'outline'];
const FONTS: FontFamily[] = ['condensed', 'mono', 'grotesk'];

export interface ThemeValidation {
  theme: Theme | null;
  errors: string[];
}

/**
 * Contrôle et normalise une charte venue de l'extérieur : formulaire local,
 * corps de requête HTTP ou fichier importé. Les valeurs numériques hors bornes
 * sont ramenées dans l'intervalle, les couleurs invalides sont refusées — on ne
 * devine pas une couleur, mais on peut raisonnablement borner un nombre.
 */
export function parseTheme(input: unknown): ThemeValidation {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) {
    return { theme: null, errors: ['La charte doit être un objet.'] };
  }
  const raw = input as Record<string, unknown>;

  const id = String(raw.id ?? '')
    .toLowerCase()
    .trim();
  if (!THEME_ID_PATTERN.test(id)) {
    errors.push("L'identifiant doit faire 2 à 24 caractères : minuscules, chiffres ou tirets.");
  }
  if (BUILTIN_THEMES.some((t) => t.id === id)) {
    errors.push(`L'identifiant « ${id} » est réservé par une charte livrée.`);
  }

  const name = String(raw.name ?? '')
    .replace(/[\p{C}]/gu, '')
    .trim()
    .slice(0, 28);
  if (name.length < 1) errors.push('Le nom est obligatoire.');

  const rawTokens = (raw.tokens ?? {}) as Record<string, unknown>;
  const tokens = {} as ThemeTokens;
  for (const key of TOKEN_KEYS) {
    const value = rawTokens[key];
    if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
      errors.push(`Couleur « ${TOKEN_LABELS[key]} » invalide : attendu #RGB, #RRGGBB ou #RRGGBBAA.`);
      continue;
    }
    tokens[key] = value.toLowerCase();
  }

  const rawTraits = (raw.traits ?? {}) as Record<string, unknown>;
  const base = builtinTheme(DEFAULT_THEME_ID).traits;
  const traits: ThemeTraits = {
    glow: clampTrait(rawTraits.glow, 'glow', base.glow),
    tableInset: clampTrait(rawTraits.tableInset, 'tableInset', base.tableInset),
    lineDash: clampTrait(rawTraits.lineDash, 'lineDash', base.lineDash),
    trailLength: clampTrait(rawTraits.trailLength, 'trailLength', base.trailLength),
    misregister: clampTrait(rawTraits.misregister, 'misregister', base.misregister),
    paddleFill: PADDLE_FILLS.includes(rawTraits.paddleFill as PaddleFill)
      ? (rawTraits.paddleFill as PaddleFill)
      : base.paddleFill,
    scanlines: !!rawTraits.scanlines,
    showAngles: !!rawTraits.showAngles,
    font: FONTS.includes(rawTraits.font as FontFamily) ? (rawTraits.font as FontFamily) : base.font,
  };

  if (errors.length) return { theme: null, errors };
  return { theme: { id, name, builtin: false, tokens, traits }, errors: [] };
}

function clampTrait(value: unknown, key: keyof typeof TRAIT_BOUNDS, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const [lo, hi] = TRAIT_BOUNDS[key];
  return Math.round(Math.min(hi, Math.max(lo, n)));
}

/* ------------------------------------------------------------------ */
/* Interface                                                          */
/* ------------------------------------------------------------------ */

export const FONT_STACKS: Record<FontFamily, string> = {
  condensed: '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace',
  grotesk: '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
};

/** Traduit une charte en variables CSS. Les clés sont fixes, les valeurs validées. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of TOKEN_KEYS) vars[`--t-${kebab(key)}`] = theme.tokens[key];
  vars['--display'] = FONT_STACKS[theme.traits.font];
  vars['--radius'] = theme.traits.font === 'grotesk' ? '0px' : '3px';
  return vars;
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Point de départ d'une charte personnalisée : on part toujours d'une existante. */
export function deriveTheme(from: Theme, id: string, name: string): Theme {
  return {
    id,
    name,
    builtin: false,
    tokens: { ...from.tokens },
    traits: { ...from.traits },
  };
}
