import type { GameEvent } from '@neon-pong/shared';

/**
 * Sons de synthèse : aucun fichier audio à télécharger, donc rien à mettre en
 * cache et pas un octet de bande passante. Le contexte audio n'est créé qu'au
 * premier geste de l'utilisateur, comme l'exigent les navigateurs.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  enabled = true;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    void this.ctx?.resume();
  }

  private beep(freq: number, dur = 0.06, type: OscillatorType = 'square', gain = 0.05): void {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain;
    amp.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + dur);
  }

  play(e: GameEvent): void {
    switch (e.t) {
      case 'paddle':
        this.beep(220 + e.speed / 6, 0.045, 'square', 0.05);
        break;
      case 'wall':
        this.beep(520, 0.03, 'triangle', 0.03);
        break;
      case 'obstacle':
        this.beep(140, 0.05, 'sawtooth', 0.035);
        break;
      case 'power':
        this.beep(880, 0.12, 'triangle', 0.06);
        this.beep(1320, 0.1, 'sine', 0.04);
        break;
      case 'shield':
        this.beep(300, 0.15, 'square', 0.06);
        break;
      case 'goal':
        this.beep(e.side === 0 ? 660 : 440, 0.18, 'square', 0.06);
        break;
      case 'over':
        this.beep(880, 0.1, 'square', 0.05);
        window.setTimeout(() => this.beep(1174, 0.16, 'square', 0.05), 110);
        break;
    }
  }
}
