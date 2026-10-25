// @ts-check
// Einstellungen für die Spotify-Anbindung.
//
// Die Client ID stammt aus dem Spotify-Dashboard (developer.spotify.com).
// Sie ist kein Geheimnis: Der Login nutzt PKCE und braucht kein Client Secret.
// Das Secret gehört NIE in diesen Code.

export const SPOTIFY_CLIENT_ID = '2f1744da4c6d42d6a317f6003728c9a7';

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
