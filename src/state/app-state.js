// @ts-check
// Form des App-Zustands, Startwerte und gemerkte Einstellungen (localStorage).

import { createStore } from './store.js';
import { loadShelfConfig, saveShelfConfig } from './shelves.js';

/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {import('../data/types.js').Track} Track */
/** @typedef {import('../data/errors.js').SourceError} SourceError */

/** Teile der Bibliothek, die geladen werden */
/** @typedef {'playlists' | 'albums' | 'recent'} TabId */
/** @typedef {import('./shelves.js').ShelfConfig} ShelfConfig */

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
 * @property {Record<TabId, Resource>} library
 * @property {ShelfConfig | null} shelfConfig   eigene Regale (null = noch nie eingerichtet)
 * @property {string | null} focusRow         Regal-Zeile im Blick (wird gemerkt)
 * @property {RecordItem | null} openRecord   Platte, die gerade im Plattenspieler-Bildschirm liegt
 * @property {Playback} playback              was das Abspielgerät gerade spielt
 * @property {Record<string, TrackList>} tracklists  Titellisten je Platten-ID (Cache)
 */

/**
 * @typedef {Object} TrackList
 * @property {'idle' | 'loading' | 'ready' | 'error'} status
 * @property {Track[]} items
 * @property {SourceError | null} error
 */

/**
 * Spiegel des Abspielgeräts. Quelle der Wahrheit sind die Meldungen des Geräts
 * (Demo-Gerät bzw. Spotify), nicht die Absichten der Oberfläche.
 *
 * @typedef {Object} Playback
 * @property {RecordItem | null} context   laufende Platte (auch pausiert) oder null
 * @property {Track[]} tracks              Titel der laufenden Platte
 * @property {number} index                aktueller Titel in `tracks`, -1 = nicht in der Liste
 * @property {Track | null} track          aktueller Titel laut Gerät (auch ohne Titelliste)
 * @property {boolean} playing
 * @property {number} positionMs           Position zum Zeitpunkt `at`
 * @property {number} at                   Date.now() der Messung
 * @property {boolean} pending             ein Befehl ist unterwegs
 * @property {SourceError | null} error    letzter fehlgeschlagener Befehl
 * @property {string | null} deviceName    Gerät, auf dem gespielt wird
 * @property {boolean} shuffle             Zufallswiedergabe an?
 * @property {Track[]} queue               als Nächstes (echte Reihenfolge, auch bei Shuffle)
 * @property {string | null} queueFor      Titel-URI, zu dem `queue` gehört (sonst veraltet)
 */

/** @type {TabId[]} */
export const TABS = ['playlists', 'albums', 'recent'];

const PREFS_KEY = 'vinyl-player:prefs:v1';

/** @returns {Resource} */
function emptyResource() {
  return { status: 'idle', items: [], error: null };
}

/** @returns {{ focusRow?: string }} */
function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { focusRow: typeof raw.focusRow === 'string' ? raw.focusRow : undefined };
  } catch {
    return {};
  }
}

/** @param {{ focusRow: string | null }} prefs */
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
    library: { playlists: emptyResource(), albums: emptyResource(), recent: emptyResource() },
    openRecord: null,
    playback: {
      context: null,
      tracks: [],
      index: -1,
      track: null,
      playing: false,
      positionMs: 0,
      at: Date.now(),
      pending: false,
      error: null,
      deviceName: null,
      shuffle: false,
      queue: [],
      queueFor: null,
    },
    tracklists: {},
    shelfConfig: loadShelfConfig(),
    focusRow: prefs.focusRow ?? null,
  };

  const store = createStore(initial);
  store.subscribe((s, prev) => {
    if (s.focusRow !== prev.focusRow) savePrefs({ focusRow: s.focusRow });
    if (s.shelfConfig !== prev.shelfConfig && s.shelfConfig) saveShelfConfig(s.shelfConfig);
  });
  return store;
}

/** @typedef {ReturnType<typeof createAppStore>} AppStore */
