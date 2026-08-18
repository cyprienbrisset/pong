import {
  ARENA_IDS,
  DEFAULT_CONFIG,
  SNAPSHOT_EVERY,
  TICK_DT,
  TICK_HZ,
  createWorld,
  encodeSnapshot,
  makeSeed,
  stepWorld,
} from '@neon-pong/shared';
import type {
  ArenaId,
  Difficulty,
  GameEvent,
  MatchConfig,
  RoomView,
  ServerControl,
  Side,
  World,
} from '@neon-pong/shared';
import { Bot } from './bot.js';
import type { Store } from './db.js';
import { logger } from './logger.js';

/** Cinq ticks de retard (~83 ms à 60 Hz) : au-delà, le rattrapage devient visible. */
const STALL_THRESHOLD_S = 5 * TICK_DT;

/**
 * Un Wi-Fi de bureau qui hoquette deux secondes ne doit pas invalider un
 * match ni faire reprendre la raquette par un bot. Quinze secondes laissent
 * le temps à une reconnexion automatique de reprendre le même siège.
 */
const GRACE_MS = 15_000;

interface GraceSeat {
  side: Side;
  name: string;
  timer: NodeJS.Timeout;
}

export interface Client {
  id: string;
  name: string;
  side: Side | null;
  /** Dernier axe reçu, appliqué tel quel au prochain tick. */
  axis: number;
  /** Dernière séquence d'entrée acquittée, renvoyée dans les snapshots. */
  ackSeq: number;
  rttMs: number;
  connected: boolean;
  sendBinary(data: ArrayBuffer): void;
  sendJson(msg: ServerControl): void;
  close(): void;
}

/**
 * Une salle possède sa boucle de simulation. Elle est autoritative : les
 * clients n'envoient que des intentions de déplacement, jamais des positions.
 *
 * La boucle utilise un accumulateur plutôt qu'un setInterval nu : si le
 * processus est ralenti (garbage collector, sauvegarde SQLite), on rattrape les
 * ticks manqués au lieu de laisser la partie glisser au ralenti.
 */
export class Room {
  readonly code: string;
  config: MatchConfig;
  hostId: string | null = null;
  world: World;
  clients = new Map<string, Client>();
  private bot: Bot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private accumulator = 0;
  private lastTime = 0;
  private startedAt = Date.now();
  private emptySince: number | null = Date.now();
  private recorded = false;
  /**
   * Vrai si un joueur humain a quitté sa place en cours de manche. Le match ira
   * alors au bout (un bot reprend la raquette) mais ne sera pas enregistré :
   * un abandon ne doit pas polluer le classement de l'équipe.
   */
  private abandoned = false;
  /** Noms au coup d'envoi : un joueur qui part ne doit pas fausser l'archive. */
  private seatNames: [string, string] = ['—', '—'];
  /** Siège réservé le temps d'une reconnexion, au plus un à la fois (deux sièges). */
  private grace: GraceSeat | null = null;
  /**
   * Vrai une fois que la manche a réellement commencé à jouer. Reste faux tant
   * que les deux camps ne sont pas occupés (un humain, ou un bot) — sans ça,
   * l'hôte pouvait accumuler des points contre un siège vide avant même
   * l'arrivée d'un adversaire.
   */
  private matchStarted = false;

  constructor(
    code: string,
    config: Partial<MatchConfig>,
    private store: Store,
    private onEmpty: (room: Room) => void,
  ) {
    this.code = code;
    this.config = sanitizeConfig(config);
    this.world = createWorld(this.config, makeSeed());
    this.syncBot();
  }

  /* ---------------- sièges ---------------- */

  get seats(): (Client | null)[] {
    const seats: (Client | null)[] = [null, null];
    for (const c of this.clients.values()) if (c.side !== null) seats[c.side] = c;
    return seats;
  }

  get playerCount(): number {
    return this.seats.filter(Boolean).length;
  }

  get connectedCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.connected) n++;
    return n;
  }

  join(client: Client): Side | null {
    if (this.grace && this.grace.name === client.name) {
      // Même pseudonyme, même salle, dans le délai : on considère que c'est
      // la même personne qui revient — rien n'a bougé côté simulation.
      clearTimeout(this.grace.timer);
      const side = this.grace.side;
      this.grace = null;
      logger.info({ room: this.code, client: client.id, side }, 'client reprend sa place après coupure');
      return this.seat(client, side);
    }

    const seats = this.seats;
    const side0Free = !seats[0] && this.grace?.side !== 0;
    const side1Free = !seats[1] && this.grace?.side !== 1;
    let side: Side | null = null;
    if (side0Free) side = 0;
    else if (side1Free && !this.config.bot) side = 1;
    else if (side1Free && this.config.bot) {
      // Un humain qui arrive prend la place du bot : c'est le comportement
      // attendu quand un collègue rejoint une partie solo en cours.
      side = 1;
      this.config = { ...this.config, bot: false };
      this.syncBot();
    }
    logger.info({ room: this.code, client: client.id, side }, 'client rejoint la salle');
    return this.seat(client, side);
  }

  private seat(client: Client, side: Side | null): Side | null {
    client.side = side;
    this.clients.set(client.id, client);
    if (!this.hostId) this.hostId = client.id;
    this.emptySince = null;
    this.refreshSeatNames();
    this.broadcastRoom();
    // Tant que la manche n'a pas démarré (un siège encore vide), aucun tick ne
    // tourne et broadcastSnapshot() n'est donc jamais appelé depuis la boucle —
    // sans cet envoi immédiat, le client n'aurait rien à afficher du tout, pas
    // même le message d'attente.
    if (!this.matchStarted) this.broadcastSnapshot();
    if (!this.timer) this.start();
    return side;
  }

  leave(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);
    logger.info({ room: this.code, client: clientId }, 'client quitte la salle');
    if (this.hostId === clientId) {
      this.hostId = this.clients.keys().next().value ?? null;
    }
    // Un siège libéré pendant une partie reste réservé le temps d'un délai de
    // grâce : une coupure réseau de quelques secondes ne doit ni faire
    // reprendre la raquette par un bot, ni invalider le match tout de suite.
    if (client.side !== null && this.world.status !== 'over') {
      const side = client.side;
      const name = client.name;
      this.grace = { side, name, timer: setTimeout(() => this.expireGrace(side), GRACE_MS) };
    }
    if (this.clients.size === 0) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  /** Personne n'est revenu à temps : on retombe sur le comportement d'un abandon. */
  private expireGrace(side: Side): void {
    if (!this.grace || this.grace.side !== side) return;
    this.grace = null;
    this.abandoned = true;
    if (side === 1) {
      this.config = { ...this.config, bot: true };
      this.syncBot();
    }
    this.refreshSeatNames();
    this.broadcastRoom();
    logger.info({ room: this.code, side }, 'délai de grâce expiré, siège libéré');
  }

  private refreshSeatNames(): void {
    const seats = this.seats;
    this.seatNames = [
      seats[0]?.name ?? this.seatNames[0],
      seats[1]?.name ?? (this.config.bot ? (this.bot?.label ?? 'IA') : this.seatNames[1]),
    ];
  }

  /* ---------------- réglages ---------------- */

  updateConfig(clientId: string, patch: Partial<MatchConfig>): void {
    if (clientId !== this.hostId) return;
    this.config = sanitizeConfig({ ...this.config, ...patch });
    this.syncBot();
    // Les réglages ne s'appliquent qu'à la manche suivante, sinon on changerait
    // les règles au milieu d'un échange.
    if (this.world.status === 'over') this.resetWorld();
    this.refreshSeatNames();
    this.broadcastRoom();
  }

  rematch(clientId: string): void {
    if (clientId !== this.hostId || this.world.status !== 'over') return;
    this.resetWorld();
    this.broadcastRoom();
  }

  private resetWorld(): void {
    this.world = createWorld(this.config, makeSeed());
    this.recorded = false;
    this.abandoned = false;
    this.matchStarted = false;
    this.startedAt = Date.now();
    this.syncBot();
  }

  private syncBot(): void {
    this.bot = this.config.bot ? new Bot(1, this.config.botLevel) : null;
  }

  /** Le siège 0 est occupé, et le siège 1 est occupé ou tenu par un bot. */
  private get readyToStart(): boolean {
    const seats = this.seats;
    return !!seats[0] && (!!seats[1] || this.config.bot);
  }

  /* ---------------- boucle ---------------- */

  private start(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
    // On échantillonne plus vite que le tick pour limiter la gigue induite par
    // la granularité de setInterval.
    this.timer = setInterval(() => this.pump(), 1000 / (TICK_HZ * 2));
    logger.info({ room: this.code }, 'boucle de simulation démarrée');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pump(): void {
    // Aucun spectateur, aucun joueur : on gèle la simulation. Sans cela une
    // salle désertée continuerait à consommer du CPU et pourrait même conclure
    // un match fantôme.
    if (this.connectedCount === 0) {
      this.lastTime = performance.now();
      this.accumulator = 0;
      if (this.emptySince === null) this.emptySince = Date.now();
      return;
    }

    // La manche ne démarre pas tant que les deux camps ne sont pas occupés :
    // sans ce garde-fou, l'hôte marquait des points contre un siège vide avant
    // même l'arrivée d'un adversaire.
    if (!this.matchStarted) {
      if (!this.readyToStart) {
        this.lastTime = performance.now();
        this.accumulator = 0;
        return;
      }
      this.matchStarted = true;
    }

    const now = performance.now();
    let delta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Diagnostic : un retard au-delà de quelques ticks trahit un arrêt du
    // processus (GC majeur, CPU volé par un voisin de VM, appel synchrone
    // bloquant) — c'est le mécanisme derrière un saut de raquette visible côté
    // client, qui rattrape alors plusieurs ticks d'un coup.
    if (delta > STALL_THRESHOLD_S) {
      logger.warn({ room: this.code, stallMs: Math.round(delta * 1000) }, 'boucle de simulation en retard');
    }
    // Au-delà d'un demi-seconde de retard (mise en veille, saturation), on
    // abandonne le rattrapage : mieux vaut un saut visible qu'une accélération.
    if (delta > 0.5) delta = TICK_DT;
    this.accumulator += delta;

    let ticks = 0;
    while (this.accumulator >= TICK_DT && ticks < 8) {
      this.tick();
      this.accumulator -= TICK_DT;
      ticks++;
    }

    if (this.clients.size === 0 && this.emptySince === null) this.emptySince = Date.now();
  }

  private tick(): void {
    const seats = this.seats;
    const axes: [number, number] = [
      seats[0]?.axis ?? 0,
      this.bot ? this.bot.think(this.world) : (seats[1]?.axis ?? 0),
    ];

    stepWorld(this.world, axes);

    if (this.world.events.length) {
      this.dispatchEvents(this.world.events);
      this.world.events.length = 0;
    }

    if (this.world.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  private dispatchEvents(events: GameEvent[]): void {
    // Les événements sont envoyés en JSON : ils sont rares et servent au son et
    // aux particules, un décalage d'un tick n'a aucune importance.
    const payload: ServerControl = { t: 'event', events: [...events] };
    for (const c of this.clients.values()) if (c.connected) c.sendJson(payload);

    const over = events.find((e) => e.t === 'over');
    if (over && over.t === 'over') this.finish(over.winner, over.scores, over.bestRally);
  }

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
    const seats = this.seats;

    for (const c of this.clients.values()) {
      if (c.connected) {
        c.sendJson({ t: 'over', winner, scores, bestRally, names: this.seatNames });
      }
    }

    if (this.abandoned) {
      logger.info({ room: this.code, scores }, 'match abandonné : non enregistré');
      return;
    }

    try {
      this.store.recordMatch({
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
    } catch (err) {
      // Un échec d'écriture ne doit jamais interrompre une partie en cours.
      logger.error({ err, room: this.code }, 'match non enregistré');
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

  private broadcastSnapshot(): void {
    const serverMs = Math.round(performance.now());
    for (const c of this.clients.values()) {
      if (!c.connected) continue;
      // Chaque client reçoit son propre acquittement de séquence : c'est ce qui
      // permet à sa prédiction locale de se réconcilier.
      c.sendBinary(encodeSnapshot(this.world, c.ackSeq, serverMs));
    }
  }

  view(): RoomView {
    const seats = this.seats;
    return {
      code: this.code,
      config: this.config,
      hostId: this.hostId ?? '',
      seats: [0, 1].map((side) => {
        const c = seats[side];
        const isBot = side === 1 && this.config.bot;
        // Pendant la grâce, le siège garde le nom du joueur parti et se
        // montre « absent » — jamais « Libre » : il reste réservé, un tiers
        // ne doit pas croire qu'il peut le prendre.
        const gracing = this.grace?.side === side;
        return {
          side: side as Side,
          id: c?.id ?? (isBot ? 'bot' : ''),
          name: gracing ? this.grace!.name : (c?.name ?? (isBot ? (this.bot?.label ?? 'IA') : 'Libre')),
          bot: isBot,
          connected: gracing ? false : isBot || !!c?.connected,
          rttMs: c?.rttMs ?? 0,
        };
      }),
      spectators: [...this.clients.values()].filter((c) => c.side === null).length,
    };
  }

  broadcastRoom(): void {
    const payload: ServerControl = { t: 'room', room: this.view() };
    for (const c of this.clients.values()) if (c.connected) c.sendJson(payload);
  }

  /** Vrai si la salle est vide depuis plus longtemps que le délai autorisé. */
  isExpired(idleMs: number): boolean {
    return this.emptySince !== null && Date.now() - this.emptySince > idleMs;
  }

  dispose(): void {
    this.stop();
    if (this.grace) {
      clearTimeout(this.grace.timer);
      this.grace = null;
    }
    for (const c of this.clients.values()) c.close();
    this.clients.clear();
    this.onEmpty(this);
  }
}

/** Toute configuration venue du réseau passe par ici avant d'atteindre la simulation. */
export function sanitizeConfig(input: Partial<MatchConfig>): MatchConfig {
  const arena: ArenaId = ARENA_IDS.includes(input.arena as ArenaId)
    ? (input.arena as ArenaId)
    : DEFAULT_CONFIG.arena;
  const target = [5, 7, 11, 15].includes(Number(input.target))
    ? Number(input.target)
    : DEFAULT_CONFIG.target;
  const level = Number(input.botLevel);
  return {
    arena,
    target,
    powerups: input.powerups === undefined ? DEFAULT_CONFIG.powerups : !!input.powerups,
    bot: input.bot === undefined ? DEFAULT_CONFIG.bot : !!input.bot,
    botLevel: ([0, 1, 2, 3].includes(level) ? level : 1) as Difficulty,
  };
}
