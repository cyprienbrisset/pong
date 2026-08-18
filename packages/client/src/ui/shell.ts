import { ARENAS, BOT_LABELS } from './labels.js';
import type { MatchConfig, RoomView, Side } from '@neon-pong/shared';

export function el<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`élément introuvable : ${selector}`);
  return node;
}

export interface LeaderRow {
  name: string;
  matches: number;
  wins: number;
  losses: number;
  point_diff: number;
  best_rally: number;
  win_rate: number;
}

export interface ShellHandlers {
  onOpenThemes(): void;
  onStart(config: Partial<MatchConfig>): void;
  onJoin(): void;
  onConfig(patch: Partial<MatchConfig>): void;
  onRematch(): void;
  onLeave(): void;
  onToggleSound(on: boolean): void;
  onOpenLeaderboard(): void;
}

type PanelName = 'menu' | 'over' | 'error' | 'leaderboard' | 'themes' | null;

let handlers: ShellHandlers;
const draft: Partial<MatchConfig> = {
  arena: 'classique',
  target: 7,
  powerups: true,
  bot: true,
  botLevel: 1,
};

export function initShell(h: ShellHandlers): void {
  handlers = h;
  buildArenaPicker();
  bindSegments();

  el<HTMLButtonElement>('#btn-solo').onclick = () => {
    draft.bot = true;
    handlers.onStart({ ...draft });
  };
  el<HTMLButtonElement>('#btn-host').onclick = () => {
    draft.bot = false;
    handlers.onStart({ ...draft });
  };
  el<HTMLButtonElement>('#btn-join').onclick = () => handlers.onJoin();
  el<HTMLButtonElement>('#btn-rematch').onclick = () => handlers.onRematch();
  el<HTMLButtonElement>('#btn-leave').onclick = () => handlers.onLeave();
  el<HTMLButtonElement>('#btn-back-menu').onclick = () => showPanel('menu');
  el<HTMLButtonElement>('#btn-themes').onclick = () => {
    handlers.onOpenThemes();
    showPanel('themes');
  };
  el<HTMLButtonElement>('#btn-board').onclick = () => {
    handlers.onOpenLeaderboard();
    showPanel('leaderboard');
  };
  el<HTMLButtonElement>('#btn-close-board').onclick = () => showPanel('menu');

  const soundBtn = el<HTMLButtonElement>('#btn-sound');
  soundBtn.onclick = () => {
    const on = soundBtn.getAttribute('aria-pressed') !== 'true';
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.textContent = `Son : ${on ? 'on' : 'off'}`;
    handlers.onToggleSound(on);
  };

  const copyBtn = el<HTMLButtonElement>('#btn-copy-code');
  copyBtn.onclick = async () => {
    const code = el<HTMLSpanElement>('#room-code').textContent ?? '';
    try {
      await navigator.clipboard.writeText(`${location.origin}/?code=${code}`);
      copyBtn.textContent = 'Lien copié';
      window.setTimeout(() => (copyBtn.textContent = 'Copier le lien'), 1800);
    } catch {
      copyBtn.textContent = 'Copie refusée';
    }
  };

  // Un lien partagé avec ?code=XXXX préremplit la salle : le collègue n'a plus
  // qu'à saisir son prénom.
  const fromUrl = new URLSearchParams(location.search).get('code');
  if (fromUrl) el<HTMLInputElement>('#code').value = fromUrl.toUpperCase().slice(0, 4);

  showPanel('menu');
}

function bindSegments(): void {
  for (const seg of document.querySelectorAll<HTMLElement>('[data-seg]')) {
    const key = seg.dataset.seg as keyof MatchConfig;
    for (const btn of seg.querySelectorAll<HTMLButtonElement>('button')) {
      btn.onclick = () => {
        const raw = btn.dataset.v!;
        const value: unknown =
          key === 'powerups' ? raw === '1' : key === 'target' || key === 'botLevel' ? Number(raw) : raw;
        (draft as Record<string, unknown>)[key] = value;
        for (const other of seg.querySelectorAll('button')) {
          other.setAttribute('aria-pressed', String(other === btn));
        }
        handlers.onConfig({ [key]: value } as Partial<MatchConfig>);
      };
    }
  }
}

function buildArenaPicker(): void {
  const wrap = el<HTMLDivElement>('#arena-picker');
  wrap.innerHTML = '';
  for (const a of ARENAS) {
    const btn = document.createElement('button');
    btn.className = 'arena';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(a.id === draft.arena));
    btn.innerHTML = `<span class="arena-name">${a.name}</span><span class="arena-desc">${a.desc}</span>`;
    btn.onclick = () => {
      draft.arena = a.id;
      for (const other of wrap.querySelectorAll('button')) {
        other.setAttribute('aria-pressed', String(other === btn));
      }
      handlers.onConfig({ arena: a.id });
    };
    wrap.appendChild(btn);
  }
}

export function showPanel(name: PanelName, opts?: { title?: string; detail?: string; isHost?: boolean }): void {
  for (const p of document.querySelectorAll('.panel')) p.classList.remove('on');
  if (!name) return;
  const panel = el<HTMLElement>(`#panel-${name}`);
  panel.classList.add('on');
  if (opts?.title) el<HTMLElement>(`#${name}-title`).textContent = opts.title;
  if (opts?.detail) el<HTMLElement>(`#${name}-detail`).textContent = opts.detail;
  if (name === 'over') {
    // Seul l'hôte relance : sinon deux clients demanderaient une revanche
    // simultanément et le serveur en ignorerait une, ce qui semblerait cassé.
    el<HTMLButtonElement>('#btn-rematch').hidden = opts?.isHost === false;
  }
}

export function setStatus(status: 'connecting' | 'open' | 'closed', rttMs: number): void {
  const node = el<HTMLElement>('#status');
  const labels = {
    connecting: 'Connexion…',
    open: `En ligne · ${rttMs} ms`,
    closed: 'Hors ligne — reconnexion',
  } as const;
  node.textContent = labels[status];
  node.dataset.state = status;
}

export function renderRoom(room: RoomView, localSide: Side | null, playerId: string): void {
  el<HTMLSpanElement>('#room-code').textContent = room.code;
  el<HTMLElement>('#room-arena').textContent = ARENAS.find((a) => a.id === room.config.arena)?.name ?? '';
  el<HTMLElement>('#room-rules').textContent = `${room.config.target} points${room.config.powerups ? ' · bonus' : ''}`;
  el<HTMLElement>('#room-seats').innerHTML = room.seats
    .map((s) => {
      const tag = s.bot ? 'IA' : s.connected ? 'connecté' : 'absent';
      const me = s.id === playerId ? ' (vous)' : '';
      return `<li class="seat s${s.side}"><b>${escapeHtml(s.name)}${me}</b><span>${tag}</span></li>`;
    })
    .join('');
  el<HTMLElement>('#room-host').textContent =
    room.hostId === playerId ? 'Vous réglez la partie' : 'Réglages tenus par le premier joueur';
  el<HTMLElement>('#room-side').textContent =
    localSide === null ? 'Vous observez' : localSide === 0 ? 'Vous jouez à gauche' : 'Vous jouez à droite';
  el<HTMLElement>('#bot-level-label').textContent = BOT_LABELS[room.config.botLevel] ?? '';
}

/**
 * Références du tableau de score, résolues une seule fois.
 *
 * La version précédente appelait `document.querySelector` huit fois et
 * réécrivait deux `innerHTML` à chaque image, soit soixante fois par seconde.
 * C'est la cause des micro-saccades : chaque écriture force un recalcul de style,
 * et l'analyse du HTML des pastilles allouait sans arrêt.
 */
interface HudRefs {
  n1: HTMLElement; n2: HTMLElement;
  s1: HTMLElement; s2: HTMLElement;
  arena: HTMLElement; rally: HTMLElement; net: HTMLElement;
  c1: HTMLElement; c2: HTMLElement;
}

let hudRefs: HudRefs | null = null;
function refs(): HudRefs {
  if (!hudRefs) {
    hudRefs = {
      n1: el('#hud-n1'), n2: el('#hud-n2'),
      s1: el('#hud-s1'), s2: el('#hud-s2'),
      arena: el('#hud-arena'), rally: el('#hud-rally'), net: el('#hud-net'),
      c1: el('#hud-c1'), c2: el('#hud-c2'),
    };
  }
  return hudRefs;
}

/** Dernières valeurs écrites : on ne touche au DOM que si elles ont changé. */
const lastHud: Record<string, string> = {};
function write(node: HTMLElement, key: string, value: string): void {
  if (lastHud[key] === value) return;
  lastHud[key] = value;
  node.textContent = value;
}
function writeChips(node: HTMLElement, key: string, chips: { label: string; color: string }[]): void {
  const signature = chips.map((c) => `${c.label}|${c.color}`).join(',');
  if (lastHud[key] === signature) return;
  lastHud[key] = signature;
  node.replaceChildren(
    ...chips.map((c) => {
      const span = document.createElement('span');
      span.className = 'chip';
      span.style.color = c.color;
      span.textContent = c.label;
      return span;
    }),
  );
}

export function setHudEffects(state: {
  names: [string, string];
  scores: [number, number];
  rally: number;
  arenaName: string;
  chips: { label: string; color: string }[][];
  rttMs: number;
  jitterMs: number;
  localSide: Side | null;
}): void {
  const r = refs();
  write(r.n1, 'n1', state.names[0]);
  write(r.n2, 'n2', state.names[1]);
  write(r.s1, 's1', String(state.scores[0]));
  write(r.s2, 's2', String(state.scores[1]));
  write(r.arena, 'arena', state.arenaName);
  write(r.rally, 'rally', `Échange : ${state.rally}`);
  // Le réseau est arrondi à 5 ms : afficher la milliseconde exacte ferait
  // clignoter le chiffre en permanence pour aucune information utile.
  write(r.net, 'net', `${Math.round(state.rttMs / 5) * 5} ms ± ${state.jitterMs}`);
  writeChips(r.c1, 'c1', state.chips[0]);
  writeChips(r.c2, 'c2', state.chips[1]);
}

/** À appeler quand le gabarit est remplacé, notamment dans les tests. */
export function resetHudCache(): void {
  hudRefs = null;
  for (const key of Object.keys(lastHud)) delete lastHud[key];
}

export function renderLeaderboard(rows: LeaderRow[] | null): void {
  const table = el<HTMLTableElement>('#table-leader');
  const note = el<HTMLElement>('#leader-note');
  if (!rows) {
    table.innerHTML = '';
    note.textContent = 'Classement indisponible : le serveur ne répond pas.';
    return;
  }
  if (rows.length === 0) {
    table.innerHTML = '';
    note.textContent = 'Aucun match enregistré. Jouez une manche pour ouvrir le classement.';
    return;
  }
  table.innerHTML = `
    <thead><tr><th>Joueur</th><th>Matchs</th><th>V</th><th>%</th><th>Pts +/-</th><th>Échange</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.matches}</td>
          <td>${r.wins}</td>
          <td>${Math.round(r.win_rate * 100)}%</td>
          <td>${r.point_diff > 0 ? '+' : ''}${r.point_diff}</td>
          <td>${r.best_rally}</td>
        </tr>`,
      )
      .join('')}</tbody>`;
  note.textContent = 'Partagé par tous les joueurs du serveur, conservé entre les pauses.';
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
