import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEMES,
  COLOR_PATTERN,
  TOKEN_KEYS,
  builtinTheme,
  deriveTheme,
  parseTheme,
  themeToCssVars,
} from '../src/index.js';

const valid = () => ({
  id: 'ma-charte',
  name: 'Ma charte',
  tokens: Object.fromEntries(TOKEN_KEYS.map((k) => [k, '#123456'])),
  traits: {
    glow: 8,
    tableInset: 10,
    lineDash: 4,
    trailLength: 12,
    misregister: 1,
    paddleFill: 'outline',
    scanlines: true,
    showAngles: false,
    font: 'mono',
  },
});

describe('chartes livrées', () => {
  it('déclare cinq chartes toutes valides selon les mêmes règles', () => {
    expect(BUILTIN_THEMES).toHaveLength(5);
    for (const theme of BUILTIN_THEMES) {
      for (const key of TOKEN_KEYS) {
        expect(theme.tokens[key], `${theme.id}.${key}`).toMatch(COLOR_PATTERN);
      }
    }
  });

  it('retombe sur la charte par défaut pour un identifiant inconnu', () => {
    expect(builtinTheme('inexistante').id).toBe('gym');
  });

  it('donne des traits structurels distincts, pas seulement des couleurs', () => {
    const traits = BUILTIN_THEMES.map((t) => JSON.stringify(t.traits));
    expect(new Set(traits).size).toBe(BUILTIN_THEMES.length);
  });
});

describe('validation', () => {
  it('accepte une charte correcte', () => {
    const { theme, errors } = parseTheme(valid());
    expect(errors).toEqual([]);
    expect(theme?.name).toBe('Ma charte');
    expect(theme?.builtin).toBe(false);
  });

  it('refuse les couleurs non hexadécimales', () => {
    for (const attack of [
      'red',
      'rgb(255,0,0)',
      'var(--t-ball)',
      'url(https://exemple.fr/pixel.png)',
      '#12345',
      '#GGGGGG',
      '',
    ]) {
      const input = valid();
      input.tokens.ball = attack;
      const { theme, errors } = parseTheme(input);
      expect(theme, `« ${attack} » ne doit pas passer`).toBeNull();
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("bloque une tentative d'injection CSS par la couleur", () => {
    const input = valid();
    input.tokens.table = '#000; background-image: url(https://pirate.fr/x)';
    expect(parseTheme(input).theme).toBeNull();
  });

  it("bloque une tentative d'injection par l'identifiant", () => {
    for (const attack of ['<script>', 'A-MAJUSCULE!', 'x', '../../etc', 'a'.repeat(30)]) {
      const input = { ...valid(), id: attack };
      expect(parseTheme(input).theme, attack).toBeNull();
    }
  });

  it('interdit de recouvrir une charte livrée', () => {
    const input = { ...valid(), id: 'gym' };
    const { theme, errors } = parseTheme(input);
    expect(theme).toBeNull();
    expect(errors.join(' ')).toContain('réservé');
  });

  it('nettoie le nom et le tronque', () => {
    const input = { ...valid(), name: `  Charte\u0000 de ${'x'.repeat(40)}` };
    const { theme } = parseTheme(input);
    expect(theme?.name.length).toBe(28);
    expect(theme?.name).not.toContain('\u0000');
  });

  it('refuse un nom vide', () => {
    expect(parseTheme({ ...valid(), name: '   ' }).theme).toBeNull();
  });

  it('exige les quatorze jetons', () => {
    const input = valid();
    delete (input.tokens as Record<string, unknown>).ball;
    expect(parseTheme(input).theme).toBeNull();
  });

  it('borne les traits numériques au lieu de les refuser', () => {
    const input = valid();
    Object.assign(input.traits, { glow: 9999, trailLength: -50, misregister: 2.7 });
    const { theme } = parseTheme(input);
    expect(theme?.traits.glow).toBe(30);
    expect(theme?.traits.trailLength).toBe(0);
    expect(theme?.traits.misregister).toBe(3);
  });

  it('remplace une énumération inconnue par la valeur par défaut', () => {
    const input = valid();
    Object.assign(input.traits, { font: 'comic-sans', paddleFill: 'liquide' });
    const { theme } = parseTheme(input);
    expect(theme?.traits.font).toBe('condensed');
    expect(theme?.traits.paddleFill).toBe('solid');
  });

  it('rejette les entrées qui ne sont pas des objets', () => {
    for (const junk of [null, undefined, 'charte', 42, []]) {
      expect(parseTheme(junk).theme).toBeNull();
    }
  });
});

describe('variables CSS', () => {
  it('ne produit que des clés connues et des valeurs hexadécimales', () => {
    const vars = themeToCssVars(builtinTheme('riso'));
    for (const [key, value] of Object.entries(vars)) {
      expect(key).toMatch(/^--[a-z-]+$/);
      if (key.startsWith('--t-')) expect(value).toMatch(COLOR_PATTERN);
    }
    expect(vars['--t-side-a']).toBe('#101010');
    expect(vars['--display']).toContain('Helvetica');
  });
});

describe('dérivation', () => {
  it('copie les valeurs sans partager les objets', () => {
    const base = builtinTheme('neon');
    const copy = deriveTheme(base, 'mienne', 'La mienne');
    copy.tokens.ball = '#ffffff';
    copy.traits.glow = 0;
    expect(base.tokens.ball).not.toBe('#ffffff');
    expect(base.traits.glow).toBe(24);
    expect(copy.builtin).toBe(false);
  });

  it('produit une charte qui passe la validation', () => {
    const copy = deriveTheme(builtinTheme('gym'), 'copie-gym', 'Copie');
    expect(parseTheme(copy).errors).toEqual([]);
  });
});
