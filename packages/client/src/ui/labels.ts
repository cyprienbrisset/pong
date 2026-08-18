import { ARENAS as SHARED_ARENAS } from '@neon-pong/shared';

/**
 * Vue d'interface des terrains : on ne remonte que ce dont l'affichage a besoin,
 * sans embarquer les fonctions de collision dans la couche présentation.
 */
export const ARENAS = SHARED_ARENAS.map((a) => ({ id: a.id, name: a.name, desc: a.desc }));

export const BOT_LABELS = ['Tranquille', 'Correct', 'Costaud', 'Inhumain'] as const;
