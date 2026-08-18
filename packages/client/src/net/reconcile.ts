import { FIELD_H, isNewer, predictPaddle } from '@neon-pong/shared';

/** Une entrée envoyée au serveur, conservée jusqu'à son acquittement. */
export interface PendingInput {
  seq: number;
  axis: number;
}

/**
 * Ne garde que les entrées que le serveur n'a pas encore prises en compte.
 * `ackSeq` vient du dernier snapshot reçu : tout ce qui est plus ancien ou
 * égal a déjà influencé la position que ce snapshot rapporte.
 */
export function pruneAcknowledged(pending: PendingInput[], ackSeq: number): PendingInput[] {
  // `isNewer` traite une séquence égale comme « plus récente » (utile pour
  // décider si un ackSeq reçu doit remplacer l'ancien) ; ici on veut l'exclure,
  // puisqu'une entrée dont le numéro est exactement celui acquitté a déjà
  // influencé la position que le serveur rapporte.
  return pending.filter((p) => p.seq !== ackSeq && isNewer(p.seq, ackSeq));
}

/**
 * Reconstruit la position actuelle de la raquette locale : on repart de la
 * position confirmée par le serveur, puis on rejoue exactement les entrées
 * envoyées mais pas encore acquittées, dans l'ordre. Contrairement à un
 * lissage continu vers une valeur toujours en léger retard, cette
 * reconstruction ne produit aucune correction visible tant que la prédiction
 * et la simulation serveur restent d'accord — y compris au moment précis où
 * le joueur s'arrête ou change de direction.
 */
export function replayPendingInputs(
  authoritativeY: number,
  paddleH: number,
  pending: PendingInput[],
  inverted: boolean,
): number {
  let y = authoritativeY;
  for (const p of pending) y = predictPaddle(y, paddleH, p.axis, inverted);
  return Math.max(0, Math.min(FIELD_H - paddleH, y));
}
