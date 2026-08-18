import type { PowerType } from './types.js';

export interface PowerDef {
  type: PowerType;
  label: string;
  /** Couleur d'affichage, partagée par le HUD et le canvas. */
  color: string;
  glyph: string;
  /** Sur qui l'effet s'applique : celui qui l'attrape, l'adversaire, ou tout le monde. */
  scope: 'self' | 'foe' | 'both';
}

export const POWERS: Record<PowerType, PowerDef> = {
  multi: { type: 'multi', label: 'Multi-balles', color: '#ffcf3d', glyph: '\u2b21', scope: 'both' },
  grow: { type: 'grow', label: 'Raquette XXL', color: '#22e6ff', glyph: '\u2195', scope: 'self' },
  shrink: { type: 'shrink', label: 'Rétrécie', color: '#ff2fd0', glyph: '\u2913', scope: 'foe' },
  slow: { type: 'slow', label: 'Ralenti', color: '#7cff9a', glyph: '\u25c1', scope: 'both' },
  turbo: { type: 'turbo', label: 'Turbo', color: '#ff7a3d', glyph: '\u25b7', scope: 'both' },
  shield: { type: 'shield', label: 'Bouclier', color: '#a98bff', glyph: '\u25a1', scope: 'self' },
  invert: { type: 'invert', label: 'Inversion', color: '#ff4d6d', glyph: '\u21c5', scope: 'foe' },
};

/** Ordre stable : l'index sert d'identifiant sur le réseau, ne pas réordonner. */
export const POWER_ORDER: PowerType[] = ['multi', 'grow', 'shrink', 'slow', 'turbo', 'shield', 'invert'];

export function powerIndex(type: PowerType): number {
  return POWER_ORDER.indexOf(type);
}

export function powerFromIndex(i: number): PowerType {
  return POWER_ORDER[i] ?? 'multi';
}
