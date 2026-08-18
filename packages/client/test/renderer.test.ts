import { describe, expect, it } from 'vitest';
import { PADDLE_W, paddleX } from '@neon-pong/shared';
import { nextSpinAngle, ownPaddleMarkerAnchor } from '../src/game/renderer.js';

/**
 * Sur les chartes « Oscilloscope » et « Plan technique », sideA et sideB
 * partagent exactement la même couleur : impossible d'identifier sa propre
 * raquette à la teinte seule. Le repère doit donc reposer sur une position —
 * pas une couleur — et pointer sans ambiguïté vers le camp local.
 */
describe('repère de raquette locale', () => {
  it('se place sur le bord intérieur du camp gauche, au milieu de la raquette', () => {
    const anchor = ownPaddleMarkerAnchor(0, 200, 100);
    expect(anchor.x).toBe(paddleX(0) + PADDLE_W);
    expect(anchor.y).toBe(250);
  });

  it('se place sur le bord intérieur du camp droit, au milieu de la raquette', () => {
    const anchor = ownPaddleMarkerAnchor(1, 200, 100);
    expect(anchor.x).toBe(paddleX(1));
    expect(anchor.y).toBe(250);
  });

  it('suit la raquette quand elle grandit ou rétrécit', () => {
    const short = ownPaddleMarkerAnchor(0, 300, 60);
    const tall = ownPaddleMarkerAnchor(0, 300, 160);
    expect(short.y).toBe(330);
    expect(tall.y).toBe(380);
  });

  it('les deux camps ne partagent jamais le même bord', () => {
    const left = ownPaddleMarkerAnchor(0, 0, 100);
    const right = ownPaddleMarkerAnchor(1, 0, 100);
    expect(left.x).not.toBe(right.x);
  });
});

/**
 * L'effet Magnus est la mécanique signature du jeu, mais invisible : rien à
 * l'écran n'indique qu'une balle tourne. Le marqueur de rotation rend ce spin
 * directement lisible en tournant à une vitesse proportionnelle à sa valeur
 * réelle.
 */
describe('angle du marqueur de rotation', () => {
  it('ne bouge pas quand la balle ne tourne pas', () => {
    expect(nextSpinAngle(1.2, 0, 1 / 60)).toBeCloseTo(1.2, 9);
  });

  it('avance dans le sens positif proportionnellement au spin et au temps', () => {
    const a = nextSpinAngle(0, 1, 1 / 60);
    const b = nextSpinAngle(0, 2, 1 / 60);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(a * 2, 9);
  });

  it('tourne dans le sens inverse pour un spin négatif', () => {
    expect(nextSpinAngle(0, -1, 1 / 60)).toBeLessThan(0);
  });

  it('ne grandit jamais sans borne : reste dans [-2π, 2π]', () => {
    let angle = 0;
    for (let i = 0; i < 100_000; i++) angle = nextSpinAngle(angle, 1.6, 1 / 60);
    expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI * 2);
  });
});
