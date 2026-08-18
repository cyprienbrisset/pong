import { describe, expect, it } from 'vitest';
import { decayOffset, foldDriftIntoOffset } from '../src/net/reconcile.js';

/**
 * Cas réel signalé, mesuré en production : rejouer un historique d'entrées
 * envoyées ne reconstruit pas la trajectoire serveur, parce que le serveur
 * échantillonne en continu et n'a pas de correspondance 1-pour-1 avec les
 * entrées envoyées. La bonne technique consiste à toujours coller à la
 * vérité serveur en interne, et à absorber l'écart dans un décalage visuel
 * qui s'estompe — la position affichée ne doit jamais discontinuer.
 */
describe('transfert de l\'écart dans un décalage visuel', () => {
  it('rend la position interne identique à la vérité serveur', () => {
    const r = foldDriftIntoOffset(310, 300, 0);
    expect(r.y).toBe(300);
  });

  it("conserve la position affichée (y + offset) inchangée à l'instant du recalage", () => {
    const before = { y: 290, offset: 5 };
    const displayedBefore = before.y + before.offset;
    const r = foldDriftIntoOffset(before.y, 300, before.offset);
    expect(r.y + r.offset).toBeCloseTo(displayedBefore, 9);
  });

  it('absorbe un écart négatif (prédiction en retard sur le serveur)', () => {
    const r = foldDriftIntoOffset(290, 300, 0);
    expect(r.y).toBe(300);
    expect(r.offset).toBeCloseTo(-10, 9);
  });

  it('compose plusieurs recalages sans jamais changer la position affichée', () => {
    let state = { y: 300, offset: 0 };
    const displayed = () => state.y + state.offset;
    const start = displayed();

    state = foldDriftIntoOffset(320, 305, state.offset); // prédiction ayant avancé, nouvelle vérité
    expect(displayed()).toBeCloseTo(start + 20, 9);

    state = foldDriftIntoOffset(state.y + 15, 340, state.offset); // encore une prédiction, nouvelle vérité
    expect(displayed()).toBeCloseTo(start + 35, 9);
  });
});

describe('décroissance du décalage visuel', () => {
  it('réduit le décalage sans jamais changer de signe', () => {
    const next = decayOffset(10, 0.1, 8);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(10);
  });

  it('fonctionne symétriquement pour un décalage négatif', () => {
    const next = decayOffset(-10, 0.1, 8);
    expect(next).toBeLessThan(0);
    expect(next).toBeGreaterThan(-10);
    expect(next).toBeCloseTo(-decayOffset(10, 0.1, 8), 9);
  });

  it('retombe exactement à zéro une fois négligeable', () => {
    expect(decayOffset(0.03, 0.1, 8)).toBe(0);
    expect(decayOffset(-0.03, 0.1, 8)).toBe(0);
  });

  it('converge vers zéro au fil des images à un framerate réaliste', () => {
    let offset = 30;
    for (let i = 0; i < 120; i++) offset = decayOffset(offset, 1 / 60, 8);
    expect(Math.abs(offset)).toBeLessThan(0.5);
  });
});
