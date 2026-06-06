export const THEME_STORAGE_KEY = 'rhizodoc-theme';

export const THEME_CHANGE_EVENT = 'rhizodoc:theme-change';

export const THEME_PALETTES = [
  { id: 'default', label: 'GitHub 默认' },
  { id: 'catppuccin', label: 'Catppuccin' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'nord', label: 'Nord' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'gruvbox', label: 'Gruvbox' },
  { id: 'solarized', label: 'Solarized' },
  { id: 'vitesse', label: 'Vitesse' },
  { id: 'rose-pine', label: 'Rosé Pine' },
  { id: 'everforest', label: 'Everforest' },
  { id: 'material', label: 'Material' },
  { id: 'one', label: 'One' },
  { id: 'monokai', label: 'Monokai' },
] as const;

export const THEME_MODES = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
] as const;

export type ThemePalette = typeof THEME_PALETTES[number]['id'];
export type ThemeMode = typeof THEME_MODES[number]['id'];
export type ThemeScheme = 'light' | 'dark';

export const THEME_CODE_THEMES = {
  default: ['github-light', 'github-dark'],
  catppuccin: ['catppuccin-latte', 'catppuccin-mocha'],
  dracula: ['light-plus', 'dracula'],
  nord: ['light-plus', 'nord'],
  'tokyo-night': ['light-plus', 'tokyo-night'],
  gruvbox: ['gruvbox-light-medium', 'gruvbox-dark-medium'],
  solarized: ['solarized-light', 'solarized-dark'],
  vitesse: ['vitesse-light', 'vitesse-dark'],
  'rose-pine': ['rose-pine-dawn', 'rose-pine'],
  everforest: ['everforest-light', 'everforest-dark'],
  material: ['material-theme-lighter', 'material-theme-palenight'],
  one: ['one-light', 'one-dark-pro'],
  monokai: ['light-plus', 'monokai'],
} as const satisfies Record<ThemePalette, readonly [string, string]>;

export type ThemePreference = {
  palette: ThemePalette;
  mode: ThemeMode;
};

export type ThemeChangeDetail = {
  preference: ThemePreference;
  scheme: ThemeScheme;
  codeThemes: readonly [string, string];
};

type ThemeControlsOptions = {
  paletteSelect: HTMLSelectElement;
  modeSelect: HTMLSelectElement;
  resolvedLabel?: HTMLElement;
};

const DEFAULT_THEME: ThemePreference = {
  palette: 'default',
  mode: 'system',
};

const paletteIds = THEME_PALETTES.map((palette) => palette.id);
const modeIds = THEME_MODES.map((mode) => mode.id);

export function initThemeControls({ paletteSelect, modeSelect, resolvedLabel }: ThemeControlsOptions) {
  populateSelect(paletteSelect, THEME_PALETTES);
  populateSelect(modeSelect, THEME_MODES);

  let preference = readThemePreference();
  const mediaQuery = getSystemThemeQuery();

  function update(nextPreference: ThemePreference, { persist = true } = {}) {
    preference = normalizeThemePreference(nextPreference);
    const scheme = applyThemePreference(preference);
    if (persist) writeThemePreference(preference);
    syncControls(preference, scheme);
  }

  function syncControls(nextPreference: ThemePreference, scheme: ThemeScheme) {
    paletteSelect.value = nextPreference.palette;
    modeSelect.value = nextPreference.mode;
    if (resolvedLabel) {
      resolvedLabel.textContent = nextPreference.mode === 'system' ? `系统：${schemeLabel(scheme)}` : schemeLabel(scheme);
      resolvedLabel.title = `当前实际外观：${schemeLabel(scheme)}`;
    }
  }

  paletteSelect.addEventListener('change', () => {
    update({ ...preference, palette: paletteSelect.value as ThemePalette });
  });
  modeSelect.addEventListener('change', () => {
    update({ ...preference, mode: modeSelect.value as ThemeMode });
  });

  const handleSystemThemeChange = () => {
    if (preference.mode === 'system') update(preference, { persist: false });
  };
  mediaQuery?.addEventListener('change', handleSystemThemeChange);

  update(preference, { persist: false });

  return () => {
    mediaQuery?.removeEventListener('change', handleSystemThemeChange);
  };
}

export function readThemePreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME };

    if (isThemeMode(raw)) return { ...DEFAULT_THEME, mode: raw };
    if (isThemePalette(raw)) return { ...DEFAULT_THEME, palette: raw };

    return normalizeThemePreference(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function writeThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalizeThemePreference(preference)));
  } catch {}
}

export function getCodeThemesForPalette(palette: ThemePalette): readonly [string, string] {
  return THEME_CODE_THEMES[palette] || THEME_CODE_THEMES[DEFAULT_THEME.palette];
}

export function getCodeThemesForCurrentPalette(): readonly [string, string] {
  const palette = document.documentElement.dataset.palette;
  return getCodeThemesForPalette(isThemePalette(palette) ? palette : DEFAULT_THEME.palette);
}

export function applyThemePreference(preference: ThemePreference): ThemeScheme {
  const normalizedPreference = normalizeThemePreference(preference);
  const scheme = resolveThemeScheme(normalizedPreference.mode);
  const root = document.documentElement;

  const codeThemes = getCodeThemesForPalette(normalizedPreference.palette);

  root.dataset.palette = normalizedPreference.palette;
  root.dataset.scheme = scheme;
  root.dataset.themeMode = normalizedPreference.mode;
  root.dataset.codeThemeLight = codeThemes[0];
  root.dataset.codeThemeDark = codeThemes[1];
  root.style.colorScheme = scheme;

  window.dispatchEvent(new window.CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, {
    detail: { preference: normalizedPreference, scheme, codeThemes },
  }));

  return scheme;
}

export function resolveThemeScheme(mode: ThemeMode): ThemeScheme {
  if (mode === 'system') return getSystemThemeQuery()?.matches ? 'dark' : 'light';
  return mode;
}

function normalizeThemePreference(value: unknown): ThemePreference {
  if (!value || typeof value !== 'object') return { ...DEFAULT_THEME };
  const candidate = value as Partial<ThemePreference>;
  return {
    palette: isThemePalette(candidate.palette) ? candidate.palette : DEFAULT_THEME.palette,
    mode: isThemeMode(candidate.mode) ? candidate.mode : DEFAULT_THEME.mode,
  };
}

function isThemePalette(value: unknown): value is ThemePalette {
  return typeof value === 'string' && (paletteIds as readonly string[]).includes(value);
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (modeIds as readonly string[]).includes(value);
}

function getSystemThemeQuery() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

function populateSelect(select: HTMLSelectElement, options: readonly { id: string; label: string }[]) {
  select.replaceChildren(...options.map((option) => {
    const optionElement = document.createElement('option');
    optionElement.value = option.id;
    optionElement.textContent = option.label;
    return optionElement;
  }));
}

function schemeLabel(scheme: ThemeScheme) {
  return scheme === 'dark' ? '深色' : '浅色';
}
