import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initShell, showPanel } from '../src/ui/shell.js';

const html = readFileSync(join(__CLIENT_ROOT__, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

/**
 * Ces tests montent la vraie page. C'est le filet qui manquait : une seule
 * erreur dans initShell interrompt toutes les liaisons suivantes, et l'interface
 * paraît alors morte sans qu'aucun test logique ne s'en aperçoive.
 */
describe('câblage de la coquille', () => {
  const handlers = {
    onStart: vi.fn(),
    onJoin: vi.fn(),
    onConfig: vi.fn(),
    onRematch: vi.fn(),
    onLeave: vi.fn(),
    onToggleSound: vi.fn(),
    onOpenLeaderboard: vi.fn(),
    onOpenThemes: vi.fn(),
  };

  beforeEach(() => {
    document.body.innerHTML = body;
    vi.clearAllMocks();
  });

  it('monte sans lever d\'erreur sur le gabarit réel', () => {
    expect(() => initShell(handlers)).not.toThrow();
  });

  it('ouvre le panneau des chartes', () => {
    initShell(handlers);
    document.getElementById('btn-themes')!.click();
    expect(handlers.onOpenThemes).toHaveBeenCalledOnce();
    expect(document.getElementById('panel-themes')!.classList.contains('on')).toBe(true);
  });

  it('n\'affiche qu\'un seul panneau à la fois', () => {
    initShell(handlers);
    document.getElementById('btn-themes')!.click();
    document.getElementById('btn-board')!.click();
    expect(document.querySelectorAll('.panel.on')).toHaveLength(1);
    expect(document.getElementById('panel-leaderboard')!.classList.contains('on')).toBe(true);
  });

  it('remonte les réglages choisis', () => {
    initShell(handlers);
    const seg = document.querySelector('[data-seg="target"]')!;
    seg.querySelectorAll('button')[2].click();
    expect(handlers.onConfig).toHaveBeenCalledWith({ target: 11 });
  });

  it('lance une partie solo avec un bot', () => {
    initShell(handlers);
    document.getElementById('btn-solo')!.click();
    expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({ bot: true }));
  });

  it('ferme tous les panneaux quand on passe en jeu', () => {
    initShell(handlers);
    showPanel(null);
    expect(document.querySelectorAll('.panel.on')).toHaveLength(0);
  });
});
