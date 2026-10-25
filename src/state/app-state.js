// @ts-check
// Form des App-Zustands, Startwerte und gemerkte Einstellungen (localStorage).

import { createStore } from './store.js';

/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {import('../data/errors.js').SourceError} SourceError */

/** @typedef {'playlists' | 'albums' | 'recent'} TabId */
/** @typedef {'shelf' | 'crate'} LayoutId */

/**
 * Was eine Ansicht darstellt: die Platte plus optional, wann sie gehört wurde.
 * @typedef {Object} DisplayItem
 * @property {string} key
 * @property {RecordItem} record
 * @property {string | null} playedAt
 */

/**
 * @typedef {Object} Resource
 * @property {'idle' | 'loading' | 'ready' | 'error'} status
 * @property {DisplayItem[]} items
 * @property {SourceError | null} error
 */

/**
 * @typedef {Object} AppState
 * @property {TabId} tab
 * @property {LayoutId} layout
 * @property {Record<TabId, Resource>} library
 * @property {RecordItem | null} openRecord   Platte, die gerade „auf dem Plattenteller" liegt
 * @property {boolean} playing                Tonarm liegt auf, Wiedergabe läuft
 *                                            (Schritt 2: erst nach Bestätigung durch Spotify)
 */

/** @type {TabId[]} */
export const TABS = ['playlists', 'albums', 'recent'];
/** @type {LayoutId[]} */
export const LAYOUTS = ['shelf', 'crate'];

const PREFS_KEY = 'vinyl-player:prefs:v1';

/** @returns {Resource} */
function emptyResource() {
  return { status: 'idle', items: [], error: null };
}

/** @returns {{ tab?: TabId, layout?: LayoutId }} */
function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return {
      tab: TABS.includes(raw.tab) ? raw.tab : undefined,
      layout: LAYOUTS.includes(raw.layout) ? raw.layout : undefined,
    };
  } catch {
    return {};
  }
}

/** @param {{ tab: TabId, layout: LayoutId }} prefs */
function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Privater Modus o. Ä.: Einstellungen gelten dann nur für diese Sitzung.
  }
}

export function createAppStore() {
  const prefs = loadPrefs();

  /** @type {AppState} */
  const initial = {
    tab: prefs.tab ?? 'playlists',
    layout: prefs.layout ?? 'crate',
    library: { playlists: emptyResource(), albums: emptyResource(), recent: emptyResource() },
    openRecord: null,
    playing: false,
  };

  const store = createStore(initial);
  store.subscribe((s, prev) => {
    if (s.tab !== prev.tab || s.layout !== prev.layout) savePrefs({ tab: s.tab, layout: s.layout });
  });
  return store;
}

/** @typedef {ReturnType<typeof createAppStore>} AppStore */
