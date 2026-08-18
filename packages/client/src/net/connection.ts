import {
  INTERP_DELAY_MS,
  MSG,
  TICK_DT,
  decodePong,
  decodeSnapshot,
  encodeInput,
  encodePing,
  messageType,
} from '@neon-pong/shared';
import type {
  ClientControl,
  GameEvent,
  MatchConfig,
  RoomView,
  ServerControl,
  Side,
  Snapshot,
} from '@neon-pong/shared';

export interface NetHandlers {
  onWelcome(playerId: string, side: Side | null, room: RoomView): void;
  onRoom(room: RoomView): void;
  onEvents(events: GameEvent[]): void;
  onOver(payload: Extract<ServerControl, { t: 'over' }>): void;
  onError(payload: Extract<ServerControl, { t: 'error' }>): void;
  onStatus(status: 'connecting' | 'open' | 'closed'): void;
}

/**
 * Tampon d'interpolation.
 *
 * Le client affiche volontairement le passé : il rend l'état du monde tel qu'il
 * était il y a INTERP_DELAY_MS, ce qui laisse le temps à deux snapshots
 * d'encadrer chaque instant affiché. Sans ce retard, chaque paquet perdu
 * produirait un saut visible.
 */
class SnapshotBuffer {
  private items: Snapshot[] = [];
  /** Décalage estimé entre l'horloge locale et l'horloge serveur, en ms. */
  private offsetMs = 0;
  private offsetInit = false;

  push(snap: Snapshot, nowMs: number): void {
    const observed = snap.serverMs - nowMs;
    // Moyenne glissante : on suit la dérive lente entre les deux horloges sans
    // réagir à la gigue d'un paquet isolé.
    this.offsetMs = this.offsetInit ? this.offsetMs * 0.9 + observed * 0.1 : observed;
    this.offsetInit = true;

    this.items.push(snap);
    if (this.items.length > 32) this.items.shift();
  }

  get latest(): Snapshot | null {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }

  /** État interpolé à afficher maintenant, ou null si le tampon est vide. */
  sample(nowMs: number): { a: Snapshot; b: Snapshot; t: number } | null {
    if (this.items.length === 0) return null;
    if (this.items.length === 1) {
      const only = this.items[0];
      return { a: only, b: only, t: 0 };
    }
    const renderServerMs = nowMs + this.offsetMs - INTERP_DELAY_MS;

    for (let i = this.items.length - 1; i > 0; i--) {
      const b = this.items[i];
      const a = this.items[i - 1];
      if (a.serverMs <= renderServerMs && renderServerMs <= b.serverMs) {
        const span = b.serverMs - a.serverMs || 1;
        return { a, b, t: (renderServerMs - a.serverMs) / span };
      }
    }
    // Le temps de rendu est en dehors du tampon : on colle au plus proche
    // plutôt que d'extrapoler dans le vide.
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    return renderServerMs < first.serverMs
      ? { a: first, b: first, t: 0 }
      : { a: last, b: last, t: 0 };
  }

  clear(): void {
    this.items.length = 0;
    this.offsetInit = false;
  }
}

export class Connection {
  private ws: WebSocket | null = null;
  private url: string;
  private seq = 0;
  private axis = 0;
  private inputTimer: number | null = null;
  private pingTimer: number | null = null;
  private reconnectDelay = 500;
  private closedByUser = false;

  readonly buffer = new SnapshotBuffer();
  playerId = '';
  side: Side | null = null;
  room: RoomView | null = null;
  rttMs = 0;
  jitterMs = 0;
  private lastRtts: number[] = [];
  /** Dernière séquence acquittée par le serveur : mesure la dette de prédiction. */
  ackSeq = 0;

  constructor(
    private handlers: NetHandlers,
    private joinPayload: () => Extract<ClientControl, { t: 'join' }>,
  ) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // En développement, Vite sert le client sur un autre port que le serveur de
    // jeu : la variable d'environnement permet de pointer explicitement.
    const override = import.meta.env.VITE_WS_URL as string | undefined;
    this.url = override || `${proto}//${location.host}/ws`;
  }

  connect(): void {
    this.closedByUser = false;
    this.handlers.onStatus('connecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 500;
      this.handlers.onStatus('open');
      this.send(this.joinPayload());
      this.startTimers();
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.onBinary(ev.data);
        return;
      }
      let msg: ServerControl;
      try {
        msg = JSON.parse(ev.data as string) as ServerControl;
      } catch {
        return;
      }
      this.onControl(msg);
    };

    ws.onclose = () => {
      this.stopTimers();
      this.handlers.onStatus('closed');
      if (this.closedByUser) return;
      // Reconnexion à délai croissant, plafonné : une coupure Wi-Fi de bureau
      // doit se rattraper toute seule sans marteler le serveur.
      this.reconnectDelay = Math.min(8000, this.reconnectDelay * 1.8);
      window.setTimeout(() => this.connect(), this.reconnectDelay);
    };

    ws.onerror = () => ws.close();
  }

  private onBinary(buf: ArrayBuffer): void {
    switch (messageType(buf)) {
      case MSG.SNAPSHOT: {
        const snap = decodeSnapshot(buf);
        this.ackSeq = snap.ackSeq;
        this.buffer.push(snap, performance.now());
        return;
      }
      case MSG.PONG: {
        const { clientTimeMs } = decodePong(buf);
        const rtt = performance.now() - clientTimeMs;
        this.lastRtts.push(rtt);
        if (this.lastRtts.length > 12) this.lastRtts.shift();
        const mean = this.lastRtts.reduce((a, b) => a + b, 0) / this.lastRtts.length;
        this.rttMs = Math.round(mean);
        this.jitterMs = Math.round(
          Math.sqrt(this.lastRtts.reduce((a, b) => a + (b - mean) ** 2, 0) / this.lastRtts.length),
        );
        return;
      }
    }
  }

  private onControl(msg: ServerControl): void {
    switch (msg.t) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.side = msg.side;
        this.room = msg.room;
        this.buffer.clear();
        this.handlers.onWelcome(msg.playerId, msg.side, msg.room);
        return;
      case 'room':
        this.room = msg.room;
        this.handlers.onRoom(msg.room);
        return;
      case 'event':
        this.handlers.onEvents(msg.events);
        return;
      case 'over':
        this.handlers.onOver(msg);
        return;
      case 'error':
        this.handlers.onError(msg);
        return;
    }
  }

  private startTimers(): void {
    this.stopTimers();
    // Les entrées partent au rythme du tick serveur, indépendamment du framerate
    // d'affichage : un écran 144 Hz ne doit pas inonder le serveur.
    this.inputTimer = window.setInterval(() => {
      this.seq = (this.seq + 1) & 0xffff;
      this.sendBinary(encodeInput(this.seq, this.axis, 0));
    }, TICK_DT * 1000);
    this.pingTimer = window.setInterval(() => {
      this.sendBinary(encodePing(performance.now()));
    }, 1000);
  }

  private stopTimers(): void {
    if (this.inputTimer !== null) window.clearInterval(this.inputTimer);
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.inputTimer = null;
    this.pingTimer = null;
  }

  setAxis(axis: number): void {
    this.axis = Math.max(-1, Math.min(1, axis));
  }

  send(msg: ClientControl): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendBinary(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  updateConfig(config: Partial<MatchConfig>): void {
    this.send({ t: 'config', config });
  }

  rematch(): void {
    this.send({ t: 'rematch' });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.stopTimers();
    this.ws?.close();
  }
}
