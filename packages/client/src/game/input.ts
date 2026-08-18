import { FIELD_H, FIELD_W } from '@neon-pong/shared';

/**
 * Collecte des entrées. On expose un axe continu sur [-1, 1] plutôt que des
 * touches, afin que clavier, souris et tactile alimentent le même canal.
 *
 * Les touches sont lues via `event.key` et non `event.code` : sur un clavier
 * AZERTY, la position physique de « W » correspond à « Z », et l'inverse. En
 * acceptant les deux lettres, le jeu fonctionne sur les deux dispositions sans
 * réglage.
 */
const UP_KEYS = new Set(['w', 'z', 'arrowup']);
const DOWN_KEYS = new Set(['s', 'arrowdown']);

export class Input {
  private keys = new Set<string>();
  private pointerTarget: number | null = null;
  private paddleHeight = 104;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (UP_KEYS.has(k) || DOWN_KEYS.has(k) || k === ' ') e.preventDefault();
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    // Une fenêtre qui perd le focus doit relâcher les touches, sinon la raquette
    // continue de filer toute seule.
    window.addEventListener('blur', () => this.keys.clear());

    const toField = (clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return ((clientY - rect.top) / rect.height) * FIELD_H;
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointerTarget = toField(e.clientY);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointerTarget !== null) this.pointerTarget = toField(e.clientY);
    });
    const release = () => {
      this.pointerTarget = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  setPaddleHeight(h: number): void {
    this.paddleHeight = h;
  }

  /** Axe courant. Le pointeur, quand il est actif, a la priorité sur le clavier. */
  axis(currentPaddleY: number): number {
    if (this.pointerTarget !== null) {
      const delta = this.pointerTarget - (currentPaddleY + this.paddleHeight / 2);
      if (Math.abs(delta) < 4) return 0;
      return Math.sign(delta) * Math.min(1, Math.abs(delta) / 26);
    }
    let axis = 0;
    for (const k of this.keys) {
      if (UP_KEYS.has(k)) axis -= 1;
      if (DOWN_KEYS.has(k)) axis += 1;
    }
    return Math.max(-1, Math.min(1, axis));
  }

  isPressed(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }
}

export const FIELD = { W: FIELD_W, H: FIELD_H };
