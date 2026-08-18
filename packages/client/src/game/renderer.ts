import {
  BALL_R,
  FIELD_H,
  FIELD_W,
  FX_INVERT,
  FX_SHIELD,
  PADDLE_W,
  POWERS,
  getArena,
  paddleX,
} from '@neon-pong/shared';
import { DEFAULT_THEME_ID, FONT_STACKS, builtinTheme } from '@neon-pong/shared';
import type { ArenaId, GameEvent, Obstacle, PowerType, Snapshot, Theme } from '@neon-pong/shared';

/**
 * Un halo dessiné avec shadowBlur coûte cher : le filtre est réappliqué à chaque
 * primitive, à chaque image. On le calcule donc une seule fois dans un canvas
 * hors écran par couleur et par taille, puis on se contente de recopier l'image.
 * C'est ce qui fait tenir les 60 images par seconde sur un GPU intégré ancien.
 */
class GlowCache {
  private cache = new Map<string, HTMLCanvasElement>();

  disc(color: string, radius: number, blur: number): HTMLCanvasElement {
    const key = `d:${color}:${radius}:${blur}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const size = Math.ceil((radius + blur) * 2);
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const c = cv.getContext('2d')!;
    c.shadowColor = color;
    c.shadowBlur = blur;
    c.fillStyle = color;
    c.beginPath();
    c.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    c.fill();
    this.cache.set(key, cv);
    return cv;
  }

  /**
   * Barre lumineuse. La hauteur est arrondie par pas de 8 pixels : une raquette
   * en train de grandir passe par des dizaines de hauteurs intermédiaires, et
   * une clé au pixel près fabriquait un canvas neuf presque à chaque image —
   * chacun coûtant un rendu avec flou. On étire ensuite l'image au dessin, l'œil
   * ne voit pas la différence sur un rectangle uni.
   */
  bar(color: string, w: number, h: number, blur: number, radius?: number): HTMLCanvasElement {
    const quantized = Math.max(8, Math.round(h / 8) * 8);
    h = quantized;
    const key = `b:${color}:${Math.round(w)}:${h}:${blur}:${radius ?? -1}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w + blur * 2);
    cv.height = Math.ceil(h + blur * 2);
    const c = cv.getContext('2d')!;
    c.shadowColor = color;
    c.shadowBlur = blur;
    c.fillStyle = color;
    const r = radius ?? Math.min(w, h) / 2;
    c.beginPath();
    c.roundRect(blur, blur, w, h, r);
    c.fill();
    this.cache.set(key, cv);
    this.evictIfLarge();
    return cv;
  }

  clear(): void {
    this.cache.clear();
  }

  /** Garde-fou mémoire : un cache non borné finirait par peser sur une session longue. */
  private evictIfLarge(): void {
    if (this.cache.size <= 64) return;
    const oldest = this.cache.keys().next().value;
    if (oldest !== undefined) this.cache.delete(oldest);
  }
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

/** Pool à taille fixe : zéro allocation pendant le jeu, donc pas de micro-gel GC. */
class ParticlePool {
  private items: Particle[] = [];

  constructor(size = 400) {
    for (let i = 0; i < size; i++) {
      this.items.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: '#ffffff' });
    }
  }

  burst(x: number, y: number, color: string, count: number, power = 1): void {
    let spawned = 0;
    for (const p of this.items) {
      if (spawned >= count) break;
      if (p.active) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 260) * power;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = p.max = 0.45;
      p.color = color;
      spawned++;
    }
  }

  update(dt: number): void {
    for (const p of this.items) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
  }

  draw(c: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      if (!p.active) continue;
      c.globalAlpha = p.life / p.max;
      c.fillStyle = p.color;
      c.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    c.globalAlpha = 1;
  }
}

export interface RenderState {
  /** Position verticale de la raquette locale, issue de la prédiction. */
  localPaddleY: number | null;
  localSide: 0 | 1 | null;
  arena: ArenaId;
  snapshot: Snapshot | null;
  /** Interpolation entre deux snapshots : a, b et l'avancement t. */
  lerp: { a: Snapshot; b: Snapshot; t: number } | null;
  /** Temps serveur estimé, en secondes, pour animer les obstacles. */
  arenaTime: number;
  countdownLabel: string | null;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private glow = new GlowCache();
  private particles = new ParticlePool();
  private trails = new Map<number, { x: number; y: number }[]>();
  /** Angle courant du marqueur de rotation, par balle (indice de tableau). */
  private spinAngles = new Map<number, number>();
  private shake = 0;
  private dpr = 1;
  private theme: Theme = builtinTheme(DEFAULT_THEME_ID);

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Change de charte. Le cache de halos est indexé par couleur, mais les images
   * déjà produites porteraient l'ancienne palette : on le vide, sinon le
   * basculement ne se voit qu'à moitié.
   */
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.glow.clear();
    this.trails.clear();
    this.spinAngles.clear();
  }

  get themeId(): string {
    return this.theme.id;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (dpr === this.dpr && this.canvas.width > 0) return;
    this.dpr = dpr;
    this.canvas.width = FIELD_W * dpr;
    this.canvas.height = FIELD_H * dpr;
    this.glow.clear();
  }

  /** Traduit les événements serveur en retours visuels et sonores. */
  handleEvents(events: GameEvent[], onSound: (e: GameEvent) => void): void {
    for (const e of events) {
      onSound(e);
      switch (e.t) {
        case 'paddle':
          this.particles.burst(e.x, e.y, this.sideColor(e.side), 9, 0.9);
          this.shake = Math.min(14, this.shake + 3);
          break;
        case 'obstacle':
          this.particles.burst(e.x, e.y, this.theme.tokens.obstacle, 7, 0.6);
          break;
        case 'power':
          this.particles.burst(e.x, e.y, POWERS[e.type as PowerType].color, 22, 1.4);
          this.shake = Math.min(16, this.shake + 4);
          break;
        case 'shield':
          this.particles.burst(e.x, e.y, POWERS.shield.color, 20, 1.2);
          break;
        case 'goal':
          this.particles.burst(e.side === 0 ? FIELD_W - 20 : 20, FIELD_H / 2, this.sideColor(e.side), 30, 1.6);
          this.shake = 16;
          this.trails.clear();
          this.spinAngles.clear();
          break;
      }
    }
  }

  draw(state: RenderState, dt: number): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.shake > 0.2) {
      c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.86;
    }

    this.drawField(c);

    const snap = state.lerp?.b ?? state.snapshot;
    if (!snap) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    this.drawScoreGhost(c, snap);
    this.drawObstacles(c, getArena(state.arena).obstaclesAt(state.arenaTime));
    this.drawPowerups(c, state, snap);
    this.drawPaddles(c, state, snap);
    this.drawBalls(c, state, dt);

    this.particles.update(dt);
    this.particles.draw(c);

    if (state.countdownLabel) this.drawCountdown(c, state.countdownLabel);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawField(c: CanvasRenderingContext2D): void {
    const t = this.theme;
    // Cadre de sol : la bande qui dépasse de la table, débordée pour absorber le
    // tremblement d'écran sans laisser apparaître de bord noir.
    c.fillStyle = t.tokens.floor;
    c.fillRect(-30, -30, FIELD_W + 60, FIELD_H + 60);

    const inset = t.traits.tableInset;
    c.fillStyle = t.tokens.table;
    c.fillRect(inset, inset, FIELD_W - inset * 2, FIELD_H - inset * 2);

    c.strokeStyle = t.tokens.grid;
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 50; x < FIELD_W; x += 50) {
      c.moveTo(x, inset);
      c.lineTo(x, FIELD_H - inset);
    }
    for (let y = 50; y < FIELD_H; y += 50) {
      c.moveTo(inset, y);
      c.lineTo(FIELD_W - inset, y);
    }
    c.stroke();

    // Lignes réglementaires : bordure pleine et médiane continue, comme sur une
    // vraie table. Le pointillé arcade laisserait sa place au tiret.
    const dash = t.traits.lineDash;
    c.strokeStyle = t.tokens.lines;
    c.setLineDash(dash > 0 ? [dash, Math.round(dash * 1.15)] : []);
    const margin = inset + 12;
    c.lineWidth = dash > 0 ? 1.5 : 3;
    c.strokeRect(margin, margin, FIELD_W - margin * 2, FIELD_H - margin * 2);

    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(FIELD_W / 2, margin);
    c.lineTo(FIELD_W / 2, FIELD_H - margin);
    c.stroke();
    c.setLineDash([]);
  }

  private drawScoreGhost(c: CanvasRenderingContext2D, snap: Snapshot): void {
    c.save();
    c.font = `500 190px ${this.fontStack()}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // Le score imprimé dans le fond reprend la couleur du camp, très atténuée.
    c.globalAlpha = 0.09;
    c.fillStyle = this.theme.tokens.sideA;
    c.fillText(String(snap.scores[0]), FIELD_W * 0.29, FIELD_H / 2);
    c.fillStyle = this.theme.tokens.sideB;
    c.fillText(String(snap.scores[1]), FIELD_W * 0.71, FIELD_H / 2);
    c.globalAlpha = 1;
    c.restore();
  }

  private drawObstacles(c: CanvasRenderingContext2D, obstacles: Obstacle[]): void {
    for (const o of obstacles) {
      if (o.kind === 'circle') {
        const img = this.glow.disc(this.theme.tokens.obstacle, o.r, this.theme.traits.glow);
        c.drawImage(img, o.x - img.width / 2, o.y - img.height / 2);
      } else if (o.kind === 'rect') {
        const img = this.glow.bar(this.theme.tokens.obstacle, o.w, o.h, this.theme.traits.glow, 2);
        c.drawImage(img, o.x - (img.width - o.w) / 2, o.y - (img.height - o.h) / 2);
      } else {
        const img = this.glow.bar(this.theme.tokens.obstacle, o.len, o.thick, this.theme.traits.glow);
        c.save();
        c.translate(o.x, o.y);
        c.rotate(o.angle);
        c.drawImage(img, -img.width / 2, -img.height / 2);
        c.restore();
      }
    }
  }

  private drawPaddles(c: CanvasRenderingContext2D, state: RenderState, snap: Snapshot): void {
    for (let side = 0 as 0 | 1; side <= 1; side = (side + 1) as 0 | 1) {
      const remote = snap.paddles[side];
      const lerped = state.lerp
        ? lerp(state.lerp.a.paddles[side]?.y ?? remote.y, state.lerp.b.paddles[side]?.y ?? remote.y, state.lerp.t)
        : remote.y;
      // Sa propre raquette est affichée à la position prédite localement : c'est
      // ce qui donne la sensation d'un contrôle instantané.
      const y = side === state.localSide && state.localPaddleY !== null ? state.localPaddleY : lerped;
      const h = remote.h;
      const color = this.sideColor(side);
      if (this.theme.traits.paddleFill === 'outline') {
        // Charte « plan technique » : la raquette est une cote, pas un objet.
        c.save();
        c.strokeStyle = color;
        c.lineWidth = 1.5;
        c.strokeRect(paddleX(side) + 0.75, y + 0.75, PADDLE_W - 1.5, h - 1.5);
        c.restore();
      } else {
        const img = this.glow.bar(color, PADDLE_W, h, this.theme.traits.glow, 3);
        // L'image est produite à une hauteur arrondie : on l'étire à la hauteur
        // réelle plutôt que d'en fabriquer une par pixel.
        const pad = this.theme.traits.glow;
        c.drawImage(
          img,
          paddleX(side) - pad,
          y - pad,
          PADDLE_W + pad * 2,
          h + pad * 2,
        );
      }

      if (side === state.localSide) {
        // Repère de camp : une flèche qui pointe sa propre raquette, en couleur
        // d'accent plutôt qu'en couleur de camp. Sur les chartes Oscilloscope et
        // Plan technique, sideA et sideB sont identiques — seule la position
        // permet alors de reconnaître sa raquette.
        const { x: mx, y: my } = ownPaddleMarkerAnchor(side, y, h);
        const dir = side === 0 ? 1 : -1;
        const size = 7;
        c.save();
        c.fillStyle = this.theme.tokens.accent;
        c.beginPath();
        c.moveTo(mx, my);
        c.lineTo(mx + dir * size, my - size);
        c.lineTo(mx + dir * size, my + size);
        c.closePath();
        c.fill();
        c.restore();
      }

      if (remote.flags & FX_SHIELD) {
        const gx = side === 0 ? 6 : FIELD_W - 6;
        c.save();
        c.globalAlpha = 0.55;
        c.strokeStyle = POWERS.shield.color;
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(gx, 8);
        c.lineTo(gx, FIELD_H - 8);
        c.stroke();
        c.restore();
      }
      if (remote.flags & FX_INVERT) {
        c.save();
        c.fillStyle = POWERS.invert.color;
        c.font = `500 15px ${this.fontStack()}`;
        c.textAlign = side === 0 ? 'left' : 'right';
        c.fillText('\u21c5', side === 0 ? paddleX(0) : paddleX(1) + PADDLE_W, y - 8);
        c.restore();
      }
    }
  }

  private drawBalls(c: CanvasRenderingContext2D, state: RenderState, dt: number): void {
    const lerpState = state.lerp;
    const snap = lerpState?.b ?? state.snapshot;
    if (!snap) return;

    const seen = new Set<number>();
    snap.balls.forEach((ball, i) => {
      // Les balles sont appariées par index : le serveur les envoie dans un
      // ordre stable au sein d'un même échange.
      const prev = lerpState?.a.balls[i];
      const x = prev && lerpState ? lerp(prev.x, ball.x, lerpState.t) : ball.x;
      const y = prev && lerpState ? lerp(prev.y, ball.y, lerpState.t) : ball.y;

      seen.add(i);
      let trail = this.trails.get(i);
      if (!trail) {
        trail = [];
        this.trails.set(i, trail);
      }
      trail.push({ x, y });
      const maxTrail = this.theme.traits.trailLength;
      while (trail.length > maxTrail) trail.shift();

      // Un ruban continu plutôt que des points indépendants : la courbure
      // réelle de la trajectoire (l'effet Magnus) se lit d'un coup d'œil au
      // lieu de se deviner entre des pastilles espacées.
      c.lineCap = 'round';
      for (let t = 0; t < trail.length - 1; t++) {
        const a = trail[t];
        const b = trail[t + 1];
        const ratio = (t + 1) / trail.length;
        c.globalAlpha = ratio * 0.5;
        c.strokeStyle = this.theme.tokens.trail;
        c.lineWidth = BALL_R * (0.3 + 0.9 * ratio);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
      c.globalAlpha = 1;

      // Une seule balle réglementaire : elle ne change pas de couleur selon le
      // dernier frappeur, contrairement à la charte néon.
      const off = this.theme.traits.misregister;
      if (off > 0) {
        // Décalage de repérage : la couche d'encre sombre glisse sous la couleur,
        // et l'écart s'accentue avec la vitesse de la balle.
        const drift = off * (1 + Math.min(1, Math.hypot(ball.vx, ball.vy) / 900));
        const ghost = this.glow.disc(this.theme.tokens.ink, BALL_R, 0);
        c.globalAlpha = 0.9;
        c.drawImage(ghost, x - drift - ghost.width / 2, y - drift - ghost.height / 2);
        c.globalAlpha = 1;
      }
      const img = this.glow.disc(this.theme.tokens.ball, BALL_R, this.theme.traits.glow);
      c.drawImage(img, x - img.width / 2, y - img.height / 2);

      // L'effet Magnus est la mécanique signature du jeu, mais invisible sans
      // ce trait : il tourne à une vitesse proportionnelle au spin réel de la
      // balle, dans le sens réel de la rotation.
      const angle = nextSpinAngle(this.spinAngles.get(i) ?? 0, ball.spin, dt);
      this.spinAngles.set(i, angle);
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.strokeStyle = this.theme.tokens.accent;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-BALL_R * 0.8, 0);
      c.lineTo(BALL_R * 0.8, 0);
      c.stroke();
      c.restore();

      if (this.theme.traits.showAngles) this.drawAngle(c, x, y, ball.vx, ball.vy);
    });

    for (const key of [...this.trails.keys()]) {
      if (!seen.has(key)) {
        this.trails.delete(key);
        this.spinAngles.delete(key);
      }
    }
  }

  /** Trace l'arc d'angle au dernier point de contact, comme sur un schéma coté. */
  private drawAngle(c: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number): void {
    const angle = Math.atan2(vy, vx);
    c.save();
    c.strokeStyle = this.theme.tokens.accent;
    c.lineWidth = 1;
    c.beginPath();
    c.arc(x, y, 22, Math.min(0, angle), Math.max(0, angle));
    c.stroke();
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(angle) * 34, y + Math.sin(angle) * 34);
    c.setLineDash([3, 3]);
    c.stroke();
    c.restore();
  }

  private drawPowerups(c: CanvasRenderingContext2D, state: RenderState, snap: Snapshot): void {
    const pulse = 1 + 0.09 * Math.sin(state.arenaTime * 6);
    for (const pu of snap.powerups) {
      const def = POWERS[pu.type];
      const img = this.glow.disc(def.color, 6, this.theme.traits.glow);
      c.save();
      c.globalAlpha = 0.22;
      c.fillStyle = def.color;
      c.beginPath();
      c.arc(pu.x, pu.y, 19 * pulse, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = def.color;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(pu.x, pu.y, 19 * pulse, 0, Math.PI * 2);
      c.stroke();
      c.drawImage(img, pu.x - img.width / 2, pu.y - img.height / 2);
      c.fillStyle = this.theme.tokens.table;
      c.font = `500 16px ${this.fontStack()}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(def.glyph, pu.x, pu.y + 1);
      c.restore();
    }
  }

  private sideColor(side: 0 | 1): string {
    return side === 0 ? this.theme.tokens.sideA : this.theme.tokens.sideB;
  }

  private fontStack(): string {
    return FONT_STACKS[this.theme.traits.font];
  }

  private drawCountdown(c: CanvasRenderingContext2D, label: string): void {
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // 84px convient à un chiffre ou « GO ! » ; un message plus long (« En
    // attente d'un adversaire ») déborderait largement du terrain sans ça.
    const maxWidth = FIELD_W * 0.85;
    let size = 84;
    c.font = `500 ${size}px ${this.fontStack()}`;
    const width = c.measureText(label).width;
    if (width > maxWidth) {
      size = Math.floor(size * (maxWidth / width));
      c.font = `500 ${size}px ${this.fontStack()}`;
    }
    c.fillStyle = this.theme.tokens.ink;
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 6;
    c.strokeText(label, FIELD_W / 2, FIELD_H / 2 - 10);
    c.fillText(label, FIELD_W / 2, FIELD_H / 2 - 10);
    c.restore();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Position du repère de raquette locale : sur le bord intérieur du camp, au
 * milieu de sa hauteur. Certaines chartes (Oscilloscope, Plan technique)
 * donnent la même couleur aux deux camps — le repère doit donc identifier son
 * propre camp par la position, jamais par la teinte.
 */
export function ownPaddleMarkerAnchor(side: 0 | 1, y: number, h: number): { x: number; y: number } {
  return {
    x: side === 0 ? paddleX(0) + PADDLE_W : paddleX(1),
    y: y + h / 2,
  };
}

/**
 * Fait avancer l'angle du marqueur de rotation d'une balle, à une vitesse
 * proportionnelle à son spin réel — plus l'effet Magnus est fort, plus le
 * marqueur tourne vite, dans le sens réel de la rotation. Bornée à un tour
 * pour ne jamais dériver sans limite sur un échange long.
 */
export function nextSpinAngle(angle: number, spin: number, dt: number, rate = 6): number {
  return (angle + spin * rate * dt) % (Math.PI * 2);
}
