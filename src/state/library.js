// @ts-check
// Lädt die Bibliothek aus der Datenquelle in den Zustand.
// - pro Tab höchstens eine laufende Anfrage, veraltete Antworten werden verworfen
// - vorübergehende Fehler (Netz, Timeout, 429) werden automatisch wiederholt
// - nach Rückkehr der Verbindung werden fehlgeschlagene Tabs neu geladen

import { isAbortError, toSourceError } from '../data/errors.js';

/** @typedef {import('../data/types.js').LibrarySource} LibrarySource */
/** @typedef {import('./app-state.js').AppStore} AppStore */
/** @typedef {import('./app-state.js').TabId} TabId */
/** @typedef {import('./app-state.js').Resource} Resource */
/** @typedef {import('./app-state.js').DisplayItem} DisplayItem */

/** Wartezeiten der automatischen Wiederholungen. */
const RETRY_DELAYS_MS = [800, 2000];

/**
 * @param {AppStore} store
 * @param {LibrarySource} source
 */
export function createLibrary(store, source) {
  /** @type {Map<TabId, AbortController>} */
  const inflight = new Map();

  /**
   * @param {TabId} tab
   * @param {Partial<Resource>} patch
   */
  function setResource(tab, patch) {
    store.set((s) => ({ library: { ...s.library, [tab]: { ...s.library[tab], ...patch } } }));
  }

  /**
   * @param {TabId} tab
   * @param {AbortSignal} signal
   * @returns {Promise<DisplayItem[]>}
   */
  async function fetchTab(tab, signal) {
    if (tab === 'recent') {
      const recent = await source.getRecentlyPlayed({ signal });
      // Eine Platte nur einmal zeigen (die jüngste Wiedergabe gewinnt).
      const seen = new Set();
      return recent.flatMap(({ record, playedAt }) => {
        if (seen.has(record.id)) return [];
        seen.add(record.id);
        return [{ key: record.id, record, playedAt }];
      });
    }
    const records = tab === 'albums' ? await source.getAlbums({ signal }) : await source.getPlaylists({ signal });
    return records.map((record) => ({ key: record.id, record, playedAt: null }));
  }

  /**
   * @param {number} ms
   * @param {AbortSignal} signal
   */
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  }

  /**
   * @param {TabId} tab
   * @param {{ force?: boolean }} [opts]
   */
  async function load(tab, { force = false } = {}) {
    const current = store.get().library[tab];
    if (!force && (current.status === 'loading' || current.status === 'ready')) return;

    inflight.get(tab)?.abort();
    const ctrl = new AbortController();
    inflight.set(tab, ctrl);
    setResource(tab, { status: 'loading', error: null });

    for (let attempt = 0; ; attempt++) {
      try {
        const items = await fetchTab(tab, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setResource(tab, { status: 'ready', items, error: null });
        break;
      } catch (err) {
        if (ctrl.signal.aborted || isAbortError(err)) return;
        const error = toSourceError(err);
        if (error.retryable && attempt < RETRY_DELAYS_MS.length) {
          try {
            await wait(error.retryAfterMs ?? RETRY_DELAYS_MS[attempt], ctrl.signal);
          } catch {
            return; // abgebrochen
          }
          continue;
        }
        setResource(tab, { status: 'error', error });
        break;
      }
    }
    if (inflight.get(tab) === ctrl) inflight.delete(tab);
  }

  window.addEventListener('online', () => {
    const { library } = store.get();
    for (const tab of /** @type {TabId[]} */ (Object.keys(library))) {
      if (library[tab].status === 'error') load(tab, { force: true });
    }
  });

  return { load };
}
