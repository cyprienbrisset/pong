import { afterEach, describe, expect, it, vi } from 'vitest';
import { TICK_HZ, createWorld, stepWorld } from '@neon-pong/shared';
import type { ServerControl } from '@neon-pong/shared';
import { Bot } from '../src/bot.js';
import { Store } from '../src/db.js';
import { Room, sanitizeConfig } from '../src/room.js';
import { cleanName, isNewer } from '../src/ws.js';

function fakeClient(id: string, name = id) {
  const json: ServerControl[] = [];
  const binary: ArrayBuffer[] = [];
  return {
    id,
    name,
    side: null as 0 | 1 | null,
    axis: 0,
    ackSeq: 0,
    rttMs: 0,
    connected: true,
    sendJson: (m: ServerControl) => json.push(m),
    sendBinary: (b: ArrayBuffer) => binary.push(b),
    close: () => {},
    json,
    binary,
  };
}

const stores: Store[] = [];
function memStore(): Store {
  const s = new Store(':memory:');
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  vi.useRealTimers();
});

describe('validation de configuration', () => {
  it('rejette un terrain inconnu', () => {
    expect(sanitizeConfig({ arena: 'wakastellar' as never }).arena).toBe('classique');
  });

  it('rejette un score cible fantaisiste', () => {
    expect(sanitizeConfig({ target: 9999 }).target).toBe(7);
    expect(sanitizeConfig({ target: -1 }).target).toBe(7);
    expect(sanitizeConfig({ target: 11 }).target).toBe(11);
  });

  it('borne le niveau du bot', () => {
    expect(sanitizeConfig({ botLevel: 42 as never }).botLevel).toBe(1);
  });
});

describe('pseudonymes', () => {
  it('accepte un prénom simple', () => {
    expect(cleanName('Hervé')).toBe('Hervé');
  });

  it('tronque à 14 caractères', () => {
    expect(cleanName('a'.repeat(50))?.length).toBe(14);
  });

  it('retire les caractères de contrôle', () => {
    expect(cleanName('Per\u0000ig\u001b')).toBe('Perig');
  });

  it('refuse le vide et les types inattendus', () => {
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName(null)).toBeNull();
  });
});

describe('séquences 16 bits', () => {
  it('reconnaît une séquence plus récente', () => {
    expect(isNewer(10, 9)).toBe(true);
    expect(isNewer(9, 10)).toBe(false);
  });

  it('gère le repli du compteur', () => {
    expect(isNewer(2, 65534)).toBe(true);
    expect(isNewer(65534, 2)).toBe(false);
  });
});

describe('salle', () => {
  it('attribue les sièges puis refuse le troisième joueur', () => {
    const room = new Room('TEST', { bot: false }, memStore(), () => {});
    expect(room.join(fakeClient('a'))).toBe(0);
    expect(room.join(fakeClient('b'))).toBe(1);
    expect(room.join(fakeClient('c'))).toBeNull(); // spectateur
    expect(room.view().spectators).toBe(1);
    room.dispose();
  });

  it('remplace un partant par un bot pour ne pas laisser la partie en plan', () => {
    const room = new Room('TEST', { bot: false }, memStore(), () => {});
    room.join(fakeClient('a'));
    room.join(fakeClient('b'));
    room.leave('b');
    expect(room.config.bot).toBe(true);
    room.dispose();
  });

  it("laisse un humain prendre la place du bot", () => {
    const room = new Room('TEST', { bot: true }, memStore(), () => {});
    room.join(fakeClient('a'));
    expect(room.join(fakeClient('b'))).toBe(1);
    expect(room.config.bot).toBe(false);
    room.dispose();
  });

  it("n'accepte les réglages que de l'hôte", () => {
    const room = new Room('TEST', { bot: true, target: 7 }, memStore(), () => {});
    room.join(fakeClient('a'));
    room.join(fakeClient('b'));
    room.updateConfig('b', { target: 11 });
    expect(room.config.target).toBe(7);
    room.updateConfig('a', { target: 11 });
    expect(room.config.target).toBe(11);
    room.dispose();
  });

  it('expire après le délai d\'inactivité', () => {
    const room = new Room('TEST', {}, memStore(), () => {});
    expect(room.isExpired(60_000)).toBe(false);
    expect(room.isExpired(-1)).toBe(true);
    room.dispose();
  });
});

describe('persistance', () => {
  it('agrège le classement et exclut les bots', () => {
    const store = memStore();
    store.recordMatch({
      arena: 'classique',
      target: 7,
      powerups: true,
      bestRally: 12,
      players: [
        { name: 'Cyprien', side: 0, score: 7, bot: false, won: true },
        { name: 'IA · Correct', side: 1, score: 3, bot: true, won: false },
      ],
    });
    store.recordMatch({
      arena: 'pilier',
      target: 7,
      powerups: false,
      bestRally: 30,
      players: [
        { name: 'Cyprien', side: 0, score: 5, bot: false, won: false },
        { name: 'Hervé', side: 1, score: 7, bot: false, won: true },
      ],
    });

    const rows = store.leaderboard();
    expect(rows.map((r) => r.name).sort()).toEqual(['Cyprien', 'Hervé']);
    const cyprien = rows.find((r) => r.name === 'Cyprien')!;
    expect(cyprien.matches).toBe(2);
    expect(cyprien.wins).toBe(1);
    expect(cyprien.points_for).toBe(12);
    expect(cyprien.points_against).toBe(10);
    expect(cyprien.best_rally).toBe(30);
  });

  it('classe par niveau (Elo) plutôt que par nombre brut de victoires', () => {
    const store = memStore();
    // Bob gagne ses 8 matchs contre Ann.
    for (let i = 0; i < 8; i++) {
      store.recordMatch({
        arena: 'classique',
        target: 7,
        powerups: false,
        bestRally: 5,
        players: [
          { name: 'Bob', side: 0, score: 7, bot: false, won: true },
          { name: 'Ann', side: 1, score: 3, bot: false, won: false },
        ],
      });
    }
    // Théo joue 30 matchs contre Ann et n'en gagne que 12 (40 %) : plus de
    // victoires brutes que Bob, mais un niveau réel inférieur.
    for (let i = 0; i < 30; i++) {
      const theoWins = i % 5 < 2;
      store.recordMatch({
        arena: 'classique',
        target: 7,
        powerups: false,
        bestRally: 5,
        players: [
          { name: 'Theo', side: 0, score: theoWins ? 7 : 3, bot: false, won: theoWins },
          { name: 'Ann', side: 1, score: theoWins ? 3 : 7, bot: false, won: !theoWins },
        ],
      });
    }

    const rows = store.leaderboard();
    const bob = rows.find((r) => r.name === 'Bob')!;
    const theo = rows.find((r) => r.name === 'Theo')!;
    expect(theo.wins).toBeGreaterThan(bob.wins);
    expect(bob.rating).toBeGreaterThan(theo.rating);
    expect(rows.findIndex((r) => r.name === 'Bob')).toBeLessThan(
      rows.findIndex((r) => r.name === 'Theo'),
    );
  });

  it('liste les matchs récents avec les deux camps', () => {
    const store = memStore();
    store.recordMatch({
      arena: 'chaos',
      target: 5,
      powerups: true,
      bestRally: 9,
      players: [
        { name: 'Perig', side: 0, score: 5, bot: false, won: true },
        { name: 'Hervé', side: 1, score: 2, bot: false, won: false },
      ],
    });
    const rows = store.recentMatches(5);
    expect(rows.length).toBe(1);
    expect(rows[0].left_name).toBe('Perig');
    expect(rows[0].right_score).toBe(2);
  });
});

describe('bot', () => {
  it('reste dans les bornes d\'axe', () => {
    const bot = new Bot(1, 3, () => 0.5);
    const w = createWorld(sanitizeConfig({ bot: true, botLevel: 3 }), 77);
    for (let i = 0; i < TICK_HZ * 20; i++) {
      const axis = bot.think(w);
      expect(axis).toBeGreaterThanOrEqual(-1);
      expect(axis).toBeLessThanOrEqual(1);
      stepWorld(w, [0, axis]);
      w.events.length = 0;
    }
  });

  it('marque contre une raquette immobile au niveau maximal', () => {
    const w = createWorld(sanitizeConfig({ bot: true, botLevel: 3, target: 3 }), 2024);
    const bot = new Bot(1, 3, () => 0.5);
    for (let i = 0; i < TICK_HZ * 120 && w.status !== 'over'; i++) {
      stepWorld(w, [0, bot.think(w)]);
      w.events.length = 0;
    }
    expect(w.scores[1]).toBeGreaterThan(w.scores[0]);
  });

  it('progresse en efficacité avec le niveau', () => {
    // Un aléa reproductible : sans lui, le bruit d'estimation vaut zéro et tous
    // les niveaux se comportent comme un mur parfait.
    const seeded = () => {
      let s = 0x9e3779b9;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
      };
    };

    const play = (level: 0 | 1 | 2 | 3) => {
      const w = createWorld(sanitizeConfig({ bot: true, botLevel: level, target: 999 }), 4242);
      const bot = new Bot(1, level, seeded());
      for (let i = 0; i < TICK_HZ * 120; i++) {
        stepWorld(w, [0, bot.think(w)]);
        w.events.length = 0;
      }
      return { conceded: w.scores[0], scored: w.scores[1] };
    };

    const easy = play(0);
    const hard = play(3);
    // Le niveau maximal encaisse moins de points que le niveau le plus bas.
    expect(hard.conceded).toBeLessThan(easy.conceded);
    // Et le niveau facile n'est pas un mur : il laisse passer des balles.
    expect(easy.conceded).toBeGreaterThan(0);
  });
});

describe('abandon de partie', () => {
  it("n'enregistre pas un match dont un joueur est parti en cours de route", () => {
    const store = memStore();
    const room = new Room('TEST', { bot: false, target: 5 }, store, () => {});
    room.join(fakeClient('a'));
    room.join(fakeClient('b'));
    room.leave('b');

    // On force la fin de manche comme le ferait la simulation.
    room.world.scores = [5, 0];
    room.world.status = 'over';
    room.world.events.push({ t: 'over', winner: 0, scores: [5, 0], bestRally: 4 });
    room['dispatchEvents'](room.world.events);

    expect(store.leaderboard()).toHaveLength(0);
    room.dispose();
  });

  it('enregistre un match mené à son terme', () => {
    const store = memStore();
    const room = new Room('TEST', { bot: true, target: 5 }, store, () => {});
    room.join(fakeClient('a', 'Cyprien'));
    room.world.events.push({ t: 'over', winner: 0, scores: [5, 2], bestRally: 11 });
    room['dispatchEvents'](room.world.events);

    const rows = store.leaderboard();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Cyprien');
    expect(rows[0].wins).toBe(1);
    room.dispose();
  });
});
