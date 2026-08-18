import { deriveTheme, parseTheme } from '@neon-pong/shared';
import type { FontFamily, PaddleFill, Theme } from '@neon-pong/shared';
import { ThemeStore, TOKEN_KEYS, TOKEN_LABELS, slugify } from './theme-store.js';

/**
 * Écran des chartes : une grille de vignettes pour choisir, un formulaire pour
 * dériver et modifier.
 *
 * Toute modification est appliquée en aperçu immédiat sur le jeu qui tourne
 * derrière le panneau. C'est ce qui rend l'exercice utilisable : juger une
 * couleur de balle sur une pastille de formulaire ne veut rien dire, il faut la
 * voir en mouvement.
 */

const TRAIT_FIELDS = [
  { key: 'glow', label: 'Halo', min: 0, max: 30, hint: '0 = aplat mat' },
  { key: 'tableInset', label: 'Cadre de sol', min: 0, max: 30, hint: '0 = pas de cadre' },
  { key: 'lineDash', label: 'Tiret des lignes', min: 0, max: 24, hint: '0 = trait plein' },
  { key: 'trailLength', label: 'Rémanence', min: 0, max: 24, hint: 'longueur de la traînée' },
  { key: 'misregister', label: "Décalage d'encre", min: 0, max: 5, hint: 'effet risographie' },
] as const;

export interface ThemePanelHandlers {
  authorName(): string;
  onClose(): void;
}

export function mountThemePanel(
  root: HTMLElement,
  store: ThemeStore,
  handlers: ThemePanelHandlers,
): { refresh(): void } {
  let editing: Theme | null = null;
  let status = '';

  function refresh(): void {
    root.innerHTML = '';
    root.appendChild(editing ? editor(editing) : gallery());
  }

  /* ---------------- galerie ---------------- */

  function gallery(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'theme-gallery';

    const grid = document.createElement('div');
    grid.className = 'theme-grid';
    for (const theme of store.all) {
      grid.appendChild(card(theme));
    }
    wrap.appendChild(grid);

    if (status) {
      const note = document.createElement('p');
      note.className = 'psub';
      note.textContent = status;
      wrap.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.appendChild(
      button('Créer une charte', 'primary', () => {
        editing = newDraftFrom(store.current);
        status = '';
        store.preview(editing);
        refresh();
      }),
    );
    actions.appendChild(button('Fermer', '', handlers.onClose));
    wrap.appendChild(actions);
    return wrap;
  }

  function card(theme: Theme): HTMLElement {
    const selected = theme.id === store.current.id;

    // La vignette est un conteneur neutre, pas un bouton : y imbriquer les
    // boutons d'outils produirait du HTML invalide et un clic imprévisible.
    const wrap = document.createElement('div');
    wrap.className = 'theme-card';
    wrap.dataset.selected = String(selected);

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'theme-pick';
    pick.setAttribute('aria-pressed', String(selected));
    pick.innerHTML = `
      <span class="theme-thumb" style="background:${theme.tokens.floor}">
        <span class="theme-table" style="background:${theme.tokens.table};inset:${Math.round(theme.traits.tableInset / 2)}px">
          <span class="theme-mid" style="background:${theme.tokens.lines}"></span>
          <span class="theme-bat" style="background:${theme.tokens.sideA};left:6px"></span>
          <span class="theme-bat" style="background:${theme.tokens.sideB};right:6px"></span>
          <span class="theme-ball" style="background:${theme.tokens.ball}"></span>
        </span>
      </span>
      <span class="theme-name"></span>
      <span class="theme-origin"></span>`;
    pick.querySelector('.theme-name')!.textContent = theme.name;
    pick.querySelector('.theme-origin')!.textContent = selected
      ? 'Sélectionnée'
      : store.originOf(theme);
    if (selected) pick.querySelector('.theme-origin')!.classList.add('is-selected');
    pick.onclick = () => {
      store.apply(theme.id);
      status = `« ${theme.name} » appliquée. Fermez le panneau pour voir le terrain.`;
      refresh();
    };
    wrap.appendChild(pick);

    const tools = document.createElement('div');
    tools.className = 'theme-tools';
    tools.appendChild(
      miniButton(theme.builtin ? 'Dériver' : 'Modifier', () => {
        editing = theme.builtin ? newDraftFrom(theme) : structuredClone(theme);
        status = '';
        store.preview(editing);
        refresh();
      }),
    );
    if (store.isDraft(theme.id)) {
      tools.appendChild(
        miniButton('Supprimer', () => {
          store.deleteDraft(theme.id);
          status = `Brouillon « ${theme.name} » supprimé.`;
          refresh();
        }),
      );
    }
    wrap.appendChild(tools);
    return wrap;
  }

  /* ---------------- éditeur ---------------- */

  function editor(draft: Theme): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'theme-editor';

    const idRow = document.createElement('div');
    idRow.className = 'row';
    idRow.appendChild(
      textField('Nom', draft.name, 28, (value) => {
        draft.name = value;
        // L'identifiant suit le nom tant qu'on n'y a pas touché à la main.
        if (!idTouched) draft.id = slugify(value);
        idInput.value = draft.id;
      }),
    );
    let idTouched = false;
    const idField = textField('Identifiant', draft.id, 24, (value) => {
      idTouched = true;
      draft.id = slugify(value);
    });
    const idInput = idField.querySelector('input')!;
    idRow.appendChild(idField);
    wrap.appendChild(idRow);

    const colors = document.createElement('div');
    colors.className = 'theme-colors';
    for (const key of TOKEN_KEYS) {
      colors.appendChild(
        colorField(TOKEN_LABELS[key], draft.tokens[key], (value) => {
          draft.tokens[key] = value;
          store.preview(draft);
        }),
      );
    }
    wrap.appendChild(sectionTitle('Couleurs'));
    wrap.appendChild(colors);

    wrap.appendChild(sectionTitle('Traits'));
    const traits = document.createElement('div');
    traits.className = 'theme-traits';
    for (const field of TRAIT_FIELDS) {
      traits.appendChild(
        rangeField(field.label, draft.traits[field.key], field.min, field.max, field.hint, (value) => {
          draft.traits[field.key] = value;
          store.preview(draft);
        }),
      );
    }
    traits.appendChild(
      selectField<PaddleFill>('Raquettes', draft.traits.paddleFill, [
        ['solid', 'Pleines'],
        ['outline', 'Contour'],
      ], (value) => {
        draft.traits.paddleFill = value;
        store.preview(draft);
      }),
    );
    traits.appendChild(
      selectField<FontFamily>('Typographie', draft.traits.font, [
        ['condensed', 'Condensée'],
        ['mono', 'Monospace'],
        ['grotesk', 'Grotesque'],
      ], (value) => {
        draft.traits.font = value;
        store.preview(draft);
      }),
    );
    traits.appendChild(
      checkField('Balayage cathodique', draft.traits.scanlines, (value) => {
        draft.traits.scanlines = value;
        store.preview(draft);
      }),
    );
    traits.appendChild(
      checkField('Arcs d\u2019angle', draft.traits.showAngles, (value) => {
        draft.traits.showAngles = value;
        store.preview(draft);
      }),
    );
    wrap.appendChild(traits);

    const note = document.createElement('p');
    note.className = 'psub';
    note.textContent = status;
    wrap.appendChild(note);

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.appendChild(
      button('Enregistrer en local', 'primary', () => {
        const { theme, errors } = parseTheme(draft);
        if (!theme) {
          note.textContent = errors[0] ?? 'Charte invalide.';
          return;
        }
        store.saveDraft(theme);
        store.apply(theme.id);
        editing = null;
        status = `« ${theme.name} » enregistrée sur ce poste.`;
        refresh();
      }),
    );
    actions.appendChild(
      button("Publier pour l'équipe", '', async () => {
        const { theme, errors } = parseTheme(draft);
        if (!theme) {
          note.textContent = errors[0] ?? 'Charte invalide.';
          return;
        }
        store.saveDraft(theme);
        note.textContent = 'Publication…';
        const result = await store.publish(theme, handlers.authorName());
        note.textContent = result.message;
        if (result.ok) {
          store.apply(theme.id);
          editing = null;
          status = result.message;
          refresh();
        }
      }),
    );
    actions.appendChild(
      button('Annuler', '', () => {
        editing = null;
        status = '';
        // On rétablit la charte réellement sélectionnée : l'aperçu est jetable.
        store.apply(store.current.id);
        refresh();
      }),
    );
    wrap.appendChild(actions);
    return wrap;
  }

  refresh();
  return { refresh };
}

/* ------------------------------------------------------------------ */
/* Fabriques de contrôles                                            */
/* ------------------------------------------------------------------ */

function newDraftFrom(base: Theme): Theme {
  const name = `${base.name} — variante`;
  return deriveTheme(base, slugify(name), name.slice(0, 28));
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'flabel theme-section';
  el.textContent = text;
  return el;
}

function button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${variant}`.trim();
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

function miniButton(label: string, onClick: () => void): HTMLButtonElement {
  return button(label, 'mini', onClick);
}

function field(label: string): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.className = 'flabel';
  span.textContent = label;
  wrap.appendChild(span);
  return wrap;
}

function textField(
  label: string,
  value: string,
  maxLength: number,
  onInput: (value: string) => void,
): HTMLLabelElement {
  const wrap = field(label);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = maxLength;
  input.oninput = () => onInput(input.value);
  wrap.appendChild(input);
  return wrap;
}

function colorField(label: string, value: string, onInput: (value: string) => void): HTMLLabelElement {
  const wrap = field(label);
  wrap.classList.add('color-field');
  const input = document.createElement('input');
  input.type = 'color';
  // Le sélecteur natif ne gère pas l'alpha : on lui donne les six premiers
  // chiffres et on conserve la transparence éventuelle en la réappliquant.
  const alpha = value.length === 9 ? value.slice(7) : '';
  input.value = value.slice(0, 7);
  input.oninput = () => onInput(`${input.value}${alpha}`.toLowerCase());
  wrap.appendChild(input);
  return wrap;
}

function rangeField(
  label: string,
  value: number,
  min: number,
  max: number,
  hint: string,
  onInput: (value: number) => void,
): HTMLLabelElement {
  const wrap = field(label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  const out = document.createElement('span');
  out.className = 'range-out';
  out.textContent = String(value);
  input.oninput = () => {
    const n = Number(input.value);
    out.textContent = String(n);
    onInput(n);
  };
  wrap.appendChild(input);
  wrap.appendChild(out);
  wrap.title = hint;
  return wrap;
}

function selectField<T extends string>(
  label: string,
  value: T,
  options: [T, string][],
  onChange: (value: T) => void,
): HTMLLabelElement {
  const wrap = field(label);
  const select = document.createElement('select');
  for (const [key, text] of options) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = text;
    option.selected = key === value;
    select.appendChild(option);
  }
  select.onchange = () => onChange(select.value as T);
  wrap.appendChild(select);
  return wrap;
}

function checkField(label: string, value: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'field check-field';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.onchange = () => onChange(input.checked);
  const span = document.createElement('span');
  span.className = 'flabel';
  span.textContent = label;
  wrap.appendChild(input);
  wrap.appendChild(span);
  return wrap;
}
