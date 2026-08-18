import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  TOKEN_KEYS,
  TOKEN_LABELS,
  builtinTheme,
  deriveTheme,
  parseTheme,
  themeToCssVars,
} from '@neon-pong/shared';
import type { Theme, ThemeTokens } from '@neon-pong/shared';

/**
 * Chartes côté client.
 *
 * Trois provenances, par ordre de priorité décroissante quand les identifiants
 * se télescopent : les chartes livrées (non modifiables), celles publiées sur le
 * serveur, puis les brouillons locaux de la personne. Un brouillon reste sur le
 * poste jusqu'à publication explicite — on ne partage pas un travail en cours.
 */

const LS_SELECTED = 'neonpong.theme.selected';
const LS_DRAFTS = 'neonpong.theme.drafts';

export interface SharedTheme {
  theme: Theme;
  author: string;
  updatedAt: string;
}

export class ThemeStore {
  private shared: SharedTheme[] = [];
  private drafts: Theme[] = [];
  private currentId = DEFAULT_THEME_ID;

  constructor(private onApply: (theme: Theme) => void) {
    this.drafts = this.readDrafts();
    this.currentId = localStorage.getItem(LS_SELECTED) ?? DEFAULT_THEME_ID;
  }

  /* ---------------- lecture ---------------- */

  get current(): Theme {
    return this.find(this.currentId) ?? builtinTheme(DEFAULT_THEME_ID);
  }

  get all(): Theme[] {
    const seen = new Set<string>();
    const out: Theme[] = [];
    for (const theme of [...BUILTIN_THEMES, ...this.shared.map((s) => s.theme), ...this.drafts]) {
      if (seen.has(theme.id)) continue;
      seen.add(theme.id);
      out.push(theme);
    }
    return out;
  }

  find(id: string): Theme | null {
    return this.all.find((t) => t.id === id) ?? null;
  }

  /** Origine d'une charte, pour l'afficher dans la liste. */
  originOf(theme: Theme): string {
    if (theme.builtin) return 'Livrée';
    const shared = this.shared.find((s) => s.theme.id === theme.id);
    if (shared) return `Par ${shared.author}`;
    return 'Brouillon local';
  }

  isDraft(id: string): boolean {
    return this.drafts.some((d) => d.id === id);
  }

  /* ---------------- application ---------------- */

  apply(id: string): void {
    const theme = this.find(id);
    if (!theme) return;
    this.currentId = theme.id;
    localStorage.setItem(LS_SELECTED, theme.id);
    applyThemeToDocument(theme);
    this.onApply(theme);
  }

  /** Aperçu sans mémoriser le choix : utilisé pendant l'édition. */
  preview(theme: Theme): void {
    applyThemeToDocument(theme);
    this.onApply(theme);
  }

  /* ---------------- brouillons ---------------- */

  saveDraft(theme: Theme): void {
    this.drafts = [...this.drafts.filter((d) => d.id !== theme.id), theme];
    localStorage.setItem(LS_DRAFTS, JSON.stringify(this.drafts));
  }

  deleteDraft(id: string): void {
    this.drafts = this.drafts.filter((d) => d.id !== id);
    localStorage.setItem(LS_DRAFTS, JSON.stringify(this.drafts));
    if (this.currentId === id) this.apply(DEFAULT_THEME_ID);
  }

  /**
   * Les brouillons stockés localement passent par la même validation que ceux
   * venus du réseau : un stockage local peut être modifié à la main, ou dater
   * d'une version antérieure du modèle.
   */
  private readDrafts(): Theme[] {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_DRAFTS) ?? '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .map((entry) => parseTheme(entry).theme)
        .filter((theme): theme is Theme => theme !== null);
    } catch {
      return [];
    }
  }

  /* ---------------- serveur ---------------- */

  async loadShared(): Promise<void> {
    try {
      const res = await fetch('/api/themes');
      if (!res.ok) return;
      const body = (await res.json()) as { shared?: unknown[] };
      this.shared = (body.shared ?? [])
        .map((row) => {
          const entry = row as { theme?: unknown; author?: unknown; updatedAt?: unknown };
          const { theme } = parseTheme(entry.theme);
          if (!theme) return null;
          return {
            theme,
            author: String(entry.author ?? '?').slice(0, 14),
            updatedAt: String(entry.updatedAt ?? ''),
          };
        })
        .filter((row): row is SharedTheme => row !== null);
    } catch {
      // Sans réseau, on reste sur les chartes livrées et les brouillons locaux.
    }
  }

  async publish(theme: Theme, author: string): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme, author }),
      });
      const body = (await res.json()) as { error?: string; details?: string[] };
      if (!res.ok) {
        return { ok: false, message: [body.error, ...(body.details ?? [])].filter(Boolean).join(' ') };
      }
      await this.loadShared();
      return { ok: true, message: `« ${theme.name} » est disponible pour toute l'équipe.` };
    } catch {
      return { ok: false, message: 'Serveur injoignable : la charte reste en brouillon local.' };
    }
  }
}

/**
 * Applique une charte au document. Les clés CSS sont fixes et les valeurs ont
 * passé la validation hexadécimale : `setProperty` ne peut donc pas servir de
 * vecteur d'injection.
 */
export function applyThemeToDocument(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(themeToCssVars(theme))) {
    root.style.setProperty(key, value);
  }
  root.dataset.theme = theme.id;
  root.dataset.scanlines = String(theme.traits.scanlines);
}

/** Suggère un identifiant à partir d'un nom saisi librement. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .padEnd(2, 'x');
}

export { TOKEN_KEYS, TOKEN_LABELS, deriveTheme };
export type { Theme, ThemeTokens };
