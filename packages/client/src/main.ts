import {
  ARENAS,
  FIELD_H,
  FX_GROW,
  FX_INVERT,
  FX_SHIELD,
  FX_SHRINK,
  PADDLE_H,
  POWERS,
  TICK_DT,
  predictPaddle,
} from '@neon-pong/shared';
import type { GameEvent, MatchConfig, RoomView, Side, Snapshot } from '@neon-pong/shared';
import { Connection } from './net/connection.js';
import { Input } from './game/input.js';
import { type PendingInput, pruneAcknowledged, replayPendingInputs } from './net/reconcile.js';
import { Renderer } from './game/renderer.js';
import { Sound } from './game/sound.js';
import { el, initShell, renderLeaderboard, renderRoom, setHudEffects, setStatus, showPanel } from './ui/shell.js';
import { mountThemePanel } from './ui/theme-panel.js';
import { ThemeStore, applyThemeToDocument } from './ui/theme-store.js';

const canvas = el<HTMLCanvasElement>('#game');
const renderer = new Renderer(canvas);

/**
 * Chartes graphiques. Le magasin est la seule autorité : il applique les
 * variables CSS à l'interface et pousse la charte au rendu canvas, qui ne peut
 * pas lire une variable CSS.
 */
const themes = new ThemeStore((theme) => renderer.setTheme(theme));
applyThemeToDocument(themes.current);
renderer.setTheme(themes.current);

const themePanel = mountThemePanel(el<HTMLElement>('#theme-host'), themes, {
  authorName: () => currentName(),
  onClose: () => showPanel(room ? null : 'menu'),
});

void themes.loadShared().then(() => themePanel.refresh());
const input = new Input(canvas);
const sound = new Sound();

/* ------------------------------------------------------------------ */
/* État local                                                         */
/* ------------------------------------------------------------------ */

let localPaddleY: number | null = null;
let localSide: Side | null = null;
let room: RoomView | null = null;
let arena: MatchConfig['arena'] = 'classique';
let lastFrame = performance.now();
let lastHudTick = -1;
/** Entrées envoyées mais pas encore acquittées par le serveur (réconciliation). */
let pendingInputs: PendingInput[] = [];
/** Tick du dernier snapshot déjà réconcilié : on ne rejoue qu'une fois par snapshot. */
let lastReconciledTick = -1;

const pendingConfig: Partial<MatchConfig> = {};

const conn = new Connection(
  {
    onStatus: (s) => setStatus(s, conn.rttMs),
    onWelcome: (_id, side, view) => {
      localSide = side;
      room = view;
      arena = view.config.arena;
      localPaddleY = null;
      pendingInputs = [];
      lastReconciledTick = -1;
      renderRoom(view, side, conn.playerId);
      showPanel(null);
    },
    onRoom: (view) => {
      room = view;
      arena = view.config.arena;
      renderRoom(view, localSide, conn.playerId);
    },
    onEvents: (events: GameEvent[]) => renderer.handleEvents(events, (e) => sound.play(e)),
    onOver: (payload) => {
      const [left, right] = payload.names;
      const winnerName = payload.winner === 0 ? left : right;
      showPanel('over', {
        title: `${winnerName} gagne ${payload.scores[payload.winner]}\u2013${payload.scores[1 - payload.winner]}`,
        detail: `Plus long échange : ${payload.bestRally} frappes`,
        isHost: room?.hostId === conn.playerId,
      });
      sound.play({ t: 'over', winner: payload.winner, scores: payload.scores, bestRally: payload.bestRally });
      void refreshLeaderboard();
    },
    onError: (payload) => showPanel('error', { title: 'Impossible de rejoindre', detail: payload.message }),
    computeInputAxis: (seq) => {
      if (localSide === null) return 0;
      const authoritative = conn.buffer.latest?.paddles[localSide];
      const h = authoritative?.h ?? PADDLE_H;
      if (localPaddleY === null) localPaddleY = authoritative?.y ?? FIELD_H / 2 - h / 2;

      const inverted = authoritative ? (authoritative.flags & FX_INVERT) !== 0 : false;
      input.setPaddleHeight(h);
      const axis = input.axis(localPaddleY);
      localPaddleY = Math.max(0, Math.min(FIELD_H - h, predictPaddle(localPaddleY, h, axis, inverted)));
      pendingInputs.push({ seq, axis });
      return axis;
    },
  },
  () => ({
    t: 'join',
    name: currentName(),
    code: joinCode() || undefined,
    config: { ...pendingConfig },
  }),
);

/* ------------------------------------------------------------------ */
/* Boucle d'affichage                                                 */
/* ------------------------------------------------------------------ */

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const lerp = conn.buffer.sample(now);
  const snap = conn.buffer.latest;

  if (snap && localSide !== null && snap.tick !== lastReconciledTick) {
    // Réconciliation : à chaque nouveau snapshot, on repart de la position
    // confirmée par le serveur et on rejoue exactement les entrées envoyées
    // mais pas encore acquittées. Pas de lissage continu vers une valeur
    // toujours en léger retard : c'est ce qui faisait reculer la raquette de
    // façon visible à chaque arrêt ou changement de direction, même à ping
    // bas, puisque le retard est structurel (temps d'aller-retour), pas un
    // symptôme de mauvais réseau.
    lastReconciledTick = snap.tick;
    const authoritative = snap.paddles[localSide];
    const inverted = (authoritative.flags & FX_INVERT) !== 0;
    pendingInputs = pruneAcknowledged(pendingInputs, conn.ackSeq);
    const before = localPaddleY;
    localPaddleY = replayPendingInputs(authoritative.y, authoritative.h, pendingInputs, inverted);

    // Diagnostic temporaire : un saut de raquette signalé persiste malgré la
    // réconciliation par rejeu. Ceci mesure l'écart réel introduit par CHAQUE
    // rebasement, pour distinguer un vrai bug de reconstruction d'une cause
    // totalement différente.
    if (before !== null && Math.abs(localPaddleY - before) > 3) {
      // eslint-disable-next-line no-console
      console.warn('[reconcile] correction', {
        deltaPx: Math.round((localPaddleY - before) * 10) / 10,
        tick: snap.tick,
        ackSeq: conn.ackSeq,
        pendingCount: pendingInputs.length,
        authoritativeY: Math.round(authoritative.y),
        h: authoritative.h,
        flags: authoritative.flags,
      });
    }
  }

  const label = countdownLabel(snap?.status, snap?.timer);
  renderer.draw(
    {
      localPaddleY,
      localSide,
      arena,
      snapshot: snap,
      lerp,
      arenaTime: (snap?.tick ?? 0) * TICK_DT,
      countdownLabel: label,
    },
    dt,
  );

  // 30 snapshots par seconde suffisent au tableau de score ; le recalculer à
  // chaque image ne changeait rien à l'affichage et coûtait un recalcul de style.
  if (snap && snap.tick !== lastHudTick) {
    lastHudTick = snap.tick;
    updateHud(snap);
  }
  requestAnimationFrame(frame);
}

function countdownLabel(status: string | undefined, timer: number | undefined): string | null {
  if (status !== 'countdown' || timer === undefined) return null;
  const n = Math.ceil(timer - 0.4);
  return n > 0 ? String(n) : 'GO !';
}

function updateHud(snap: Snapshot): void {
  const names: [string, string] = [
    room?.seats[0]?.name ?? 'Joueur 1',
    room?.seats[1]?.name ?? 'Joueur 2',
  ];
  const chips = ([0, 1] as Side[]).map((side) => {
    const flags = snap.paddles[side]?.flags ?? 0;
    const out: { label: string; color: string }[] = [];
    if (flags & FX_GROW) out.push({ label: 'XXL', color: POWERS.grow.color });
    if (flags & FX_SHRINK) out.push({ label: 'Rétrécie', color: POWERS.shrink.color });
    if (flags & FX_INVERT) out.push({ label: 'Inversé', color: POWERS.invert.color });
    if (flags & FX_SHIELD) out.push({ label: 'Bouclier', color: POWERS.shield.color });
    return out;
  });
  if (snap.balls.length > 1) {
    chips[1].push({ label: `${snap.balls.length} balles`, color: POWERS.multi.color });
  }
  setHudEffects({
    names,
    scores: snap.scores,
    rally: snap.rally,
    arenaName: ARENAS.find((a) => a.id === arena)?.name ?? '',
    chips,
    rttMs: conn.rttMs,
    jitterMs: conn.jitterMs,
    localSide,
  });
}

/* ------------------------------------------------------------------ */
/* Liaisons d'interface                                               */
/* ------------------------------------------------------------------ */

function currentName(): string {
  return el<HTMLInputElement>('#name').value.trim() || 'Invité';
}

function joinCode(): string {
  return el<HTMLInputElement>('#code').value.trim().toUpperCase();
}

async function refreshLeaderboard(): Promise<void> {
  try {
    const res = await fetch('/api/leaderboard?limit=25');
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { rows: Parameters<typeof renderLeaderboard>[0] };
    renderLeaderboard(body.rows);
  } catch {
    renderLeaderboard(null);
  }
}

initShell({
  onStart: (config) => {
    Object.assign(pendingConfig, config);
    sound.unlock();
    conn.connect();
  },
  onJoin: () => {
    sound.unlock();
    conn.connect();
  },
  onConfig: (patch) => {
    Object.assign(pendingConfig, patch);
    if (room) conn.updateConfig(patch);
    if (patch.arena) arena = patch.arena;
  },
  onRematch: () => {
    showPanel(null);
    conn.rematch();
  },
  onLeave: () => {
    conn.disconnect();
    localPaddleY = null;
    localSide = null;
    room = null;
    pendingInputs = [];
    lastReconciledTick = -1;
    showPanel('menu');
  },
  onToggleSound: (on) => {
    sound.enabled = on;
    if (on) sound.unlock();
  },
  onOpenLeaderboard: () => void refreshLeaderboard(),
  onOpenThemes: () => themePanel.refresh(),
});

void refreshLeaderboard();
requestAnimationFrame(frame);
