// @ts-check
// Simuliertes Abspielgerät – dieselbe Schnittstelle wie später Spotify Connect
// (PlaybackDevice in data/types.js). Es spielt keinen Ton, verwaltet aber
// Titel, Position, Pause und springt am Titelende weiter.
//
//   ?mock=nodevice   jeder Abspielbefehl scheitert mit „kein aktives Gerät"

import { SourceError } from '../data/errors.js';

/** @typedef {import('../data/types.js').Track} Track */
/** @typedef {import('../data/types.js').PlaybackDevice} PlaybackDevice */
/** @typedef {import('../data/types.js').PlaybackSnapshot} PlaybackSnapshot */

const LATENCY_MS = 120; // ungefähr wie eine schnelle Web-API-Antwort
const RESTART_AFTER_MS = 3000; // „Zurück" nach 3 s: Titel neu starten statt vorheriger

/**
 * @param {string} [mode]  Wert des URL-Parameters `mock`
 * @returns {PlaybackDevice}
 */
export function createMockDevice(mode = '') {
  /** @type {PlaybackSnapshot} */
  let state = { contextUri: null, index: 0, track: null, playing: false, positionMs: 0, at: Date.now(), deviceName: 'Demo-Plattenspieler' };
  /** @type {Track[]} */
  let tracks = [];
  let endTimer = 0;
  /** @type {Set<(s: PlaybackSnapshot) => void>} */
  const listeners = new Set();

  const delay = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

  /** aktuelle Position im Titel */
  function position() {
    return state.playing ? state.positionMs + (Date.now() - state.at) : state.positionMs;
  }

  /** @param {Partial<PlaybackSnapshot>} patch */
  function set(patch) {
    state = { ...state, ...patch, at: Date.now() };
    state.track = state.contextUri ? tracks[state.index] ?? null : null;
    clearTimeout(endTimer);
    const track = tracks[state.index];
    if (state.playing && track) {
      endTimer = window.setTimeout(onTrackEnd, Math.max(0, track.durationMs - state.positionMs));
    }
    const snapshot = { ...state };
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch (err) {
        console.error('[mock-device] Abonnent fehlgeschlagen', err);
      }
    }
  }

  function onTrackEnd() {
    if (state.index + 1 < tracks.length) {
      set({ index: state.index + 1, positionMs: 0 });
    } else {
      // Ende der Platte: Nadel läuft aus, Wiedergabe stoppt am Anfang.
      set({ index: 0, positionMs: 0, playing: false });
    }
  }

  function requireContext() {
    if (!state.contextUri) throw new SourceError('no-device', { message: 'Es läuft gerade keine Platte.' });
  }

  return {
    async play({ contextUri, index, positionMs = 0, tracks: list }) {
      await delay();
      if (mode === 'nodevice') throw new SourceError('no-device');
      tracks = list;
      set({ contextUri, index: Math.max(0, Math.min(index, list.length - 1)), positionMs, playing: true });
    },

    async pause() {
      await delay();
      if (!state.contextUri) return;
      set({ positionMs: position(), playing: false });
    },

    async resume() {
      await delay();
      requireContext();
      if (mode === 'nodevice') throw new SourceError('no-device');
      set({ positionMs: position(), playing: true });
    },

    async next() {
      await delay();
      requireContext();
      if (state.index + 1 < tracks.length) set({ index: state.index + 1, positionMs: 0 });
      else set({ index: 0, positionMs: 0, playing: false });
    },

    async previous() {
      await delay();
      requireContext();
      if (position() > RESTART_AFTER_MS || state.index === 0) set({ positionMs: 0 });
      else set({ index: state.index - 1, positionMs: 0 });
    },

    async stop() {
      await delay();
      tracks = [];
      set({ contextUri: null, index: 0, positionMs: 0, playing: false });
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
