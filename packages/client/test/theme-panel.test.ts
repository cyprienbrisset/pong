import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_THEMES } from '@neon-pong/shared';
import type { Theme } from '@neon-pong/shared';
import { mountThemePanel } from '../src/ui/theme-panel.js';
import { ThemeStore } from '../src/ui/theme-store.js';

// Racine injectée par vitest.config.ts : voir l'explication qui y figure.
const html = readFileSync(join(__CLIENT_ROOT__, 'index.html'), 'utf8');

describe('gabarit', () => {
  it('contient tous les identifiants attendus par le code', () => {
    for (const id of ['theme-host', 'btn-themes', 'panel-themes', 'game', 'hud-c1', 'hud-c2']) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });
});

describe('panneau des chartes', () => {
  let applied: Theme[] = [];
  let store: ThemeStore;
  let host: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    applied = [];
    document.body.innerHTML = '<div id="host"></div>';
    host = document.getElementById('host')!;
    store = new ThemeStore((t) => applied.push(t));
    mountThemePanel(host, store, { authorName: () => 'Cyprien', onClose: () => {} });
  });

  it('affiche une vignette par charte livrée', () => {
    expect(host.querySelectorAll('.theme-card')).toHaveLength(BUILTIN_THEMES.length);
  });

  it("n'imbrique jamais un bouton dans un bouton", () => {
    // Le HTML l'interdit, et les navigateurs rendent alors le clic imprévisible.
    expect(host.querySelectorAll('button button')).toHaveLength(0);
  });

  it('applique la charte au clic sur une vignette', () => {
    const cards = [...host.querySelectorAll<HTMLElement>('.theme-card')];
    const target = cards.find((c) => c.textContent?.includes('Oscilloscope'))!;
    const pick = target.querySelector<HTMLElement>('.theme-pick') ?? target;
    pick.click();

    expect(store.current.id).toBe('oscilloscope');
    expect(applied.at(-1)?.id).toBe('oscilloscope');
    expect(document.documentElement.style.getPropertyValue('--t-ball')).toBe('#d8ffe8');
    expect(document.documentElement.dataset.theme).toBe('oscilloscope');
  });

  it('mémorise le choix entre deux sessions', () => {
    const cards = [...host.querySelectorAll<HTMLElement>('.theme-card')];
    const target = cards.find((c) => c.textContent?.includes('Risographie'))!;
    (target.querySelector<HTMLElement>('.theme-pick') ?? target).click();

    const second = new ThemeStore(() => {});
    expect(second.current.id).toBe('riso');
  });

  it('ouvre l\'éditeur sur « Dériver » sans changer la sélection', () => {
    const before = store.current.id;
    const derive = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Dériver',
    )!;
    derive.click();
    expect(host.querySelector('.theme-editor')).not.toBeNull();
    expect(host.querySelectorAll('input[type=color]').length).toBe(14);
    expect(store.current.id).toBe(before);
  });

  it('enregistre un brouillon et le propose ensuite dans la galerie', () => {
    const derive = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Dériver',
    )!;
    derive.click();

    const colors = host.querySelectorAll<HTMLInputElement>('input[type=color]');
    colors[8].value = '#00ff00';
    colors[8].dispatchEvent(new Event('input'));

    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Enregistrer en local',
    )!;
    save.click();

    expect(host.querySelector('.theme-editor')).toBeNull();
    expect(host.querySelectorAll('.theme-card').length).toBe(BUILTIN_THEMES.length + 1);
    expect(store.current.builtin).toBe(false);
  });

  it('ignore un brouillon corrompu dans le stockage local', () => {
    localStorage.setItem('neonpong.theme.drafts', '[{"id":"x","tokens":{"ball":"red"}}]');
    const fresh = new ThemeStore(() => {});
    expect(fresh.all).toHaveLength(BUILTIN_THEMES.length);
  });
});

describe('tableau de score', () => {
  it("n'écrit dans le DOM que lorsque les valeurs changent", async () => {
    const { resetHudCache, setHudEffects } = await import('../src/ui/shell.js');
    document.body.innerHTML = `
      <span id="hud-n1"></span><span id="hud-n2"></span>
      <span id="hud-s1"></span><span id="hud-s2"></span>
      <span id="hud-arena"></span><span id="hud-rally"></span><span id="hud-net"></span>
      <div id="hud-c1"></div><div id="hud-c2"></div>`;
    resetHudCache();

    const state = {
      names: ['Cyprien', 'Hervé'] as [string, string],
      scores: [3, 2] as [number, number],
      rally: 7,
      arenaName: 'Pilier',
      chips: [[{ label: 'XXL', color: '#22e6ff' }], []],
      rttMs: 12,
      jitterMs: 2,
      localSide: 0 as const,
    };

    setHudEffects(state);
    expect(document.getElementById('hud-s1')!.textContent).toBe('3');
    expect(document.querySelectorAll('#hud-c1 .chip')).toHaveLength(1);

    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });

    // Trente images identiques : le DOM ne doit pas bouger d'un cheveu.
    for (let i = 0; i < 30; i++) setHudEffects(state);
    await Promise.resolve();
    observer.disconnect();
    expect(mutations).toBe(0);

    setHudEffects({ ...state, scores: [4, 2] });
    expect(document.getElementById('hud-s1')!.textContent).toBe('4');
  });
});
