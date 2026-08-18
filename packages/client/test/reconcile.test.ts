import { describe, expect, it } from 'vitest';
import { pruneAcknowledged, replayPendingInputs } from '../src/net/reconcile.js';

/**
 * Cas réel signalé : la raquette locale recule légèrement puis revient à sa
 * place, même à ping bas et stable. Cause : la réconciliation lissait en
 * continu vers la dernière position connue du serveur — toujours en léger
 * retard — au lieu de repartir de cette position confirmée et de rejouer
 * exactement les entrées envoyées mais pas encore acquittées.
 */
describe('purge des entrées acquittées', () => {
  it('retire les entrées dont le serveur a déjà tenu compte', () => {
    const pending = [
      { seq: 10, axis: 1 },
      { seq: 11, axis: 1 },
      { seq: 12, axis: -1 },
    ];
    expect(pruneAcknowledged(pending, 11)).toEqual([{ seq: 12, axis: -1 }]);
  });

  it("garde tout quand rien n'a encore été acquitté", () => {
    const pending = [{ seq: 5, axis: 0.3 }];
    expect(pruneAcknowledged(pending, 4)).toEqual(pending);
  });

  it('gère le repli du compteur de séquence à 65536', () => {
    const pending = [
      { seq: 65535, axis: 1 },
      { seq: 2, axis: 1 },
    ];
    expect(pruneAcknowledged(pending, 65534)).toEqual(pending);
    expect(pruneAcknowledged(pending, 65535)).toEqual([{ seq: 2, axis: 1 }]);
  });
});

describe('rejeu des entrées non acquittées', () => {
  it("part de la position confirmée, pas de l'ancienne prédiction", () => {
    const y = replayPendingInputs(300, 104, [], false);
    expect(y).toBe(300);
  });

  it('rejoue chaque entrée dans l\'ordre pour reconstruire la position actuelle', () => {
    const oneTick = 620 * (1 / 60); // PADDLE_SPEED * TICK_DT
    const y = replayPendingInputs(300, 104, [{ seq: 1, axis: 1 }, { seq: 2, axis: 1 }], false);
    expect(y).toBeCloseTo(300 + 2 * oneTick, 5);
  });

  it("s'arrête pile à la position d'arrêt quand la dernière entrée envoyée est déjà à l'axe zéro", () => {
    // Le joueur a relâché la touche : le serveur n'a pas encore confirmé l'arrêt,
    // mais l'entrée envoyée après le relâchement porte déjà un axe nul.
    const oneTick = 620 * (1 / 60);
    const y = replayPendingInputs(300, 104, [{ seq: 1, axis: 1 }, { seq: 2, axis: 0 }], false);
    expect(y).toBeCloseTo(300 + oneTick, 5);
  });

  it("respecte l'inversion de commande", () => {
    const oneTick = 620 * (1 / 60);
    const y = replayPendingInputs(300, 104, [{ seq: 1, axis: 1 }], true);
    expect(y).toBeCloseTo(300 - oneTick, 5);
  });

  it('reste dans les bornes du terrain', () => {
    const y = replayPendingInputs(590, 104, [{ seq: 1, axis: 1 }], false);
    expect(y).toBeLessThanOrEqual(600 - 104);
  });
});
