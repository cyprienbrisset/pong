/**
 * Réconciliation par décalage visuel qui s'estompe.
 *
 * Rejouer un historique d'entrées envoyées ne fonctionne pas ici : le serveur
 * ne compte pas les entrées, il échantillonne en continu le dernier axe reçu
 * à sa propre cadence de tick, indépendante de celle d'envoi du client. Le
 * nombre d'entrées envoyées et le nombre de ticks serveur exécutés divergent
 * (mesuré en production : des écarts en multiples exacts d'un tick).
 *
 * On repart donc de la vérité serveur à chaque frame — aucune dérive ne
 * s'accumule dans la position interne — et on absorbe l'écart introduit dans
 * un décalage purement visuel, qui se résorbe en douceur. La position
 * affichée (position interne + décalage) reste continue à chaque frame,
 * même quand la position interne, elle, se recale instantanément.
 */
export interface Reconciled {
  y: number;
  offset: number;
}

/**
 * Fait coller `y` à `authoritativeY` et transfère l'écart dans `offset`, de
 * sorte que `y + offset` après l'appel vaille exactement `predictedY + offset`
 * avant l'appel — aucune discontinuité visuelle au moment du recalage.
 */
export function foldDriftIntoOffset(predictedY: number, authoritativeY: number, offset: number): Reconciled {
  return { y: authoritativeY, offset: offset + (predictedY - authoritativeY) };
}

/** Estompe le décalage vers zéro sans jamais le faire changer de signe brutalement. */
export function decayOffset(offset: number, dt: number, rate = 8): number {
  const next = offset * (1 - Math.min(1, dt * rate));
  return Math.abs(next) < 0.05 ? 0 : next;
}
