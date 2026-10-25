// @ts-check
// Einstellungen für die Spotify-Anbindung.
//
// Die Client ID stammt aus dem Spotify-Dashboard (developer.spotify.com).
// Sie ist kein Geheimnis: Der Login nutzt PKCE und braucht kein Client Secret.
// Das Secret gehört NIE in diesen Code.
//
// Wer eine eigene Spotify-App angelegt hat, kann deren Client ID auf dem
// Anmeldebildschirm eingeben; sie gilt dann auf diesem Gerät statt der hier
// eingetragenen.

const DEFAULT_CLIENT_ID = '2f1744da4c6d42d6a317f6003728c9a7';
const CLIENT_ID_KEY = 'vinyl-player:client-id:v1';

/** Eigene Client ID auf diesem Gerät, sonst null. */
export function customClientId() {
  try {
    const id = localStorage.getItem(CLIENT_ID_KEY);
    return id && isValidClientId(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Eigene Client ID merken (null = wieder die eingetragene verwenden).
 * @param {string | null} id
 */
export function setCustomClientId(id) {
  try {
    if (id) localStorage.setItem(CLIENT_ID_KEY, id);
    else localStorage.removeItem(CLIENT_ID_KEY);
  } catch {
    // ohne Speicher (privater Modus) geht nur die eingetragene Client ID
  }
}

/** Die Client ID, mit der sich die App anmeldet. */
export function spotifyClientId() {
  return customClientId() ?? DEFAULT_CLIENT_ID;
}

/** Spotify Client IDs sind 32 Hex-Zeichen. @param {string} id */
export function isValidClientId(id) {
  return /^[0-9a-f]{32}$/i.test(id);
}

/** Berechtigungen, die die App bei Spotify anfragt */
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',     // was läuft, auf welchem Gerät
  'user-modify-playback-state',   // abspielen, pausieren, springen
  'user-read-currently-playing',
  'user-read-recently-played',    // Tab „Zuletzt gehört"
  'user-library-read',            // gespeicherte Alben
  'playlist-read-private',        // eigene und gefolgte Playlists
  'playlist-read-collaborative',
];

/**
 * Redirect-URI = die Adresse der App ohne Query und ohne „index.html".
 * Muss exakt so im Spotify-Dashboard eingetragen sein, z. B.
 *   http://127.0.0.1:8080/                      (Entwicklung am Mac)
 *   https://lorenztag.github.io/vinyl-player/   (GitHub Pages, fürs iPad)
 */
export function redirectUri() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/index\.html$/, '');
  return url.toString();
}
