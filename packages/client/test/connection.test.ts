import { describe, expect, it } from 'vitest';
import type { RoomView } from '@neon-pong/shared';
import { resolveJoinPayload } from '../src/net/connection.js';

/**
 * Bug réel : une reconnexion automatique après coupure Wi-Fi relisait le
 * champ « Code de salle » du formulaire — généralement vide — au lieu de la
 * salle qu'on venait de quitter. Le joueur atterrissait dans une salle
 * différente au lieu de reprendre sa place. Le délai de grâce côté serveur
 * ne sert à rien si le client ne retente pas la bonne salle.
 */
function fakeRoom(code: string): RoomView {
  return {
    code,
    config: { arena: 'classique', target: 7, powerups: true, bot: false, botLevel: 1 },
    hostId: 'a',
    seats: [
      { side: 0, id: 'a', name: 'Cyprien', bot: false, connected: true, rttMs: 0 },
      { side: 1, id: 'b', name: 'Hervé', bot: false, connected: true, rttMs: 0 },
    ],
    spectators: 0,
  };
}

describe('résolution du code de salle à la (re)connexion', () => {
  it("laisse le payload intact quand aucune salle n'est mémorisée (premier envoi)", () => {
    const payload = { t: 'join' as const, name: 'Cyprien', code: undefined, config: {} };
    expect(resolveJoinPayload(payload, null)).toEqual(payload);
  });

  it('reprend le code de la salle mémorisée lors d\'une reconnexion automatique', () => {
    const payload = { t: 'join' as const, name: 'Cyprien', code: undefined, config: {} };
    const resolved = resolveJoinPayload(payload, fakeRoom('ABCD'));
    expect(resolved.code).toBe('ABCD');
  });

  it('écrase un code resté dans le formulaire par celui de la salle mémorisée', () => {
    const payload = { t: 'join' as const, name: 'Cyprien', code: 'ZZZZ', config: {} };
    const resolved = resolveJoinPayload(payload, fakeRoom('ABCD'));
    expect(resolved.code).toBe('ABCD');
  });

  it('ne touche à aucun autre champ du payload', () => {
    const payload = { t: 'join' as const, name: 'Cyprien', code: undefined, config: { target: 11 as const } };
    const resolved = resolveJoinPayload(payload, fakeRoom('ABCD'));
    expect(resolved.name).toBe('Cyprien');
    expect(resolved.config).toEqual({ target: 11 });
  });
});
