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

export function computeEloRatings(
  matches: EloMatch[],
  { k = 24, base = 1200 }: EloOptions = {},
): Map<string, number> {
  const ratings = new Map<string, number>();
  const ratingOf = (name: string) => ratings.get(name) ?? base;

  for (const m of matches) {
    const ra = ratingOf(m.playerA);
    const rb = ratingOf(m.playerB);
    const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
    const scoreA = m.winner === 'a' ? 1 : 0;
    ratings.set(m.playerA, ra + k * (scoreA - expectedA));
    ratings.set(m.playerB, rb + k * (1 - scoreA - (1 - expectedA)));
  }

  return ratings;
}
