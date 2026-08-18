# Rejeu de partie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de revoir un match terminé, image par image et à l'identique, en
enregistrant la graine et la séquence des axes appliqués à chaque tick plutôt que des
positions.

**Architecture:** Le serveur accumule les axes de chaque tick joué (`Room.tick()`) et les
persiste (SQLite, table `replays`, 1-pour-1 avec `matches`) uniquement pour les matchs non
abandonnés, à la fin de `Room.finish()`. Le client récupère la graine + les axes via une
nouvelle route HTTP, puis rejoue localement avec les mêmes fonctions pures que la
simulation serveur (`createWorld`/`stepWorld`), en poussant le résultat au `Renderer`
existant via un nouvel adaptateur `worldSnapshot()` — aucune modification du rendu.

**Tech Stack:** TypeScript, `node:sqlite` (déjà en place), Vitest, aucune nouvelle
dépendance.

**Spec:** `docs/superpowers/specs/2026-08-18-rejeu-de-partie-design.md`

## Global Constraints

- Seuls les matchs **non abandonnés** ont un replay (décision du design, pas une
  contrainte technique).
- Lecture seule à vitesse normale : pas de vitesse variable, pas de curseur de
  progression.
- Un axe est quantifié sur un octet signé (`Math.round(clamp(axis, -1, 1) * 127)`),
  exactement comme les entrées réseau (`encodeInput`) — même codage, une seule
  définition, partagée.
- Pas de nouvelle dépendance npm.
- Toute fonction pure nouvelle est testée en TDD (test rouge d'abord) ; le câblage
  DOM/réseau côté client suit la convention déjà en place dans ce projet : pas de test
  unitaire dédié, vérifié en navigateur réel (dernière tâche de ce plan).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `packages/shared/src/protocol.ts` | `quantizeAxis`/`dequantizeAxis`, `worldSnapshot()`, `ServerControl['over'].matchId` |
| `packages/shared/test/protocol.test.ts` | Tests des trois ajouts ci-dessus |
| `packages/server/src/db.ts` | Table `replays`, `recordMatch()` renvoie l'id, `saveReplay`/`getReplay`, `has_replay`/`match_id` dans `recentMatches()` |
| `packages/server/src/room.ts` | Enregistrement des axes par tick, réordonnancement de `finish()` |
| `packages/server/src/http.ts` | Route `GET /api/replays/:matchId` |
| `packages/server/test/server.test.ts` | Tests `Room`/`Store` pour l'enregistrement et la lecture des replays |
| `packages/client/src/net/replay.ts` | `axisPairAt`, `fetchReplay`, `ReplayPlayer` (nouveau fichier) |
| `packages/client/test/replay.test.ts` | Test de `axisPairAt` (nouveau fichier) |
| `packages/client/index.html` | Panneau `#panel-replays`, barre de lecture, bouton « Revoir » sur l'écran de fin |
| `packages/client/src/style.css` | Style de la barre de lecture de replay |
| `packages/client/src/ui/shell.ts` | `renderReplayList`, wiring des nouveaux boutons/panneau |
| `packages/client/src/main.ts` | Démarrage/arrêt de la lecture, capture du `matchId` de fin de match |

---

### Task 1: Quantification d'axe partagée

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Test: `packages/shared/test/protocol.test.ts`

**Interfaces:**
- Produces: `quantizeAxis(axis: number): number`, `dequantizeAxis(byte: number): number`
  — exportées de `@neon-pong/shared`. Utilisées par Task 6 (serveur, enregistrement) et
  Task 8 (client, lecture).

- [ ] **Step 1: Write the failing test**

Dans `packages/shared/test/protocol.test.ts`, ajouter (à la suite du bloc `describe('entrées', ...)`) :

```typescript
describe('quantification d\'axe', () => {
  it('code -1, 0 et 1 exactement', () => {
    expect(quantizeAxis(-1)).toBe(-127);
    expect(quantizeAxis(0)).toBe(0);
    expect(quantizeAxis(1)).toBe(127);
  });

  it('borne les valeurs hors limites', () => {
    expect(quantizeAxis(5)).toBe(127);
    expect(quantizeAxis(-5)).toBe(-127);
  });

  it('fait un aller-retour à moins de 1 %', () => {
    for (const axis of [-1, -0.5, 0, 0.25, 0.99, 1]) {
      expect(dequantizeAxis(quantizeAxis(axis))).toBeCloseTo(axis, 2);
    }
  });
});
```

Et ajouter `quantizeAxis, dequantizeAxis` à l'import depuis `'../src/index.js'` en haut du
fichier (liste alphabétique existante).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && node --run test -- protocol.test.ts`
Expected: FAIL — `quantizeAxis is not a function` (ou erreur d'import équivalente).

- [ ] **Step 3: Write minimal implementation**

Dans `packages/shared/src/protocol.ts`, juste après la fonction `decodeInput` (avant
`isNewer`) :

```typescript
/** Quantifie un axe sur un octet signé, comme les entrées réseau (`encodeInput`). */
export function quantizeAxis(axis: number): number {
  return Math.round(clamp(axis, -1, 1) * 127);
}

/** Inverse de `quantizeAxis`. */
export function dequantizeAxis(byte: number): number {
  return byte / 127;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && node --run test -- protocol.test.ts`
Expected: PASS (toutes les suites du fichier, pas seulement la nouvelle).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/protocol.ts packages/shared/test/protocol.test.ts
git commit -m "Quantification d'axe partagée pour le rejeu de partie"
```

---

### Task 2: `worldSnapshot()` — adapter un `World` en `Snapshot`

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Test: `packages/shared/test/protocol.test.ts`

**Interfaces:**
- Consumes: `World`, `Snapshot`, la fonction privée `paddleFlags` déjà définie dans ce
  fichier (ligne ~119).
- Produces: `worldSnapshot(w: World): Snapshot`, exportée. Utilisée par Task 8 (client,
  lecture de replay) — c'est ce qui permet au `Renderer` existant de rendre un `World`
  reconstruit localement sans aucune modification de son côté.

- [ ] **Step 1: Write the failing test**

Dans `packages/shared/test/protocol.test.ts`, ajouter `worldSnapshot` à l'import, et
ajouter ce bloc (après le `describe('snapshot', ...)` existant) :

```typescript
describe('worldSnapshot', () => {
  it('reflète exactement l\'état du monde, sans quantification', () => {
    const w = createWorld({ ...DEFAULT_CONFIG, arena: 'bumpers' }, 4242);
    for (let i = 0; i < 200; i++) {
      stepWorld(w, [0.3, -0.7]);
      w.events.length = 0;
    }
    const snap = worldSnapshot(w);
    expect(snap.tick).toBe(w.tick);
    expect(snap.status).toBe(w.status);
    expect(snap.scores).toEqual(w.scores);
    expect(snap.rally).toBe(w.rally);
    expect(snap.paddles[0].y).toBe(w.paddles[0].y);
    expect(snap.paddles[0].h).toBe(w.paddles[0].h);
    expect(snap.balls[0].x).toBe(w.balls[0].x);
    expect(snap.balls[0].spin).toBe(w.balls[0].spin);
    // Pas de round-trip binaire : la précision flottante est intacte.
    expect(snap.balls[0].x).not.toBe(Math.round(snap.balls[0].x));
  });

  it('transporte les drapeaux d\'effet comme encodeSnapshot', () => {
    const w = createWorld(DEFAULT_CONFIG, 1);
    w.paddles[0].fx.shrink = 3;
    w.paddles[1].shield = true;
    const snap = worldSnapshot(w);
    expect(snap.paddles[0].flags & FX_SHRINK).toBeTruthy();
    expect(snap.paddles[1].flags & FX_SHIELD).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && node --run test -- protocol.test.ts`
Expected: FAIL — `worldSnapshot is not a function`.

- [ ] **Step 3: Write minimal implementation**

Dans `packages/shared/src/protocol.ts`, juste après la fonction `paddleFlags` (avant
`SNAPSHOT_HEADER`) :

```typescript
/**
 * Transforme un `World` en la même forme qu'un `Snapshot` reçu du réseau, sans passer
 * par l'encodage binaire — donc sans sa perte de précision par quantification. Utilisée
 * uniquement pour le rejeu local d'un match enregistré : il n'y a ni réseau ni
 * acquittement à représenter, `serverMs` et `ackSeq` valent 0.
 */
export function worldSnapshot(w: World): Snapshot {
  return {
    tick: w.tick,
    serverMs: 0,
    ackSeq: 0,
    status: w.status,
    timer: w.timer,
    scores: w.scores,
    rally: w.rally,
    paddles: w.paddles.map((p) => ({ y: p.y, h: p.h, flags: paddleFlags(p) })),
    balls: w.balls.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, spin: b.spin, last: b.last })),
    powerups: w.powerups.map((pu) => ({ x: pu.x, y: pu.y, type: pu.type })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && node --run test -- protocol.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/protocol.ts packages/shared/test/protocol.test.ts
git commit -m "worldSnapshot() : adapter un World en Snapshot pour le rejeu"
```

---

### Task 3: `matchId` optionnel dans le message de fin de partie

**Files:**
- Modify: `packages/shared/src/protocol.ts:265` (type `ServerControl`)

**Interfaces:**
- Produces: `ServerControl` de type `'over'` gagne un champ `matchId?: number`. Consommé
  par Task 6 (le serveur le renseigne) et Task 11 (le client le lit pour afficher le
  bouton « Revoir »).

Pas de test dédié : c'est un ajout de champ optionnel sur un type déjà exercé par les
tests existants de `server.test.ts` (aucun n'inspecte l'absence/présence de ce champ
avant Task 6, qui ajoute le test correspondant).

- [ ] **Step 1: Modifier le type**

Dans `packages/shared/src/protocol.ts`, ligne 265 :

```typescript
  | { t: 'over'; winner: Side; scores: [number, number]; bestRally: number; names: [string, string]; matchId?: number }
```

(remplace la ligne existante du même nom dans l'union `ServerControl`.)

- [ ] **Step 2: Vérifier la compilation**

Run: `cd packages/shared && node --run build`
Expected: succès, aucune erreur (un champ optionnel ajouté ne casse aucun consommateur
existant).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "ServerControl 'over' : ajouter matchId optionnel"
```

---

### Task 4: Stockage des replays (`Store`)

**Files:**
- Modify: `packages/server/src/db.ts`
- Test: `packages/server/test/server.test.ts`

**Interfaces:**
- Consumes: `quantizeAxis`/`dequantizeAxis` non nécessaires ici (le `Store` stocke des
  octets déjà quantifiés par l'appelant).
- Produces:
  - `recordMatch(rec: MatchRecord): number` (changement de signature : renvoyait `void`).
  - `interface ReplayRecord { arena: string; target: number; powerups: boolean; bot: boolean; botLevel: number; seed: number; simVersion: number; axes: Buffer }`
  - `saveReplay(matchId: number, replay: ReplayRecord): void`
  - `getReplay(matchId: number): ReplayRecord | null`

  Consommées par Task 6 (`Room.finish()`) et Task 7 (route HTTP).

- [ ] **Step 1: Write the failing test**

Dans `packages/server/test/server.test.ts`, ajouter un nouveau `describe` après celui
sur l'abandon de partie (donc après la fermeture du `describe('délai de grâce', ...)`
existant) :

```typescript
describe('stockage des replays', () => {
  it('enregistre un match et renvoie son id', () => {
    const store = memStore();
    const matchId = store.recordMatch({
      arena: 'classique',
      target: 7,
      powerups: true,
      bestRally: 5,
      players: [
        { name: 'Cyprien', side: 0, score: 7, bot: false, won: true },
        { name: 'Hervé', side: 1, score: 3, bot: false, won: false },
      ],
    });
    expect(typeof matchId).toBe('number');
    expect(matchId).toBeGreaterThan(0);
  });

  it('sauvegarde et relit un replay identique', () => {
    const store = memStore();
    const matchId = store.recordMatch({
      arena: 'chaos',
      target: 5,
      powerups: false,
      bestRally: 3,
      players: [
        { name: 'Cyprien', side: 0, score: 5, bot: false, won: true },
        { name: 'IA · Correct', side: 1, score: 2, bot: true, won: false },
      ],
    });
    const axes = Buffer.from(new Int8Array([10, -20, 127, -127, 0, 0]).buffer);
    store.saveReplay(matchId, {
      arena: 'chaos',
      target: 5,
      powerups: false,
      bot: true,
      botLevel: 2,
      seed: 987654321,
      simVersion: 1,
      axes,
    });

    const replay = store.getReplay(matchId);
    expect(replay).not.toBeNull();
    expect(replay!.arena).toBe('chaos');
    expect(replay!.target).toBe(5);
    expect(replay!.powerups).toBe(false);
    expect(replay!.bot).toBe(true);
    expect(replay!.botLevel).toBe(2);
    expect(replay!.seed).toBe(987654321);
    expect(replay!.simVersion).toBe(1);
    expect(Buffer.from(replay!.axes)).toEqual(axes);
  });

  it('ne trouve aucun replay pour un match inexistant', () => {
    const store = memStore();
    expect(store.getReplay(999999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && node --run test -- server.test.ts`
Expected: FAIL — `store.saveReplay is not a function` (le premier test, sur l'id de
retour, peut déjà passer par accident selon l'implémentation actuelle : vérifier qu'au
moins les deux autres échouent).

- [ ] **Step 3: Write minimal implementation**

Dans `packages/server/src/db.ts`, ajouter la table dans `SCHEMA` (après la table
`match_players` et son index, avant la table `themes`) :

```sql
CREATE TABLE IF NOT EXISTS replays (
  match_id    INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  arena       TEXT    NOT NULL,
  target      INTEGER NOT NULL,
  powerups    INTEGER NOT NULL,
  bot         INTEGER NOT NULL,
  bot_level   INTEGER NOT NULL,
  seed        INTEGER NOT NULL,
  sim_version INTEGER NOT NULL,
  axes        BLOB    NOT NULL
);
```

Ajouter l'interface, juste après `MatchRecord` :

```typescript
export interface ReplayRecord {
  arena: string;
  target: number;
  powerups: boolean;
  bot: boolean;
  botLevel: number;
  seed: number;
  simVersion: number;
  axes: Buffer;
}
```

Ajouter les champs privés (à la suite de `deleteThemeStmt`) :

```typescript
  private insertReplay;
  private getReplayStmt;
```

Dans le constructeur, après la préparation de `deleteThemeStmt` (avant le rejeu de
l'historique Elo) :

```typescript
    this.insertReplay = this.db.prepare(`
      INSERT INTO replays (match_id, arena, target, powerups, bot, bot_level, seed, sim_version, axes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getReplayStmt = this.db.prepare(`
      SELECT arena, target, powerups, bot, bot_level AS botLevel, seed, sim_version AS simVersion, axes
      FROM replays WHERE match_id = ?
    `);
```

Changer la signature et le corps de `recordMatch` (remplacer la méthode existante en
entier) :

```typescript
  recordMatch(rec: MatchRecord): number {
    // Une transaction : un match est enregistré entier ou pas du tout.
    this.db.exec('BEGIN');
    let matchId: number;
    try {
      const res = this.insertMatch.run(
        rec.arena,
        rec.target,
        rec.powerups ? 1 : 0,
        rec.bestRally,
      );
      matchId = Number(res.lastInsertRowid);
      for (const p of rec.players) {
        this.insertPlayer.run(
          matchId,
          p.name,
          p.side,
          p.score,
          p.bot ? 1 : 0,
          p.won ? 1 : 0,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      logger.error({ err }, "échec de l'enregistrement du match");
      throw err;
    }

    const p0 = rec.players.find((p) => p.side === 0);
    const p1 = rec.players.find((p) => p.side === 1);
    if (p0 && p1) {
      applyEloMatch(this.ratings, { playerA: p0.name, playerB: p1.name, winner: p0.won ? 'a' : 'b' });
    }
    return matchId;
  }
```

Ajouter les deux nouvelles méthodes, juste après `recentMatches` :

```typescript
  /* ---------------- rejeu de partie ---------------- */

  saveReplay(matchId: number, replay: ReplayRecord): void {
    this.insertReplay.run(
      matchId,
      replay.arena,
      replay.target,
      replay.powerups ? 1 : 0,
      replay.bot ? 1 : 0,
      replay.botLevel,
      replay.seed,
      replay.simVersion,
      replay.axes,
    );
  }

  getReplay(matchId: number): ReplayRecord | null {
    const row = this.getReplayStmt.get(matchId) as
      | {
          arena: string;
          target: number;
          powerups: number;
          bot: number;
          botLevel: number;
          seed: number;
          simVersion: number;
          axes: Uint8Array;
        }
      | undefined;
    if (!row) return null;
    return {
      arena: row.arena,
      target: row.target,
      powerups: !!row.powerups,
      bot: !!row.bot,
      botLevel: row.botLevel,
      seed: row.seed,
      simVersion: row.simVersion,
      axes: Buffer.from(row.axes),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && node --run test -- server.test.ts`
Expected: PASS (toute la suite, y compris les tests préexistants qui appellent
`recordMatch` sans utiliser sa valeur de retour — un changement de type de retour ne les
casse pas).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db.ts packages/server/test/server.test.ts
git commit -m "Stockage des replays : table, saveReplay/getReplay, recordMatch renvoie l'id"
```

---

### Task 5: `recentMatches` expose `match_id` et `has_replay`

**Files:**
- Modify: `packages/server/src/db.ts`
- Test: `packages/server/test/server.test.ts`

**Interfaces:**
- Produces: chaque ligne de `recentMatches()` gagne `match_id: number` et
  `has_replay: 0 | 1`. Consommé par Task 9/10 (liste des replays côté client) — c'est ce
  qui permet de savoir quels matchs récents proposent un replay, y compris ceux
  enregistrés avant ce déploiement (qui n'ont pas de ligne `replays`).

- [ ] **Step 1: Write the failing test**

Dans `packages/server/test/server.test.ts`, dans le `describe('persistance', ...)`
existant, ajouter ce test après celui sur les matchs récents :

```typescript
  it('indique quels matchs récents ont un replay', () => {
    const store = memStore();
    const matchId = store.recordMatch({
      arena: 'classique',
      target: 5,
      powerups: true,
      bestRally: 4,
      players: [
        { name: 'Cyprien', side: 0, score: 5, bot: false, won: true },
        { name: 'Hervé', side: 1, score: 1, bot: false, won: false },
      ],
    });
    store.recordMatch({
      arena: 'tunnel',
      target: 5,
      powerups: true,
      bestRally: 2,
      players: [
        { name: 'Perig', side: 0, score: 5, bot: false, won: true },
        { name: 'Hervé', side: 1, score: 3, bot: false, won: false },
      ],
    });
    store.saveReplay(matchId, {
      arena: 'classique',
      target: 5,
      powerups: true,
      bot: false,
      botLevel: 1,
      seed: 1,
      simVersion: 1,
      axes: Buffer.from([0, 0]),
    });

    const rows = store.recentMatches(10) as { match_id: number; has_replay: number }[];
    const withReplay = rows.find((r) => r.match_id === matchId)!;
    const withoutReplay = rows.find((r) => r.match_id !== matchId)!;
    expect(withReplay.has_replay).toBe(1);
    expect(withoutReplay.has_replay).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && node --run test -- server.test.ts`
Expected: FAIL — `match_id`/`has_replay` valent `undefined`, les deux `find` échouent ou
les assertions sur `.has_replay` échouent.

- [ ] **Step 3: Write minimal implementation**

Dans `packages/server/src/db.ts`, remplacer la requête `recentStmt` du constructeur :

```typescript
    this.recentStmt = this.db.prepare(`
      SELECT m.id AS match_id, m.played_at, m.arena, m.best_rally,
             MAX(CASE WHEN mp.side = 0 THEN mp.name END)  AS left_name,
             MAX(CASE WHEN mp.side = 0 THEN mp.score END) AS left_score,
             MAX(CASE WHEN mp.side = 1 THEN mp.name END)  AS right_name,
             MAX(CASE WHEN mp.side = 1 THEN mp.score END) AS right_score,
             EXISTS(SELECT 1 FROM replays r WHERE r.match_id = m.id) AS has_replay
      FROM matches m JOIN match_players mp ON mp.match_id = m.id
      GROUP BY m.id
      ORDER BY m.played_at DESC, m.id DESC
      LIMIT ?
    `);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && node --run test -- server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db.ts packages/server/test/server.test.ts
git commit -m "recentMatches expose match_id et has_replay"
```

---

### Task 6: Enregistrement des axes par tick (`Room`)

**Files:**
- Modify: `packages/server/src/room.ts`
- Test: `packages/server/test/server.test.ts`

**Interfaces:**
- Consumes: `quantizeAxis` (Task 1), `store.recordMatch(): number` (Task 4),
  `store.saveReplay` (Task 4).
- Produces: `Room` persiste un replay pour tout match non abandonné ; le message `'over'`
  envoyé aux clients porte `matchId` quand un replay a été sauvegardé.

- [ ] **Step 1: Write the failing test**

Dans `packages/server/test/server.test.ts`, dans le `describe('abandon de partie', ...)`
existant (celui qui contient déjà `"enregistre un match mené à son terme"`), ajouter :

```typescript
  it('enregistre un replay pour un match mené à son terme', () => {
    const store = memStore();
    const room = new Room('TEST', { bot: true, target: 3 }, store, () => {});
    room.join(fakeClient('a', 'Cyprien'));

    // Deux ticks avec des axes connus, avant la fin forcée de la manche.
    room['tick']();
    room['tick']();

    room.world.events.push({ t: 'over', winner: 0, scores: [3, 1], bestRally: 5 });
    room['dispatchEvents'](room.world.events);

    const rows = store.recentMatches(1) as { match_id: number }[];
    const replay = store.getReplay(rows[0].match_id);
    expect(replay).not.toBeNull();
    expect(replay!.axes.length).toBe(4); // 2 ticks x 2 camps
    room.dispose();
  });

  it("n'enregistre aucun replay pour un match abandonné", () => {
    const store = memStore();
    const room = new Room('TEST', { bot: false, target: 5 }, store, () => {});
    room.join(fakeClient('a'));
    room.join(fakeClient('b'));
    room.leave('b');

    room.world.scores = [5, 0];
    room.world.status = 'over';
    room.world.events.push({ t: 'over', winner: 0, scores: [5, 0], bestRally: 4 });
    room['dispatchEvents'](room.world.events);

    expect(store.recentMatches(10)).toHaveLength(0);
    room.dispose();
  });

  it('transmet matchId dans le message de fin quand le replay est enregistré', () => {
    const store = memStore();
    const room = new Room('TEST', { bot: true, target: 3 }, store, () => {});
    const client = fakeClient('a', 'Cyprien');
    room.join(client);

    room.world.events.push({ t: 'over', winner: 0, scores: [3, 1], bestRally: 5 });
    room['dispatchEvents'](room.world.events);

    const overMsg = client.json.find((m) => m.t === 'over') as { matchId?: number };
    expect(typeof overMsg.matchId).toBe('number');
    room.dispose();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && node --run test -- server.test.ts`
Expected: FAIL — `store.getReplay(...)` renvoie `null` (aucun replay sauvegardé), et
`overMsg.matchId` vaut `undefined`.

- [ ] **Step 3: Write minimal implementation**

Dans `packages/server/src/room.ts`, ajouter `quantizeAxis` à l'import depuis
`@neon-pong/shared` (liste alphabétique existante, ligne 1-11).

Ajouter la constante, à la suite de `GRACE_MS` :

```typescript
/** Incrémentée à la main si la physique de `stepWorld` change un jour de façon
 * incompatible avec les replays déjà enregistrés. */
const SIM_VERSION = 1;
```

Ajouter deux champs privés, à la suite de `grace` :

```typescript
  /** Axes quantifiés de chaque tick joué, aplatis en paires [côté0, côté1]. */
  private recordedAxes: number[] = [];
  /** Graine de départ : `world.seed` mute pendant la partie (le générateur
   * aléatoire l'avance à chaque tirage), il faut la conserver à part. */
  private initialSeed = 0;
```

Remplacer le constructeur :

```typescript
  constructor(
    code: string,
    config: Partial<MatchConfig>,
    private store: Store,
    private onEmpty: (room: Room) => void,
  ) {
    this.code = code;
    this.config = sanitizeConfig(config);
    const seed = makeSeed();
    this.world = createWorld(this.config, seed);
    this.initialSeed = seed;
    this.syncBot();
  }
```

Remplacer `resetWorld` :

```typescript
  private resetWorld(): void {
    const seed = makeSeed();
    this.world = createWorld(this.config, seed);
    this.initialSeed = seed;
    this.recordedAxes = [];
    this.recorded = false;
    this.abandoned = false;
    this.startedAt = Date.now();
    this.syncBot();
  }
```

Dans `tick()`, pousser les axes quantifiés juste après leur calcul :

```typescript
  private tick(): void {
    const seats = this.seats;
    const axes: [number, number] = [
      seats[0]?.axis ?? 0,
      this.bot ? this.bot.think(this.world) : (seats[1]?.axis ?? 0),
    ];
    this.recordedAxes.push(quantizeAxis(axes[0]), quantizeAxis(axes[1]));

    stepWorld(this.world, axes);

    if (this.world.events.length) {
      this.dispatchEvents(this.world.events);
      this.world.events.length = 0;
    }

    if (this.world.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }
```

Remplacer `finish` en entier — le replay doit être enregistré **avant** l'envoi du
message `'over'`, pour pouvoir y inclure `matchId` :

```typescript
  private finish(winner: Side, scores: [number, number], bestRally: number): void {
    if (this.recorded) return;
    this.recorded = true;
    if (this.grace) {
      // Le match s'est terminé pendant qu'un siège était en délai de grâce :
      // le joueur n'a pas eu le temps de revenir, ça reste un abandon.
      clearTimeout(this.grace.timer);
      this.grace = null;
      this.abandoned = true;
    }
    this.refreshSeatNames();

    let matchId: number | undefined;
    if (!this.abandoned) {
      try {
        matchId = this.store.recordMatch({
          arena: this.config.arena,
          target: this.config.target,
          powerups: this.config.powerups,
          bestRally,
          players: [0, 1].map((side) => ({
            name: this.seatNames[side],
            side: side as Side,
            score: scores[side],
            bot: side === 1 ? this.config.bot : false,
            won: side === winner,
          })),
        });
        this.store.saveReplay(matchId, {
          arena: this.config.arena,
          target: this.config.target,
          powerups: this.config.powerups,
          bot: this.config.bot,
          botLevel: this.config.botLevel,
          seed: this.initialSeed,
          simVersion: SIM_VERSION,
          axes: Buffer.from(new Int8Array(this.recordedAxes).buffer),
        });
      } catch (err) {
        // Un échec d'écriture ne doit jamais interrompre une partie en cours.
        logger.error({ err, room: this.code }, 'match non enregistré');
        matchId = undefined;
      }
    }

    for (const c of this.clients.values()) {
      if (c.connected) {
        c.sendJson({ t: 'over', winner, scores, bestRally, names: this.seatNames, matchId });
      }
    }

    if (this.abandoned) {
      logger.info({ room: this.code, scores }, 'match abandonné : non enregistré');
      return;
    }

    logger.info(
      {
        room: this.code,
        arena: this.config.arena,
        scores,
        bestRally,
        durationSec: Math.round((Date.now() - this.startedAt) / 1000),
      },
      'match terminé',
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && node --run test -- server.test.ts`
Expected: PASS (toute la suite — vérifier en particulier que les tests de délai de
grâce et d'abandon, déjà en place, passent toujours : `finish()` a été réordonné mais son
comportement observable pour ces cas ne change pas).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/room.ts packages/server/test/server.test.ts
git commit -m "Room enregistre les axes de chaque tick et persiste le replay à la fin"
```

---

### Task 7: Route HTTP `GET /api/replays/:matchId`

**Files:**
- Modify: `packages/server/src/http.ts`

**Interfaces:**
- Consumes: `store.getReplay(matchId: number): ReplayRecord | null` (Task 4).
- Produces: `GET /api/replays/:matchId` → `200 { arena, target, powerups, bot, botLevel, seed, simVersion, axes }` (axes en base64) ou `404 { error }`.

Pas de test dédié : aucune route HTTP existante de ce projet n'a de test unitaire (voir
`/api/leaderboard`, `/api/matches`, `/api/themes` — tous non testés directement, vérifiés
par usage réel). Cette route suit la même convention ; elle est vérifiée en navigateur
réel à la Task 12.

- [ ] **Step 1: Ajouter la route**

Dans `packages/server/src/http.ts`, juste avant le `switch (url.pathname)` (donc après le
bloc `if (req.method !== 'GET' && req.method !== 'HEAD')`), ajouter :

```typescript
    if (url.pathname.startsWith('/api/replays/')) {
      const matchId = Number(url.pathname.slice('/api/replays/'.length));
      if (!Number.isInteger(matchId) || matchId <= 0) {
        json(res, 400, { error: 'identifiant de match invalide' });
        return;
      }
      const replay = store.getReplay(matchId);
      if (!replay) {
        json(res, 404, { error: 'replay introuvable' });
        return;
      }
      json(res, 200, {
        arena: replay.arena,
        target: replay.target,
        powerups: replay.powerups,
        bot: replay.bot,
        botLevel: replay.botLevel,
        seed: replay.seed,
        simVersion: replay.simVersion,
        axes: replay.axes.toString('base64'),
      });
      return;
    }
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd packages/server && node --run build`
Expected: succès, aucune erreur.

- [ ] **Step 3: Vérification manuelle rapide**

Run (le serveur doit tourner en local, ex. `DB_PATH=":memory:" node packages/server/dist/index.js` sur un port libre) :
```bash
curl -s http://127.0.0.1:<port>/api/replays/999999
```
Expected: `{"error":"replay introuvable"}` avec un statut 404 (utiliser `curl -i` pour
voir le code de statut). Un id inexistant confirme que la route répond sans planter —
le cas positif (id réel) est vérifié à la Task 12 une fois un match joué.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/http.ts
git commit -m "Route GET /api/replays/:matchId"
```

---

### Task 8: Lecteur de replay côté client (`replay.ts`)

**Files:**
- Create: `packages/client/src/net/replay.ts`
- Test: `packages/client/test/replay.test.ts`

**Interfaces:**
- Consumes: `dequantizeAxis` (Task 1), `createWorld`/`stepWorld`/`TICK_DT` (déjà exportés
  de `@neon-pong/shared`), types `World`, `MatchConfig`, `GameEvent`.
- Produces:
  - `axisPairAt(axes: number[], tickIndex: number): [number, number] | null`
  - `interface ReplayData { arena: ArenaId; target: number; powerups: boolean; bot: boolean; botLevel: Difficulty; seed: number; axes: number[] }`
  - `interface ReplayHandlers { onFrame(world: World, dt: number): void; onEvents(events: GameEvent[]): void; onDone(): void }`
  - `class ReplayPlayer { constructor(data: ReplayData, handlers: ReplayHandlers); start(): void; stop(): void }`
  - `async function fetchReplay(matchId: number): Promise<ReplayData>`

  `ReplayPlayer` et `fetchReplay` sont consommées par Task 11 (`main.ts`).

- [ ] **Step 1: Write the failing test**

Créer `packages/client/test/replay.test.ts` :

```typescript
import { describe, expect, it } from 'vitest';
import { axisPairAt } from '../src/net/replay.js';

describe('axisPairAt', () => {
  it('décode la paire du tick demandé', () => {
    // Tick 0 : côté0=127 (axe 1), côté1=-127 (axe -1). Tick 1 : les deux à 0.
    const axes = [127, -127, 0, 0];
    const pair0 = axisPairAt(axes, 0);
    expect(pair0).not.toBeNull();
    expect(pair0![0]).toBeCloseTo(1, 2);
    expect(pair0![1]).toBeCloseTo(-1, 2);

    const pair1 = axisPairAt(axes, 1);
    expect(pair1).toEqual([0, 0]);
  });

  it('renvoie null au-delà du dernier tick enregistré', () => {
    const axes = [127, -127];
    expect(axisPairAt(axes, 1)).toBeNull();
    expect(axisPairAt(axes, 5)).toBeNull();
  });

  it('renvoie null sur un tableau vide', () => {
    expect(axisPairAt([], 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/client && node --run test -- replay.test.ts`
Expected: FAIL — le fichier `../src/net/replay.js` n'existe pas encore.

- [ ] **Step 3: Write minimal implementation**

Créer `packages/client/src/net/replay.ts` :

```typescript
import { TICK_DT, createWorld, dequantizeAxis, stepWorld } from '@neon-pong/shared';
import type { ArenaId, Difficulty, GameEvent, MatchConfig, World } from '@neon-pong/shared';

/**
 * Rejeu d'un match enregistré : la graine et la séquence d'axes suffisent à reproduire
 * exactement la partie, avec les mêmes fonctions pures que la simulation serveur. Voir
 * docs/superpowers/specs/2026-08-18-rejeu-de-partie-design.md pour le choix de cette
 * approche plutôt qu'un enregistrement de positions.
 */
export interface ReplayData {
  arena: ArenaId;
  target: number;
  powerups: boolean;
  bot: boolean;
  botLevel: Difficulty;
  seed: number;
  /** Paires aplaties [côté0, côté1, ...] par tick, déjà quantifiées sur un octet signé. */
  axes: number[];
}

export interface ReplayHandlers {
  onFrame(world: World, dt: number): void;
  onEvents(events: GameEvent[]): void;
  onDone(): void;
}

/** Paire d'axes du tick demandé, ou `null` si le replay est terminé. */
export function axisPairAt(axes: number[], tickIndex: number): [number, number] | null {
  const i = tickIndex * 2;
  if (i + 1 >= axes.length) return null;
  return [dequantizeAxis(axes[i]), dequantizeAxis(axes[i + 1])];
}

export class ReplayPlayer {
  private world: World;
  private tickIndex = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private raf: number | null = null;
  private stopped = false;

  constructor(
    private data: ReplayData,
    private handlers: ReplayHandlers,
  ) {
    const config: MatchConfig = {
      arena: data.arena,
      target: data.target,
      powerups: data.powerups,
      bot: data.bot,
      botLevel: data.botLevel,
    };
    this.world = createWorld(config, data.seed);
  }

  start(): void {
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  stop(): void {
    this.stopped = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
  }

  private frame(now: number): void {
    if (this.stopped) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.accumulator += dt;

    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      const pair = axisPairAt(this.data.axes, this.tickIndex);
      if (!pair) {
        this.stop();
        this.handlers.onDone();
        return;
      }
      stepWorld(this.world, pair);
      this.tickIndex++;
      if (this.world.events.length) {
        this.handlers.onEvents([...this.world.events]);
        this.world.events.length = 0;
      }
    }

    this.handlers.onFrame(this.world, dt);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
}

/** Décode les axes reçus en base64 vers des octets signés (-127..127). */
function decodeAxes(base64: string): number[] {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return Array.from(new Int8Array(bytes.buffer));
}

export async function fetchReplay(matchId: number): Promise<ReplayData> {
  const res = await fetch(`/api/replays/${matchId}`);
  if (!res.ok) throw new Error(`replay introuvable (${res.status})`);
  const body = (await res.json()) as {
    arena: ArenaId;
    target: number;
    powerups: boolean;
    bot: boolean;
    botLevel: Difficulty;
    seed: number;
    axes: string;
  };
  return { ...body, axes: decodeAxes(body.axes) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/client && node --run test -- replay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/net/replay.ts packages/client/test/replay.test.ts
git commit -m "Lecteur de replay client : axisPairAt, ReplayPlayer, fetchReplay"
```

---

### Task 9: Interface — panneau Replays, barre de lecture, bouton Revoir

**Files:**
- Modify: `packages/client/index.html`
- Modify: `packages/client/src/style.css`

**Interfaces:**
- Produces: éléments DOM `#btn-replays`, `#panel-replays`, `#table-replays`,
  `#replay-note`, `#btn-close-replays`, `#btn-watch-replay` (sur `#panel-over`),
  `#replay-bar`, `#btn-stop-replay`. Consommés par Task 10 (`shell.ts`) et Task 11
  (`main.ts`).

- [ ] **Step 1: Ajouter le bouton d'en-tête**

Dans `packages/client/index.html`, dans le `<div class="row">` de l'en-tête (celui qui
contient déjà `#btn-sound`, `#btn-themes`, `#btn-board`, `#btn-leave`), ajouter un bouton
entre `#btn-board` et `#btn-leave` :

```html
        <button class="btn mini" id="btn-replays">Replays</button>
```

- [ ] **Step 2: Ajouter le bouton « Revoir » sur l'écran de fin de partie**

Dans la section `#panel-over`, remplacer la `<div class="row">` existante :

```html
        <div class="row">
          <button class="btn primary" id="btn-rematch">Revanche</button>
          <button class="btn" id="btn-watch-replay" hidden>Revoir le replay</button>
          <button class="btn" id="btn-back-menu">Retour au menu</button>
        </div>
```

- [ ] **Step 3: Ajouter le panneau Replays**

Juste après la fermeture de `#panel-leaderboard` (`</section>`, avant `</div>` qui ferme
`.screen`), ajouter :

```html
      <section class="panel" id="panel-replays" aria-label="Replays">
        <p class="ptitle">Replays</p>
        <div class="tscroll"><table id="table-replays"></table></div>
        <p class="psub" id="replay-note"></p>
        <div class="row"><button class="btn" id="btn-close-replays">Fermer</button></div>
      </section>
```

- [ ] **Step 4: Ajouter la barre de lecture**

À l'intérieur de `.screen`, juste après `<canvas id="game" ...>` (avant
`<div class="scanlines" ...>`), ajouter :

```html
      <div class="replay-bar" id="replay-bar" hidden>
        <span>Lecture du replay</span>
        <button class="btn mini" id="btn-stop-replay">Quitter le replay</button>
      </div>
```

- [ ] **Step 5: Styler la barre de lecture**

Dans `packages/client/src/style.css`, juste après le bloc `.screen { ... }` (avant le
commentaire sur `.scanlines`), ajouter :

```css
.replay-bar {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; padding: 6px 14px; z-index: 2;
  background: color-mix(in srgb, var(--ink-dark) 80%, transparent);
  border: 1px solid var(--hall-line); border-radius: var(--radius);
  font-family: var(--display); font-size: 13px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--ink);
}
.replay-bar[hidden] { display: none; }
```

- [ ] **Step 6: Vérifier visuellement**

Run: `cd packages/client && node --run build` (ou `node --run dev` pour un aperçu en
direct).
Expected: build sans erreur ; les nouveaux éléments n'apparaissent pas tant qu'ils ne
sont pas pilotés par du JavaScript (Task 10/11) — c'est attendu à ce stade, `#panel-replays`
n'a pas la classe `.on` et `#replay-bar`/`#btn-watch-replay` ont `hidden`.

- [ ] **Step 7: Commit**

```bash
git add packages/client/index.html packages/client/src/style.css
git commit -m "Interface du rejeu de partie : panneau, barre de lecture, bouton Revoir"
```

---

### Task 10: Câblage `shell.ts`

**Files:**
- Modify: `packages/client/src/ui/shell.ts`

**Interfaces:**
- Consumes: éléments DOM de Task 9.
- Produces:
  - `ShellHandlers` gagne `onOpenReplays(): void` et `onWatchReplay(matchId: number): void`.
  - `showPanel`'s `opts` gagne `matchId?: number` (affiche/masque et câble
    `#btn-watch-replay` sur l'écran de fin).
  - `renderReplayList(rows: ReplayListRow[] | null): void`, exportée — appelée par
    `main.ts` (Task 11) avec la réponse de `/api/matches`.
  - `PanelName` gagne `'replays'`.

Pas de test dédié à ce câblage DOM — suit la convention déjà en place pour
`renderLeaderboard`/`renderRoom`, non testées unitairement, vérifiées en navigateur réel
(Task 12). `shell.test.ts` existant continue de passer sans modification : aucune des
liaisons ajoutées ne change le comportement des boutons déjà testés.

- [ ] **Step 1: Étendre les types**

Dans `packages/client/src/ui/shell.ts`, modifier la ligne `type PanelName` :

```typescript
type PanelName = 'menu' | 'over' | 'error' | 'leaderboard' | 'themes' | 'replays' | null;
```

Ajouter à l'interface `ShellHandlers` (après `onOpenLeaderboard(): void;`) :

```typescript
  onOpenReplays(): void;
  onWatchReplay(matchId: number): void;
```

Ajouter une nouvelle interface, à la suite de `LeaderRow` :

```typescript
export interface ReplayListRow {
  match_id: number;
  played_at: string;
  arena: string;
  left_name: string;
  left_score: number;
  right_name: string;
  right_score: number;
  has_replay: number;
}
```

- [ ] **Step 2: Câbler les boutons**

Dans `initShell`, ajouter à la suite du câblage de `#btn-board`/`#btn-close-board` :

```typescript
  el<HTMLButtonElement>('#btn-replays').onclick = () => {
    handlers.onOpenReplays();
    showPanel('replays');
  };
  el<HTMLButtonElement>('#btn-close-replays').onclick = () => showPanel('menu');
```

- [ ] **Step 3: Afficher le bouton Revoir sur l'écran de fin**

Modifier la signature de `showPanel` :

```typescript
export function showPanel(
  name: PanelName,
  opts?: { title?: string; detail?: string; isHost?: boolean; matchId?: number },
): void {
```

Dans le bloc `if (name === 'over') { ... }` existant, ajouter à la suite de la ligne sur
`#btn-rematch` :

```typescript
    const watchBtn = el<HTMLButtonElement>('#btn-watch-replay');
    watchBtn.hidden = opts?.matchId === undefined;
    watchBtn.onclick = () => {
      if (opts?.matchId !== undefined) handlers.onWatchReplay(opts.matchId);
    };
```

- [ ] **Step 4: Ajouter `renderReplayList`**

Après la fonction `renderLeaderboard`, ajouter :

```typescript
export function renderReplayList(rows: ReplayListRow[] | null): void {
  const table = el<HTMLTableElement>('#table-replays');
  const note = el<HTMLElement>('#replay-note');
  if (!rows) {
    table.innerHTML = '';
    note.textContent = 'Liste indisponible : le serveur ne répond pas.';
    return;
  }
  if (rows.length === 0) {
    table.innerHTML = '';
    note.textContent = 'Aucun match enregistré.';
    return;
  }
  table.innerHTML = `
    <thead><tr><th>Match</th><th>Score</th><th></th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.left_name)} vs ${escapeHtml(r.right_name)}</td>
          <td>${r.left_score}–${r.right_score}</td>
          <td>${r.has_replay ? `<button class="btn mini" data-match-id="${r.match_id}">Revoir</button>` : ''}</td>
        </tr>`,
      )
      .join('')}</tbody>`;
  note.textContent = 'Un replay disponible se rejoue à l\'identique, image par image.';
  for (const btn of table.querySelectorAll<HTMLButtonElement>('button[data-match-id]')) {
    btn.onclick = () => handlers.onWatchReplay(Number(btn.dataset.matchId));
  }
}
```

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `cd packages/client && node --run test -- shell.test.ts`
Expected: PASS — les 8 tests existants passent toujours (aucun ne couvre les nouveaux
éléments, mais aucun changement ne touche le comportement qu'ils vérifient).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/ui/shell.ts
git commit -m "shell.ts : câblage du panneau Replays et du bouton Revoir"
```

---

### Task 11: Câblage `main.ts`

**Files:**
- Modify: `packages/client/src/main.ts`

**Interfaces:**
- Consumes: `ReplayPlayer`, `fetchReplay` (Task 8), `worldSnapshot` (Task 2),
  `onOpenReplays`/`onWatchReplay`/`renderReplayList` (Task 10), `payload.matchId` sur
  `onOver` (Task 3/6).

Pas de test unitaire dédié (le fichier `main.ts` n'a jamais eu de test dans ce projet —
c'est du câblage DOM/réseau au sens le plus direct). Vérifié en navigateur réel à la
Task 12.

- [ ] **Step 1: Importer les nouveaux modules**

Dans `packages/client/src/main.ts`, ajouter `worldSnapshot` à l'import depuis
`@neon-pong/shared` (liste existante), et ajouter une nouvelle ligne d'import :

```typescript
import { ReplayPlayer, fetchReplay } from './net/replay.js';
```

Et étendre l'import depuis `./ui/shell.js` pour inclure `renderReplayList` :

```typescript
import { el, initShell, renderLeaderboard, renderReplayList, renderRoom, setHudEffects, setStatus, showPanel } from './ui/shell.js';
```

- [ ] **Step 2: Ajouter l'état de lecture**

À la suite de la déclaration de `visualOffset`, ajouter :

```typescript
/** Vrai pendant la lecture d'un replay : la boucle réseau ne se replanifie pas. */
let replaying = false;
let replayPlayer: ReplayPlayer | null = null;
```

- [ ] **Step 3: Capturer le `matchId` de fin de match**

Dans le handler `onOver` du `Connection`, remplacer l'appel à `showPanel('over', {...})`
pour y ajouter `matchId` :

```typescript
    onOver: (payload) => {
      const [left, right] = payload.names;
      const winnerName = payload.winner === 0 ? left : right;
      showPanel('over', {
        title: `${winnerName} gagne ${payload.scores[payload.winner]}–${payload.scores[1 - payload.winner]}`,
        detail: `Plus long échange : ${payload.bestRally} frappes`,
        isHost: room?.hostId === conn.playerId,
        matchId: payload.matchId,
      });
      sound.play({ t: 'over', winner: payload.winner, scores: payload.scores, bestRally: payload.bestRally });
      void refreshLeaderboard();
    },
```

- [ ] **Step 4: Adapter la boucle `frame()` pour se suspendre pendant un replay**

Remplacer la dernière ligne de `frame()` (`requestAnimationFrame(frame);`) par :

```typescript
  if (!replaying) requestAnimationFrame(frame);
```

- [ ] **Step 5: Ajouter les fonctions de démarrage/arrêt du replay**

Après la fonction `refreshLeaderboard`, ajouter :

```typescript
async function refreshReplayList(): Promise<void> {
  try {
    const res = await fetch('/api/matches?limit=20');
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { rows: Parameters<typeof renderReplayList>[0] };
    renderReplayList(body.rows);
  } catch {
    renderReplayList(null);
  }
}

async function startReplay(matchId: number): Promise<void> {
  // Regarder un replay quitte toute partie en cours : les deux simulations ne
  // peuvent pas se partager le rendu.
  conn.disconnect();
  localPaddleY = null;
  localSide = null;
  room = null;
  visualOffset = 0;

  const data = await fetchReplay(matchId);
  replaying = true;
  showPanel(null);
  el<HTMLElement>('#replay-bar').hidden = false;

  replayPlayer = new ReplayPlayer(data, {
    onFrame: (world, dt) => {
      renderer.draw(
        {
          localPaddleY: null,
          localSide: null,
          arena: world.config.arena,
          snapshot: worldSnapshot(world),
          lerp: null,
          arenaTime: world.tick * TICK_DT,
          countdownLabel: null,
        },
        dt,
      );
    },
    onEvents: (events) => renderer.handleEvents(events, (e) => sound.play(e)),
    onDone: () => stopReplay(),
  });
  replayPlayer.start();
}

function stopReplay(): void {
  replayPlayer?.stop();
  replayPlayer = null;
  replaying = false;
  el<HTMLElement>('#replay-bar').hidden = true;
  showPanel('menu');
  requestAnimationFrame(frame);
}
```

- [ ] **Step 6: Câbler le bouton d'arrêt et les handlers du shell**

Dans `packages/client/index.html`, le bouton `#btn-stop-replay` existe déjà (Task 9) mais
n'est câblé par aucun module dédié à un panneau — l'ajouter directement dans `main.ts`,
juste avant `initShell({...})` :

```typescript
el<HTMLButtonElement>('#btn-stop-replay').onclick = () => stopReplay();
```

Dans l'appel à `initShell({...})`, ajouter les deux nouveaux handlers (après
`onOpenLeaderboard`) :

```typescript
  onOpenReplays: () => void refreshReplayList(),
  onWatchReplay: (matchId) => void startReplay(matchId),
```

- [ ] **Step 7: Vérifier la compilation**

Run: `cd /path/to/neon-pong && node --run typecheck`
Expected: succès sur les trois paquets.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/main.ts
git commit -m "main.ts : démarrage/arrêt de la lecture de replay"
```

---

### Task 12: Vérification de bout en bout

**Files:** aucun (vérification uniquement).

- [ ] **Step 1: Suite de tests complète**

Run (depuis la racine) :
```bash
node --run typecheck
cd packages/shared && node --run test
cd ../server && node --run test
cd ../client && node --run test -- shell.test.ts renderer.test.ts reconcile.test.ts connection.test.ts replay.test.ts
```
Expected: tout PASS. (`theme-panel.test.ts` échoue déjà pour une raison préexistante et
sans rapport, documentée dans ce projet — ne pas s'en inquiéter.)

- [ ] **Step 2: Build de production**

Run: `cd /path/to/neon-pong && node --run build`
Expected: succès, `packages/client/dist` régénéré.

- [ ] **Step 3: Vérification manuelle en navigateur réel**

Démarrer le serveur en local sur un port libre (vérifier d'abord qu'il est libre avec
`lsof -nP -iTCP -sTCP:LISTEN`), avec une base en mémoire :
```bash
HOST=127.0.0.1 PORT=<port libre> ALLOWED_ORIGINS="" DB_PATH=":memory:" node packages/server/dist/index.js
```
Dans un navigateur (ou piloté via les outils disponibles) :
1. Lancer une partie solo contre l'IA, la jouer jusqu'à son terme (le bot marque
   suffisamment de points face à une raquette immobile).
2. Sur l'écran de fin, vérifier que le bouton « Revoir le replay » est visible et
   fonctionnel : cliquer dessus doit lancer la lecture (la barre « Lecture du replay »
   apparaît, le point se rejoue).
3. Cliquer sur « Quitter le replay » : retour au menu, le bouton « Jouer contre l'IA »
   doit permettre de relancer une partie normalement (la boucle réseau doit avoir repris).
4. Ouvrir le panneau « Replays » depuis l'en-tête : le match qui vient d'être joué doit y
   apparaître avec un bouton « Revoir ».
5. Vérifier dans la console du navigateur qu'aucune erreur n'apparaît pendant tout ce
   parcours.

Expected: les cinq points ci-dessus se vérifient sans erreur console ni comportement
inattendu.

- [ ] **Step 4: Nettoyage**

Arrêter le serveur de test et fermer toute session de navigateur ouverte pour cette
vérification.
