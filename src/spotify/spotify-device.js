// @ts-check
// Spotify Connect als Abspielgerät (Schnittstelle PlaybackDevice).
//
// - Zielgerät: das gerade aktive; sonst ein iPad/Tablet; sonst das erste
//   verfügbare. Fehlt jedes Gerät (Spotify-App im Hintergrund eingefroren),
//   kommt SourceError('no-device') – die Oberfläche bietet „Spotify öffnen" an.
// - Zustand: GET /me/player in Abständen, sofort nach jedem Befehl und beim
//   Zurückkehren in die App. Ist die App verdeckt, wird nicht abgefragt.
// - „Einpacken" (stop): Spotify kennt kein Stopp – es wird pausiert und die
//   Platte lokal ausgeblendet, bis wieder etwas läuft.

import { SourceError } from '../data/errors.js';
import { mapTrack } from './spotify-source.js';

/** @typedef {import('../data/types.js').PlaybackDevice} PlaybackDevice */
/** @typedef {import('../data/types.js').PlaybackSnapshot} PlaybackSnapshot */
/** @typedef {import('./api.js').SpotifyApi} SpotifyApi */

const POLL_PLAYING_MS = 3000;
const POLL_IDLE_MS = 8000;
const POLL_ERROR_MS = 10_000;
const CONFIRM_DELAYS_MS = [400, 1500, 3200]; // Spotify übernimmt Befehle mit kurzer Verzögerung

/**
 * @param {SpotifyApi} api
 * @returns {PlaybackDevice}
 */
export function createSpotifyDevice(api) {
  /** @type {PlaybackSnapshot} */
  let state = { contextUri: null, index: -1, track: null, playing: false, positionMs: 0, at: Date.now(), deviceName: null };
  /** @type {Set<(s: PlaybackSnapshot) => void>} */
  const listeners = new Set();
  /** Platte, die „eingepackt" wurde – bleibt ausgeblendet, solange sie pausiert ist */
  /** @type {string | null} */
  let stoppedContext = null;
  /** @type {string | null} */
  let deviceId = null;
  let pollTimer = 0;
  let polling = false;
  let pollAgain = false;
  /** Zähler für Befehle – ältere Abfragen dürfen neuere Befehle nicht überschreiben */
  let commandSeq = 0;

  /** @param {PlaybackSnapshot} next */
  function emit(next) {
    state = next;
    for (const fn of listeners) {
      try {
        fn({ ...state });
      } catch (err) {
        console.error('[spotify-device] Abonnent fehlgeschlagen', err);
      }
    }
  }

  /** Antwort von GET /me/player → Snapshot */
  function toSnapshot(body) {
    if (!body) return { contextUri: null, index: -1, track: null, playing: false, positionMs: 0, at: Date.now(), deviceName: null };
    const playing = !!body.is_playing;
    let contextUri = body.context?.uri ?? null;
    if (playing) stoppedContext = null;
    if (contextUri && contextUri === stoppedContext) contextUri = null;
    if (body.device?.id) deviceId = body.device.id;
    return {
      contextUri,
      index: -1,
      track: mapTrack(body.item),
      playing,
      positionMs: body.progress_ms ?? 0,
      at: Date.now(),
      deviceName: body.device?.name ?? null,
    };
  }

  async function poll() {
    if (polling) {
      pollAgain = true;
      return;
    }
    polling = true;
    clearTimeout(pollTimer);
    const seq = commandSeq;
    let next = POLL_IDLE_MS;
    try {
      const body = await api.request('GET', '/me/player', { query: { additional_types: 'track' } });
      // Ein inzwischen gesendeter Befehl ist aktueller als diese Antwort.
      if (seq === commandSeq) emit(toSnapshot(body));
      next = state.playing ? POLL_PLAYING_MS : POLL_IDLE_MS;
    } catch (err) {
      if (!(err instanceof SourceError && err.kind === 'auth')) console.warn('[spotify-device] Status nicht abrufbar', err);
      next = POLL_ERROR_MS;
    } finally {
      polling = false;
    }
    if (pollAgain) {
      pollAgain = false;
      poll();
    } else {
      schedule(next);
    }
  }

  /** @param {number} ms */
  function schedule(ms) {
    clearTimeout(pollTimer);
    if (document.visibilityState === 'hidden' || listeners.size === 0) return;
    pollTimer = window.setTimeout(poll, ms);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
    else clearTimeout(pollTimer);
  });

  /** Nach einem Befehl den echten Zustand bestätigen lassen. */
  function confirmSoon() {
    for (const ms of CONFIRM_DELAYS_MS) window.setTimeout(poll, ms);
  }

  /** Zielgerät bestimmen: aktiv > iPad/Tablet > erstes verfügbares. */
  async function chooseDevice() {
    const body = await api.request('GET', '/me/player/devices');
    const devices = (body?.devices ?? []).filter((d) => d.id && !d.is_restricted);
    const pick = devices.find((d) => d.is_active)
      ?? devices.find((d) => /ipad/i.test(d.name) || d.type === 'Tablet')
      ?? devices[0];
    if (!pick) throw new SourceError('no-device');
    deviceId = pick.id;
    return /** @type {string} */ (pick.id);
  }

  /**
   * Befehl senden; meldet Spotify „kein aktives Gerät", wird einmal mit
   * ausdrücklich gewähltem Gerät wiederholt.
   * @param {'PUT' | 'POST'} method
   * @param {string} path
   * @param {unknown} [body]
   */
  async function command(method, path, body) {
    commandSeq++;
    const send = (/** @type {string | null} */ id) =>
      api.request(method, path, { query: id ? { device_id: id } : undefined, body });
    try {
      await send(deviceId);
    } catch (err) {
      if (!(err instanceof SourceError && err.kind === 'no-device')) throw err;
      await send(await chooseDevice());
    }
  }

  return {
    async play({ contextUri, index, positionMs = 0, tracks }) {
      const track = tracks[index];
      await command('PUT', '/me/player/play', {
        context_uri: contextUri,
        offset: track ? { uri: track.uri } : { position: Math.max(0, index) },
        position_ms: positionMs,
      });
      stoppedContext = null;
      emit({ ...state, contextUri, index, track: track ?? null, playing: true, positionMs, at: Date.now() });
      confirmSoon();
    },

    async pause() {
      try {
        await command('PUT', '/me/player/pause');
      } catch (err) {
        // Kein Gerät = es läuft ohnehin nichts.
        if (!(err instanceof SourceError && err.kind === 'no-device')) throw err;
      }
      const position = state.playing ? state.positionMs + (Date.now() - state.at) : state.positionMs;
      emit({ ...state, playing: false, positionMs: position, at: Date.now() });
      confirmSoon();
    },

    async resume() {
      await command('PUT', '/me/player/play');
      emit({ ...state, playing: true, at: Date.now() });
      confirmSoon();
    },

    async next() {
      await command('POST', '/me/player/next');
      confirmSoon();
    },

    async previous() {
      await command('POST', '/me/player/previous');
      confirmSoon();
    },

    async stop() {
      const context = state.contextUri;
      try {
        await command('PUT', '/me/player/pause');
      } catch (err) {
        if (!(err instanceof SourceError && err.kind === 'no-device')) throw err;
      }
      stoppedContext = context;
      emit({ ...state, contextUri: null, playing: false, at: Date.now() });
    },

    subscribe(fn) {
      listeners.add(fn);
      if (listeners.size === 1) poll();
      return () => {
        listeners.delete(fn);
        if (!listeners.size) clearTimeout(pollTimer);
      };
    },
  };
}
