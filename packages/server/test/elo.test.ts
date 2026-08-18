import { describe, expect, it } from 'vitest';
import { applyEloMatch, computeEloRatings } from '../src/elo.js';

describe('classement Elo', () => {
  it('place un joueur inconnu à la base 1200', () => {
    const ratings = computeEloRatings([]);
    expect(ratings.get('Cyprien')).toBeUndefined();
    expect(ratings.get('Cyprien') ?? 1200).toBe(1200);
  });

  it('redistribue les points à somme nulle après un match', () => {
    const ratings = computeEloRatings([{ playerA: 'Ann', playerB: 'Bob', winner: 'a' }]);
    const gainA = ratings.get('Ann')! - 1200;
    const gainB = ratings.get('Bob')! - 1200;
    expect(gainA).toBeGreaterThan(0);
    expect(gainA + gainB).toBeCloseTo(0, 9);
  });

  it("bouge de K/2 points quand les deux joueurs partent à égalité (K=24)", () => {
    const ratings = computeEloRatings([{ playerA: 'Ann', playerB: 'Bob', winner: 'a' }]);
    expect(ratings.get('Ann')).toBeCloseTo(1212, 5);
    expect(ratings.get('Bob')).toBeCloseTo(1188, 5);
  });

  it('récompense moins une victoire attendue face à un adversaire plus faible', () => {
    // Ann est déjà largement favorite avant le dernier match.
    const historyLopsided = [
      { playerA: 'Ann', playerB: 'Weak', winner: 'a' as const },
      { playerA: 'Ann', playerB: 'Weak', winner: 'a' as const },
      { playerA: 'Ann', playerB: 'Weak', winner: 'a' as const },
      { playerA: 'Ann', playerB: 'Weak', winner: 'a' as const },
    ];
    const before = computeEloRatings(historyLopsided);
    const after = computeEloRatings([...historyLopsided, { playerA: 'Ann', playerB: 'Weak', winner: 'a' }]);
    const gainAgainstWeak = after.get('Ann')! - before.get('Ann')!;

    const upset = computeEloRatings([{ playerA: 'Ann', playerB: 'Weak', winner: 'b' as const }]);
    const gainAsUnderdogWinner = upset.get('Weak')! - 1200;

    expect(gainAgainstWeak).toBeLessThan(gainAsUnderdogWinner);
  });

  it('classe un joueur régulier au-dessus d\'un joueur qui accumule les matchs à faible taux de victoire', () => {
    // Reproduit le bug signalé : Bob gagne ses 8 matchs contre Ann quand Théo,
    // en jouant 30 matchs contre Ann, n'en gagne que 12 (40 %). Le nombre brut
    // de victoires de Théo (12) dépasse celui de Bob (8), mais son niveau réel
    // est inférieur : l'Elo doit l'y placer en dessous.
    const matches: { playerA: string; playerB: string; winner: 'a' | 'b' }[] = [];
    for (let i = 0; i < 8; i++) matches.push({ playerA: 'Bob', playerB: 'Ann', winner: 'a' });
    for (let i = 0; i < 30; i++) {
      matches.push({ playerA: 'Theo', playerB: 'Ann', winner: i % 5 < 2 ? 'a' : 'b' });
    }

    const ratings = computeEloRatings(matches);
    expect(ratings.get('Bob')!).toBeGreaterThan(ratings.get('Theo')!);
    expect(ratings.get('Bob')!).toBeGreaterThan(1200);
    expect(ratings.get('Theo')!).toBeLessThan(1200);
  });

  it('accepte un facteur K et une base personnalisés', () => {
    const ratings = computeEloRatings([{ playerA: 'Ann', playerB: 'Bob', winner: 'a' }], { k: 32, base: 1000 });
    expect(ratings.get('Ann')).toBeCloseTo(1016, 5);
    expect(ratings.get('Bob')).toBeCloseTo(984, 5);
  });
});

describe('mise à jour Elo incrémentale', () => {
  /**
   * `Store.leaderboard()` ne doit pas rejouer tout l'historique à chaque
   * lecture : ce recalcul bloquerait la boucle de simulation (mono-thread)
   * de toutes les salles actives à chaque appel à `/api/leaderboard`. La
   * mise à jour incrémentale — un seul match traité par appel — permet de
   * tenir un cache à jour sans jamais rejouer l'historique complet.
   */
  it('modifie la table en place plutôt que d\'en renvoyer une nouvelle', () => {
    const ratings = new Map<string, number>();
    applyEloMatch(ratings, { playerA: 'Ann', playerB: 'Bob', winner: 'a' });
    expect(ratings.get('Ann')).toBeCloseTo(1212, 5);
    expect(ratings.get('Bob')).toBeCloseTo(1188, 5);
  });

  it("produit exactement le même résultat qu'un recalcul complet, match après match", () => {
    const matches: { playerA: string; playerB: string; winner: 'a' | 'b' }[] = [];
    for (let i = 0; i < 8; i++) matches.push({ playerA: 'Bob', playerB: 'Ann', winner: 'a' });
    for (let i = 0; i < 30; i++) {
      matches.push({ playerA: 'Theo', playerB: 'Ann', winner: i % 5 < 2 ? 'a' : 'b' });
    }

    const fromScratch = computeEloRatings(matches);

    const incremental = new Map<string, number>();
    for (const m of matches) applyEloMatch(incremental, m);

    expect(incremental.get('Bob')).toBeCloseTo(fromScratch.get('Bob')!, 9);
    expect(incremental.get('Theo')).toBeCloseTo(fromScratch.get('Theo')!, 9);
    expect(incremental.get('Ann')).toBeCloseTo(fromScratch.get('Ann')!, 9);
  });

  it('respecte un facteur K et une base personnalisés', () => {
    const ratings = new Map<string, number>();
    applyEloMatch(ratings, { playerA: 'Ann', playerB: 'Bob', winner: 'a' }, { k: 32, base: 1000 });
    expect(ratings.get('Ann')).toBeCloseTo(1016, 5);
    expect(ratings.get('Bob')).toBeCloseTo(984, 5);
  });
});
