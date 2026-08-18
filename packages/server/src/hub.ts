import type { MatchConfig } from '@neon-pong/shared';
import { config } from './config.js';
import type { Store } from './db.js';
import { logger } from './logger.js';
import { Room } from './room.js';

/** Alphabet sans caractères ambigus : on dicte ces codes à voix haute. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class Hub {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;

  constructor(private store: Store) {
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref();
  }

  get size(): number {
    return this.rooms.size;
  }

  get playerCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.clients.size;
    return n;
  }

  create(cfg: Partial<MatchConfig>): Room | null {
    if (this.rooms.size >= config.maxRooms) {
      logger.warn({ rooms: this.rooms.size }, 'plafond de salles atteint');
      return null;
    }
    const code = this.freeCode();
    const room = new Room(code, cfg, this.store, (r) => this.rooms.delete(r.code));
    this.rooms.set(code, room);
    logger.info({ room: code, rooms: this.rooms.size }, 'salle créée');
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Salles publiques joignables, pour l'écran d'accueil. */
  openRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.playerCount < 2 && r.world.status !== 'over')
      .map((r) => r.view());
  }

  private freeCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("impossible d'allouer un code de salle");
  }

  private sweep(): void {
    for (const room of [...this.rooms.values()]) {
      if (room.isExpired(config.roomIdleMs)) {
        logger.info({ room: room.code }, 'salle inactive détruite');
        room.dispose();
      }
    }
  }

  shutdown(): void {
    clearInterval(this.sweeper);
    for (const room of [...this.rooms.values()]) room.dispose();
  }
}
