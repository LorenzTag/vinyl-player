// @ts-check
// Domänen-Typen der App. Bewusst unabhängig vom Spotify-JSON: Die Spotify-Quelle
// übersetzt API-Antworten in genau diese Formen, die UI kennt nur sie.

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
 * Ein Titel auf einer Platte.
 *
 * @typedef {Object} Track
 * @property {string} id
 * @property {string} uri            z. B. "spotify:track:…"
 * @property {string} title
 * @property {string} artists        Künstler, kommagetrennt
 * @property {number} durationMs
 * @property {string | null} [imageUrl]  Cover des Albums, auf dem der Titel erschien
 */

/**
 * @typedef {Object} RequestOptions
 * @property {AbortSignal} [signal]
 */

/**
 * Schnittstelle jeder Datenquelle (Demo oder Spotify).
 * Fehler werden immer als SourceError geworfen (siehe errors.js).
 *
 * @typedef {Object} LibrarySource
 * @property {string} name
 * @property {(opts?: RequestOptions) => Promise<RecordItem[]>} getPlaylists
 * @property {(opts?: RequestOptions) => Promise<RecordItem[]>} getAlbums
 * @property {(opts?: RequestOptions) => Promise<RecentItem[]>} getRecentlyPlayed
 * @property {(record: RecordItem, opts?: RequestOptions) => Promise<Track[]>} getTracks
 * @property {(uri: string, opts?: RequestOptions) => Promise<RecordItem | null>} getRecord
 *           Platte per URI nachschlagen (z. B. was gerade auf einem anderen Gerät läuft)
 */

/**
 * Zustand des Abspielgeräts, wie es ihn meldet (Spotify: GET /me/player).
 *
 * @typedef {Object} PlaybackSnapshot
 * @property {string | null} contextUri  laufende Platte (Album/Playlist) oder null
 * @property {number} index              Titel-Index innerhalb der Platte, -1 = unbekannt
 *                                       (Spotify nennt keinen Index – er folgt aus `track.uri`)
 * @property {Track | null} track        aktueller Titel (auch wenn er in keiner Liste steht)
 * @property {boolean} playing
 * @property {number} positionMs         Position im Titel zum Zeitpunkt `at`
 * @property {number} at                 Date.now() der Messung (zum Hochrechnen)
 * @property {string | null} deviceName  Gerät, auf dem gerade gespielt wird
 */

/**
 * Schnittstelle des Abspielgeräts (Demo oder Spotify Connect).
 * Befehle werfen bei Fehlern einen SourceError (z. B. 'no-device').
 *
 * @typedef {Object} PlaybackDevice
 * @property {(cmd: { contextUri: string, index: number, positionMs?: number, tracks: Track[] }) => Promise<void>} play
 *           `tracks` darf leer sein (z. B. fremde Playlist) – dann zählt nur `index`.
 * @property {() => Promise<void>} pause
 * @property {() => Promise<void>} resume
 * @property {() => Promise<void>} next
 * @property {() => Promise<void>} previous
 * @property {() => Promise<void>} stop       Wiedergabe beenden, Platte „einpacken"
 * @property {(fn: (snapshot: PlaybackSnapshot) => void) => () => void} subscribe
 */

export {};
