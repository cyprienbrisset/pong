import { FIELD_H, FIELD_W } from './constants.js';
import type { ArenaId, Obstacle } from './types.js';

/**
 * Les obstacles ne sont jamais transmis sur le réseau : ils sont une fonction
 * pure du terrain et du tick. Client et serveur les recalculent à l'identique,
 * ce qui économise la bande passante et garantit la cohérence.
 */
export interface ArenaDef {
  id: ArenaId;
  name: string;
  desc: string;
  obstaclesAt(t: number): Obstacle[];
}

const cx = FIELD_W / 2;
const cy = FIELD_H / 2;

export const ARENAS: ArenaDef[] = [
  {
    id: 'classique',
    name: 'Classique',
    desc: "Le terrain d'origine : rien pour se cacher, tout se joue à la raquette.",
    obstaclesAt: () => [],
  },
  {
    id: 'pilier',
    name: 'Pilier',
    desc: 'Une barre pivote au centre. Les angles changent en permanence.',
    obstaclesAt: (t) => [{ kind: 'bar', x: cx, y: cy, len: 170, thick: 16, angle: t * 0.9 }],
  },
  {
    id: 'bumpers',
    name: 'Bumpers',
    desc: 'Trois plots fixes, deux plots mobiles. Les rebonds deviennent imprévisibles.',
    obstaclesAt: (t) => [
      { kind: 'circle', x: cx, y: cy, r: 34 },
      { kind: 'circle', x: cx - 150, y: 150, r: 22 },
      { kind: 'circle', x: cx + 150, y: FIELD_H - 150, r: 22 },
      { kind: 'circle', x: cx - 150, y: FIELD_H - 150 - 90 * Math.sin(t * 1.1), r: 20 },
      { kind: 'circle', x: cx + 150, y: 150 + 90 * Math.sin(t * 1.1), r: 20 },
    ],
  },
  {
    id: 'tunnel',
    name: 'Tunnel',
    desc: "Un mur central percé d'un couloir. Il faut viser pour passer.",
    obstaclesAt: (t) => [
      { kind: 'rect', x: cx - 9, y: 0, w: 18, h: 195 },
      { kind: 'rect', x: cx - 9, y: FIELD_H - 195, w: 18, h: 195 },
      { kind: 'rect', x: cx - 70, y: cy - 9 + 120 * Math.sin(t * 1.6), w: 18, h: 18 },
      { kind: 'rect', x: cx + 52, y: cy - 9 - 120 * Math.sin(t * 1.6), w: 18, h: 18 },
    ],
  },
  {
    id: 'chaos',
    name: 'Chaos',
    desc: "Quatre blocs montent et descendent. Bon courage pour anticiper.",
    obstaclesAt: (t) =>
      [0, 1, 2, 3].map((i) => ({
        kind: 'rect' as const,
        x: 270 + i * 150,
        y: cy - 55 + 175 * Math.sin(t * 1.15 + i * 1.4),
        w: 20,
        h: 110,
      })),
  },
];

export const ARENA_IDS = ARENAS.map((a) => a.id);

export function getArena(id: ArenaId): ArenaDef {
  return ARENAS.find((a) => a.id === id) ?? ARENAS[0];
}
