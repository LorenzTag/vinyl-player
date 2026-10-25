// @ts-check
// Eigene Regale im Plattenschrank: Name, Reihenfolge und welche Platten darin
// stehen. Gespeichert pro Gerät (localStorage). Daraus entstehen die Zeilen:
//
//   „Zuletzt gehört" (automatisch, abschaltbar)
//   eigene Regale in deiner Reihenfolge
//   „Nicht einsortiert" (automatisch: alles, was noch in keinem Regal steht)
//
// Platten werden über ihre Spotify-URI gemerkt; verschwindet eine Platte aus
// der Bibliothek, fällt sie einfach weg.

/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {import('./app-state.js').DisplayItem} DisplayItem */
/** @typedef {import('./app-state.js').AppState} AppState */

/**
 * @typedef {Object} Shelf
 * @property {string} id
 * @property {string} name
 * @property {string[]} uris
 */

/**
 * @typedef {Object} ShelfConfig
 * @property {Shelf[]} shelves
 * @property {boolean} showRecent   Zeile „Zuletzt gehört" oben anzeigen
 * @property {boolean} setupDone    Einrichten wurde einmal abgeschlossen
 */

/**
 * @typedef {Object} Row
 * @property {string} id
 * @property {string} name
 * @property {'recent' | 'shelf' | 'unsorted'} kind
 * @property {DisplayItem[]} items
 */

const KEY = 'vinyl-player:shelves:v1';

/** @returns {ShelfConfig | null} */
export function loadShelfConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || !Array.isArray(raw.shelves)) return null;
    return {
      shelves: raw.shelves
        .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.uris))
        .map((s) => ({ id: s.id, name: s.name, uris: s.uris.filter((u) => typeof u === 'string') })),
      showRecent: raw.showRecent !== false,
      setupDone: raw.setupDone === true,
    };
  } catch {
    return null;
  }
}

/** @param {ShelfConfig} config */
export function saveShelfConfig(config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Speicher voll/gesperrt: Regale gelten dann nur für diese Sitzung.
  }
}

/**
 * Startaufteilung: ein Regal für Playlists, eins für Alben.
 * @param {AppState['library']} library
 * @returns {ShelfConfig}
 */
export function defaultShelfConfig(library) {
  return {
    shelves: [
      { id: 'playlists', name: 'Playlists', uris: library.playlists.items.map((i) => i.record.uri) },
      { id: 'albums', name: 'Alben', uris: library.albums.items.map((i) => i.record.uri) },
    ],
    showRecent: true,
    setupDone: false,
  };
}

/**
 * Alle Platten der Bibliothek (Playlists und Alben) nach URI.
 * @param {AppState['library']} library
 */
export function recordsByUri(library) {
  /** @type {Map<string, RecordItem>} */
  const map = new Map();
  for (const item of [...library.playlists.items, ...library.albums.items]) map.set(item.record.uri, item.record);
  return map;
}

/**
 * Zeilen des Plattenschranks aus Regalen und Bibliothek.
 * @param {ShelfConfig} config
 * @param {AppState['library']} library
 * @returns {Row[]}
 */
export function buildRows(config, library) {
  const records = recordsByUri(library);
  /** @type {Row[]} */
  const rows = [];

  if (config.showRecent && library.recent.items.length) {
    rows.push({ id: 'recent', name: 'Zuletzt gehört', kind: 'recent', items: library.recent.items });
  }

  const placed = new Set();
  for (const shelf of config.shelves) {
    const items = [];
    for (const uri of shelf.uris) {
      const record = records.get(uri);
      if (!record || placed.has(uri)) continue; // jede Platte nur in einem Regal
      placed.add(uri);
      items.push({ key: record.id, record, playedAt: null });
    }
    rows.push({ id: shelf.id, name: shelf.name, kind: 'shelf', items });
  }

  const unsorted = [...records.values()]
    .filter((r) => !placed.has(r.uri))
    .map((record) => ({ key: record.id, record, playedAt: null }));
  if (unsorted.length) rows.push({ id: 'unsorted', name: 'Nicht einsortiert', kind: 'unsorted', items: unsorted });

  return rows;
}

// ---------- Änderungen (geben jeweils eine neue Konfiguration zurück) ----------

/** @param {ShelfConfig} config @param {string} name @returns {{ config: ShelfConfig, id: string }} */
export function addShelf(config, name) {
  const id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return { config: { ...config, shelves: [...config.shelves, { id, name, uris: [] }] }, id };
}

/** @param {ShelfConfig} config @param {string} id @param {string} name */
export function renameShelf(config, id, name) {
  const clean = name.trim().slice(0, 40) || 'Regal';
  return { ...config, shelves: config.shelves.map((s) => (s.id === id ? { ...s, name: clean } : s)) };
}

/** Regal entfernen – seine Platten landen in „Nicht einsortiert". @param {ShelfConfig} config @param {string} id */
export function removeShelf(config, id) {
  return { ...config, shelves: config.shelves.filter((s) => s.id !== id) };
}

/** @param {ShelfConfig} config @param {string} id @param {number} delta */
export function moveShelf(config, id, delta) {
  const shelves = [...config.shelves];
  const from = shelves.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= shelves.length) return config;
  const [shelf] = shelves.splice(from, 1);
  shelves.splice(to, 0, shelf);
  return { ...config, shelves };
}

/**
 * Platten in ein Regal stellen (aus allen anderen heraus); `shelfId` null =
 * „Nicht einsortiert".
 * @param {ShelfConfig} config @param {string[]} uris @param {string | null} shelfId
 */
export function assign(config, uris, shelfId) {
  const moving = new Set(uris);
  return {
    ...config,
    shelves: config.shelves.map((s) => {
      const rest = s.uris.filter((u) => !moving.has(u));
      return s.id === shelfId ? { ...s, uris: [...rest, ...uris] } : { ...s, uris: rest };
    }),
  };
}
