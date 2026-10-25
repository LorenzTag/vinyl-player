// @ts-check
// Einstiegspunkt: entscheidet zwischen Spotify und Demo, kümmert sich um die
// Rückkehr vom Spotify-Login und startet dann Datenquelle → Zustand → Oberfläche.

import { SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES, redirectUri } from './config.js';
import { createLibrarySource } from './data/source.js';
import { createAppStore } from './state/app-state.js';
import { createLibrary } from './state/library.js';
import { createPlayback } from './state/playback.js';
import { createPlaybackDevice } from './playback/device.js';
import { createAuth, canLogin } from './spotify/auth.js';
import { createApi } from './spotify/api.js';
import { createSpotifySource } from './spotify/spotify-source.js';
import { createSpotifyDevice } from './spotify/spotify-device.js';
import { createApp } from './ui/app.js';
import { createLoginScreen } from './ui/login.js';
import { createAccountButton } from './ui/account.js';

/** @typedef {import('./data/types.js').LibrarySource} LibrarySource */
/** @typedef {import('./data/types.js').PlaybackDevice} PlaybackDevice */

const DEMO_KEY = 'vinyl-player:demo';

// iOS wendet :active-Stile nur an, wenn irgendwo ein touchstart-Listener hängt.
document.addEventListener('touchstart', () => {}, { passive: true });

window.addEventListener('error', (event) => console.error('[app] Fehler', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => console.error('[app] Unbehandelte Promise', event.reason));

const root = /** @type {HTMLElement} */ (document.getElementById('app'));
if (!root) throw new Error('#app fehlt in index.html');

const params = new URLSearchParams(window.location.search);

function isDemo() {
  try {
    return params.has('mock') || sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return params.has('mock');
  }
}

function startDemo() {
  try {
    sessionStorage.setItem(DEMO_KEY, '1');
  } catch {
    // ohne Speicher bleibt es beim Parameter
  }
  window.location.replace(`${redirectUri()}?mock=demo`);
}

function endDemo() {
  try {
    sessionStorage.removeItem(DEMO_KEY);
  } catch {
    // egal
  }
  window.location.replace(redirectUri());
}

/**
 * @param {{ source: LibrarySource, device: PlaybackDevice, account: ReturnType<typeof createAccountButton>, onLogin?: () => void }} deps
 */
function startApp({ source, device, account, onLogin }) {
  const store = createAppStore();
  const library = createLibrary(store, source);
  const playback = createPlayback(store, source, device);
  createApp(root, { store, library, playback, account, onLogin });

  // Nach „Spotify öffnen" zurück in der App: gescheiterten Befehl einmal wiederholen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(() => playback.retryAfterWake(), 800);
  });
}

if (isDemo()) {
  startApp({
    source: createLibrarySource(params),
    device: createPlaybackDevice(params),
    account: createAccountButton({
      label: 'Demo',
      detail: 'Beispieldaten, ohne Spotify',
      actions: [{ label: 'Demo beenden', onAction: endDemo, danger: true }],
    }),
  });
} else {
  const auth = createAuth({ clientId: SPOTIFY_CLIENT_ID, redirectUri: redirectUri(), scopes: SPOTIFY_SCOPES });
  const result = await auth.handleRedirect();

  if (!auth.isLoggedIn()) {
    root.replaceChildren(createLoginScreen({
      canLogin: canLogin(),
      hasClientId: !!SPOTIFY_CLIENT_ID,
      message: result && !result.ok ? result.message : null,
      onLogin: () => auth.login(),
      onDemo: startDemo,
    }));
  } else {
    const api = createApi(auth);
    const account = createAccountButton({
      label: 'Spotify',
      detail: 'Angemeldet bei Spotify',
      actions: [{ label: 'Abmelden', onAction: () => auth.logout(), danger: true }],
    });
    // Abgemeldet (auch wenn Spotify das Token widerruft) → zurück zum Startbildschirm.
    auth.onLogout(() => window.location.replace(redirectUri()));

    startApp({
      source: createSpotifySource(api),
      device: createSpotifyDevice(api),
      account,
      onLogin: () => auth.login(),
    });

    // Profilname nur zur Anzeige – Fehler sind hier egal.
    api.request('GET', '/me').then((me) => {
      if (me?.display_name) account.setLabel(me.display_name);
    }, () => {});
  }
}
