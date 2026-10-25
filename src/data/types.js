// @ts-check
// Domänen-Typen der App. Bewusst unabhängig vom Spotify-JSON: Die Spotify-Quelle
// (Schritt 2) übersetzt API-Antworten in genau diese Formen, die UI kennt nur sie.

/**
 * @typedef {'playlist' | 'album'} RecordKind
 */

/**
 * Eine „Platte" in der Sammlung: ein Album oder eine Playlist.
 *
 * @typedef {Object} RecordItem
 * @property {string} id             Spotify-ID (Mock: frei gewählt)
 * @property {string} uri            z. B. "spotify:album:…" – später Wiedergabe-Kontext
 * @property {RecordKind} kind
 * @property {string} title
 * @property {string} subtitle       Künstler (Album) bzw. Ersteller (Playlist)
 * @property {number} trackCount
 * @property {number | null} year    Erscheinungsjahr (nur Alben)
 * @property {string | null} imageUrl Cover-URL; null → generiertes Platzhalter-Cover
 */

/**
 * Eintrag in „Zuletzt gehört". Spotify liefert dort Titel samt Kontext
 * (Album/Playlist, aus dem gespielt wurde); die App zeigt den Kontext als Platte.
 *
 * @typedef {Object} RecentItem
 * @property {RecordItem} record
 * @property {string} playedAt       ISO-Zeitstempel
 */

/**
 * @typedef {Object} RequestOptions
 * @property {AbortSignal} [signal]
 */

/**
 * Schnittstelle jeder Datenquelle (Mock jetzt, Spotify in Schritt 2).
 * Fehler werden immer als SourceError geworfen (siehe errors.js).
 *
 * @typedef {Object} LibrarySource
 * @property {string} name
 * @property {(opts?: RequestOptions) => Promise<RecordItem[]>} getPlaylists
 * @property {(opts?: RequestOptions) => Promise<RecordItem[]>} getAlbums
 * @property {(opts?: RequestOptions) => Promise<RecentItem[]>} getRecentlyPlayed
 */

export {};
