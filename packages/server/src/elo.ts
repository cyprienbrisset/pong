/**
 * Classement Elo simple, recalculé à rebours à partir de l'historique complet
 * des matchs. Le nombre brut de victoires récompense le volume ; l'Elo
 * récompense le niveau, en pondérant chaque victoire par la force de
 * l'adversaire au moment du match.
 */

export interface EloMatch {
  playerA: string;
  playerB: string;
  winner: 'a' | 'b';
}

export interface EloOptions {
  k?: number;
  base?: number;
}

export function computeEloRatings(matches: EloMatch[], opts: EloOptions = {}): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const m of matches) applyEloMatch(ratings, m, opts);
  return ratings;
}

/**
 * Traite un seul match et met `ratings` à jour en place. Permet à un appelant
 * (le cache de `Store`) d'absorber les nouveaux matchs un par un plutôt que de
 * rejouer tout l'historique à chaque lecture du classement.
 */
export function applyEloMatch(
  ratings: Map<string, number>,
  match: EloMatch,
  { k = 24, base = 1200 }: EloOptions = {},
): void {
  const ra = ratings.get(match.playerA) ?? base;
  const rb = ratings.get(match.playerB) ?? base;
  const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
  const scoreA = match.winner === 'a' ? 1 : 0;
  ratings.set(match.playerA, ra + k * (scoreA - expectedA));
  ratings.set(match.playerB, rb + k * (1 - scoreA - (1 - expectedA)));
}
