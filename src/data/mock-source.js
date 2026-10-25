// @ts-check
// Mock-Datenquelle mit derselben Schnittstelle wie die spätere Spotify-Quelle.
// Simuliert Latenz und – per URL-Parameter – Fehlerfälle, damit Lade-, Fehler-
// und Leer-Zustände der UI schon jetzt getestet werden können:
//   ?mock=slow   2,5 s Ladezeit
//   ?mock=error  jede Anfrage scheitert (Netzwerkfehler)
//   ?mock=flaky  jede erste Anfrage pro Liste scheitert, der zweite Versuch klappt
//   ?mock=empty  leere Bibliothek

import { SourceError } from './errors.js';
import { hashString, seededRandom } from '../lib/seeded.js';

/** @typedef {import('./types.js').RecordItem} RecordItem */
/** @typedef {import('./types.js').Track} Track */
/** @typedef {import('./types.js').RecentItem} RecentItem */
/** @typedef {import('./types.js').LibrarySource} LibrarySource */
/** @typedef {import('./types.js').RequestOptions} RequestOptions */

/** @type {RecordItem[]} */
const PLAYLISTS = [
  playlist('pl-sonntag', 'Sonntagmorgen', 'Lorenz', 34),
  playlist('pl-kochen', 'Kochen mit Jazz', 'Lorenz', 52),
  playlist('pl-nightdrive', 'Late Night Drive', 'Lorenz', 41),
  playlist('pl-focus', 'Fokus · Deep Work', 'Spotify', 120),
  playlist('pl-regen', 'Regentage', 'Lorenz', 27),
  playlist('pl-sommer86', "Sommer '86", 'Lorenz', 63),
  playlist('pl-dinner', 'Dinner for Two', 'Lorenz', 38),
  playlist('pl-discover', 'Discover Weekly', 'Spotify', 30),
  playlist('pl-radar', 'Release Radar', 'Spotify', 30),
  playlist('pl-klassiker', 'Vinyl-Klassiker', 'Lorenz', 88),
  playlist('pl-garten', 'Gartenparty', 'Lorenz', 46),
  playlist('pl-schlafen', 'Einschlafen', 'Lorenz', 25),
];

/** @type {RecordItem[]} */
const ALBUMS = [
  album('al-nachtfahrt', 'Nachtfahrt', 'Die Laternen', 1978, 9),
  album('al-copper', 'Copper Skies', 'Mara Lindqvist', 1971, 10),
  album('al-bluehour', 'Blue Hour Sessions', 'The Elm Street Quartet', 1959, 6),
  album('al-salzwasser', 'Salzwasser', 'Kapelle Nordwind', 1984, 11),
  album('al-velvet', 'Velvet Static', 'Juno & The Wires', 1993, 12),
  album('al-papermoons', 'Paper Moons', 'Odile Fontaine', 1966, 10),
  album('al-lowlands', 'Lowlands', 'Harbor Lights', 2004, 13),
  album('al-kometen', 'Kometen', 'Ilse Brandt Trio', 1975, 7),
  album('al-slowburn', 'Slow Burn', 'Marcus Delane', 1969, 9),
  album('al-analog', 'Analog Heart', 'Sundial', 2012, 11),
  album('al-wildflower', 'Wildflower Radio', 'The Prairie Union', 1997, 12),
  album('al-mitternacht', 'Mitternachtsblau', 'Lena Vogt', 1988, 10),
];

/** [Platten-ID, Minuten seit dem Hören] */
const RECENT = /** @type {const} */ ([
  ['al-copper', 12],
  ['pl-kochen', 95],
  ['al-bluehour', 180],
  ['pl-nightdrive', 60 * 22],
  ['al-nachtfahrt', 60 * 26],
  ['pl-discover', 60 * 30],
  ['al-papermoons', 60 * 50],
  ['pl-sonntag', 60 * 74],
]);

/**
 * @param {string} id @param {string} title @param {string} owner @param {number} trackCount
 * @returns {RecordItem}
 */
function playlist(id, title, owner, trackCount) {
  return { id, uri: `spotify:playlist:${id}`, kind: 'playlist', title, subtitle: owner, trackCount, year: null, imageUrl: null };
}

/**
 * @param {string} id @param {string} title @param {string} artist @param {number} year @param {number} trackCount
 * @returns {RecordItem}
 */
function album(id, title, artist, year, trackCount) {
  return { id, uri: `spotify:album:${id}`, kind: 'album', title, subtitle: artist, trackCount, year, imageUrl: null };
}

// Bausteine für erfundene Titel und Künstler der Playlists
const WORDS_A = ['Silver', 'Midnight', 'Golden', 'Quiet', 'Electric', 'Paper', 'Velvet', 'Lonely', 'Summer', 'Northern',
  'Slow', 'Blue', 'Hidden', 'Wild', 'Late', 'Copper', 'Gentle', 'Neon', 'Distant', 'Warm'];
const WORDS_B = ['Rain', 'Harbor', 'Avenue', 'Letters', 'Lights', 'Ferry', 'Garden', 'Signal', 'Morning', 'Waltz',
  'Motel', 'Tide', 'Radio', 'Season', 'Echo', 'Frontier', 'Window', 'River', 'Satellite', 'Parade'];
const TITLES_DE = ['Letzte Ausfahrt', 'Fernweh', 'Nachtzug', 'Kleine Stadt', 'Sonntagslicht', 'Leuchtturm',
  'Am Kanal', 'Sommerregen', 'Zwischen den Jahren', 'Funkstille', 'Kopfkino', 'Weites Land'];
const PLAYLIST_ARTISTS = ['Die Laternen', 'Mara Lindqvist', 'The Elm Street Quartet', 'Kapelle Nordwind',
  'Juno & The Wires', 'Odile Fontaine', 'Harbor Lights', 'Ilse Brandt Trio', 'Marcus Delane', 'Sundial',
  'The Prairie Union', 'Lena Vogt', 'Moss & Ember', 'Fjord Radio'];

/**
 * Erfundene, aber stabile Titelliste für eine Platte.
 * @param {RecordItem} record
 * @returns {Track[]}
 */
function tracksFor(record) {
  const random = seededRandom(hashString(`${record.id}:tracks`));
  const pick = (/** @type {string[]} */ list) => list[Math.floor(random() * list.length)];
  return Array.from({ length: record.trackCount }, (_, i) => {
    const title = random() < 0.3 ? pick(TITLES_DE) : `${pick(WORDS_A)} ${pick(WORDS_B)}`;
    return {
      id: `${record.id}-t${i + 1}`,
      uri: `spotify:track:${record.id}-t${i + 1}`,
      title,
      artists: record.kind === 'album' ? record.subtitle : pick(PLAYLIST_ARTISTS),
      durationMs: Math.round((150 + random() * 180) * 1000),
    };
  });
}

/**
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/**
 * @param {string} [mode]  Wert des URL-Parameters `mock`
 * @returns {LibrarySource}
 */
export function createMockSource(mode = '') {
  const latency = mode === 'slow' ? 2500 : 350;
  /** @type {Set<string>} */
  const failedOnce = new Set();

  /**
   * @template T
   * @param {string} key
   * @param {() => T} produce
   * @param {RequestOptions} [opts]
   * @returns {Promise<T>}
   */
  async function respond(key, produce, opts) {
    await delay(latency, opts?.signal);
    if (mode === 'error') throw new SourceError('network');
    if (mode === 'flaky' && !failedOnce.has(key)) {
      failedOnce.add(key);
      throw new SourceError('network');
    }
    return produce();
  }

  const byId = new Map([...PLAYLISTS, ...ALBUMS].map((r) => [r.id, r]));

  return {
    name: 'mock',

    getPlaylists(opts) {
      return respond('playlists', () => (mode === 'empty' ? [] : PLAYLISTS.map((r) => ({ ...r }))), opts);
    },

    getAlbums(opts) {
      return respond('albums', () => (mode === 'empty' ? [] : ALBUMS.map((r) => ({ ...r }))), opts);
    },

    getRecentlyPlayed(opts) {
      return respond('recent', () => {
        if (mode === 'empty') return [];
        const now = Date.now();
        return RECENT.flatMap(([id, minutesAgo]) => {
          const record = byId.get(id);
          return record ? [{ record: { ...record }, playedAt: new Date(now - minutesAgo * 60_000).toISOString() }] : [];
        });
      }, opts);
    },

    getTracks(record, opts) {
      return respond(`tracks:${record.id}`, () => tracksFor(record), opts);
    },

    async getRecord(uri) {
      const record = [...PLAYLISTS, ...ALBUMS].find((r) => r.uri === uri);
      return record ? { ...record } : null;
    },
  };
}
