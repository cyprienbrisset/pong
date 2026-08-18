import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncCtor } from 'node:sqlite';
import { dirname } from 'node:path';
import type { Theme } from '@neon-pong/shared';
import { config } from './config.js';
import { computeEloRatings } from './elo.js';
import { logger } from './logger.js';

/**
 * Persistance via le module SQLite intégré à Node : aucune dépendance native à
 * recompiler au déploiement. L'accès passe par ce dépôt et nulle part ailleurs,
 * de sorte qu'un basculement vers Postgres ne toucherait que ce fichier.
 *
 * Aucune donnée personnelle n'est stockée : un pseudonyme choisi par le joueur,
 * et rien d'autre. Pas d'adresse IP, pas d'e-mail, pas d'identifiant persistant
 * imposé.
 */

export interface LeaderboardRow {
  name: string;
  matches: number;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
  best_rally: number;
  win_rate: number;
  point_diff: number;
  /** Elo recalculé sur tout l'historique (K=24, base 1200) : classe par niveau, pas par volume. */
  rating: number;
}

export interface MatchRecord {
  arena: string;
  target: number;
  powerups: boolean;
  bestRally: number;
  players: { name: string; side: 0 | 1; score: number; bot: boolean; won: boolean }[];
}

/**
 * `node:sqlite` est chargé par require() plutôt que par un import statique :
 * certains outils de build (Vite, utilisé par Vitest) ne connaissent pas encore
 * ce module natif et tentent de le résoudre sur le disque. L'import de type
 * ci-dessus est effacé à la compilation, le typage reste donc complet.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncCtor;
};

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  played_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  arena       TEXT    NOT NULL,
  target      INTEGER NOT NULL,
  powerups    INTEGER NOT NULL,
  best_rally  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id  INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  name      TEXT    NOT NULL,
  side      INTEGER NOT NULL,
  score     INTEGER NOT NULL,
  is_bot    INTEGER NOT NULL,
  won       INTEGER NOT NULL,
  PRIMARY KEY (match_id, side)
);

CREATE INDEX IF NOT EXISTS idx_match_players_name ON match_players(name);
CREATE INDEX IF NOT EXISTS idx_matches_played_at ON matches(played_at DESC);

CREATE TABLE IF NOT EXISTS themes (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  author     TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
`;

export class Store {
  private db: InstanceType<typeof DatabaseSyncCtor>;
  private insertMatch;
  private insertPlayer;
  private leaderboardStmt;
  private historyStmt;
  private recentStmt;
  private upsertThemeStmt;
  private listThemesStmt;
  private countThemesStmt;
  private deleteThemeStmt;

  constructor(path = config.dbPath) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);

    this.insertMatch = this.db.prepare(
      `INSERT INTO matches (arena, target, powerups, best_rally) VALUES (?, ?, ?, ?)`,
    );
    this.insertPlayer = this.db.prepare(
      `INSERT INTO match_players (match_id, name, side, score, is_bot, won) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // Les bots sont exclus du classement : il récompense les collègues.
    this.leaderboardStmt = this.db.prepare(`
      SELECT
        mp.name                                        AS name,
        COUNT(*)                                       AS matches,
        SUM(mp.won)                                    AS wins,
        COUNT(*) - SUM(mp.won)                         AS losses,
        SUM(mp.score)                                  AS points_for,
        SUM(opp.score)                                 AS points_against,
        MAX(m.best_rally)                              AS best_rally,
        ROUND(1.0 * SUM(mp.won) / COUNT(*), 4)         AS win_rate,
        SUM(mp.score) - SUM(opp.score)                 AS point_diff
      FROM match_players mp
      JOIN matches m         ON m.id = mp.match_id
      JOIN match_players opp ON opp.match_id = mp.match_id AND opp.side <> mp.side
      WHERE mp.is_bot = 0
      GROUP BY mp.name
    `);
    // Historique chronologique complet, tous participants (bots compris) : sert
    // uniquement à rejouer l'Elo, jamais affiché tel quel.
    this.historyStmt = this.db.prepare(`
      SELECT m.id                                          AS match_id,
             MAX(CASE WHEN mp.side = 0 THEN mp.name END)    AS name0,
             MAX(CASE WHEN mp.side = 0 THEN mp.won  END)    AS won0,
             MAX(CASE WHEN mp.side = 1 THEN mp.name END)    AS name1,
             MAX(CASE WHEN mp.side = 1 THEN mp.won  END)    AS won1
      FROM matches m JOIN match_players mp ON mp.match_id = m.id
      GROUP BY m.id
      ORDER BY m.id ASC
    `);
    this.recentStmt = this.db.prepare(`
      SELECT m.played_at, m.arena, m.best_rally,
             MAX(CASE WHEN mp.side = 0 THEN mp.name END)  AS left_name,
             MAX(CASE WHEN mp.side = 0 THEN mp.score END) AS left_score,
             MAX(CASE WHEN mp.side = 1 THEN mp.name END)  AS right_name,
             MAX(CASE WHEN mp.side = 1 THEN mp.score END) AS right_score
      FROM matches m JOIN match_players mp ON mp.match_id = m.id
      GROUP BY m.id
      ORDER BY m.played_at DESC, m.id DESC
      LIMIT ?
    `);

    // La charte est stockée sérialisée : le schéma d'un thème évolue vite, et une
    // colonne par jeton transformerait chaque ajout en migration.
    this.upsertThemeStmt = this.db.prepare(`
      INSERT INTO themes (id, name, author, payload) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        payload = excluded.payload,
        updated_at = datetime('now')
      WHERE themes.author = excluded.author
    `);
    this.listThemesStmt = this.db.prepare(
      `SELECT id, name, author, payload, updated_at FROM themes ORDER BY updated_at DESC LIMIT ?`,
    );
    this.countThemesStmt = this.db.prepare(`SELECT COUNT(*) AS n FROM themes`);
    this.deleteThemeStmt = this.db.prepare(`DELETE FROM themes WHERE id = ? AND author = ?`);

    logger.info({ path }, 'base de données prête');
  }

  recordMatch(rec: MatchRecord): void {
    // Une transaction : un match est enregistré entier ou pas du tout.
    this.db.exec('BEGIN');
    try {
      const res = this.insertMatch.run(
        rec.arena,
        rec.target,
        rec.powerups ? 1 : 0,
        rec.bestRally,
      );
      const matchId = Number(res.lastInsertRowid);
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
  }

  /**
   * Trié par Elo, pas par nombre brut de victoires : un joueur qui accumule les
   * matchs à faible taux de victoire ne doit pas dépasser un joueur régulier
   * qui en joue moins. L'Elo est recalculé à rebours sur tout l'historique à
   * chaque appel — largement suffisant au volume d'une équipe.
   */
  leaderboard(limit = 50): LeaderboardRow[] {
    const rows = this.leaderboardStmt.all() as unknown as Omit<LeaderboardRow, 'rating'>[];
    const history = this.historyStmt.all() as unknown as {
      match_id: number;
      name0: string;
      won0: number;
      name1: string;
      won1: number;
    }[];
    const ratings = computeEloRatings(
      history.map((h) => ({ playerA: h.name0, playerB: h.name1, winner: h.won0 ? ('a' as const) : ('b' as const) })),
    );

    return rows
      .map((r) => ({ ...r, rating: Math.round(ratings.get(r.name) ?? 1200) }))
      .sort((a, b) => b.rating - a.rating || b.point_diff - a.point_diff || a.matches - b.matches)
      .slice(0, limit);
  }

  recentMatches(limit = 20) {
    return this.recentStmt.all(limit) as unknown as Record<string, unknown>[];
  }

  /* ---------------- chartes partagées ---------------- */

  /**
   * Enregistre une charte. La clause `WHERE themes.author = excluded.author`
   * fait office de contrôle d'accès du pauvre : sans compte utilisateur, seul le
   * pseudonyme qui a créé une charte peut la modifier. C'est fragile — un
   * homonyme volontaire passerait — mais proportionné à un jeu interne. Une
   * authentification réelle changerait cette ligne, pas le reste.
   */
  saveTheme(theme: Theme, author: string): 'created' | 'updated' | 'forbidden' {
    const existing = this.themeAuthor(theme.id);
    if (existing !== null && existing !== author) return 'forbidden';
    this.upsertThemeStmt.run(theme.id, theme.name, author, JSON.stringify(theme));
    return existing === null ? 'created' : 'updated';
  }

  themeAuthor(id: string): string | null {
    const row = this.db.prepare(`SELECT author FROM themes WHERE id = ?`).get(id) as
      | { author: string }
      | undefined;
    return row?.author ?? null;
  }

  /** Les charges utiles illisibles sont ignorées plutôt que de casser la liste. */
  listThemes(limit = 100): { theme: unknown; author: string; updatedAt: string }[] {
    const rows = this.listThemesStmt.all(limit) as unknown as {
      author: string;
      payload: string;
      updated_at: string;
    }[];
    const out: { theme: unknown; author: string; updatedAt: string }[] = [];
    for (const row of rows) {
      try {
        out.push({ theme: JSON.parse(row.payload), author: row.author, updatedAt: row.updated_at });
      } catch {
        logger.warn({ author: row.author }, 'charte illisible ignorée');
      }
    }
    return out;
  }

  themeCount(): number {
    return Number((this.countThemesStmt.get() as { n: number }).n);
  }

  deleteTheme(id: string, author: string): boolean {
    const before = this.themeAuthor(id);
    if (before === null || before !== author) return false;
    this.deleteThemeStmt.run(id, author);
    return true;
  }

  close(): void {
    this.db.close();
  }
}
