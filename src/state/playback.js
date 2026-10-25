// @ts-check
// Wiedergabe-Steuerung: verbindet Oberfläche, Datenquelle (Titellisten) und
// Abspielgerät. Die Oberfläche ruft nur diese Absichten auf; der Zustand
// `playback` wird ausschließlich aus den Meldungen des Geräts gesetzt.
//
// - Befehle laufen nacheinander (kein Durcheinander bei schnellem Tippen)
// - Fehler landen in `playback.error`, die Oberfläche zeigt sie an
// - Titellisten werden je Platte einmal geladen und zwischengespeichert

import { SourceError, isAbortError, toSourceError } from '../data/errors.js';

/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {import('../data/types.js').Track} Track */
/** @typedef {import('../data/types.js').LibrarySource} LibrarySource */
/** @typedef {import('../data/types.js').PlaybackDevice} PlaybackDevice */
/** @typedef {import('./app-state.js').AppStore} AppStore */
/** @typedef {import('./app-state.js').Playback} Playback */
/** @typedef {import('./app-state.js').TrackList} TrackList */

const TRACK_RETRIES_MS = [800];

/**
 * @param {AppStore} store
 * @param {LibrarySource} source
 * @param {PlaybackDevice} device
 */
export function createPlayback(store, source, device) {
  /** @type {Map<string, Promise<Track[]>>} */
  const loadingTracks = new Map();
  /** Platte, die gerade gestartet wird – ordnet die nächste Gerätemeldung zu. */
  /** @type {{ record: RecordItem, tracks: Track[] } | null} */
  let starting = null;
  /** Warteschlange: Befehle nacheinander ausführen */
  let queue = Promise.resolve();

  /** @param {Partial<Playback>} patch */
  function setPlayback(patch) {
    store.set((s) => ({ playback: { ...s.playback, ...patch } }));
  }

  /**
   * @param {string} id
   * @param {Partial<TrackList>} patch
   */
  function setTrackList(id, patch) {
    store.set((s) => {
      const current = s.tracklists[id] ?? { status: 'idle', items: [], error: null };
      return { tracklists: { ...s.tracklists, [id]: { ...current, ...patch } } };
    });
  }

  // Meldungen des Geräts sind die Wahrheit.
  device.subscribe((snapshot) => {
    const { playback } = store.get();
    let { context, tracks } = playback;
    if (!snapshot.contextUri) {
      context = null;
      tracks = [];
    } else if (starting && starting.record.uri === snapshot.contextUri) {
      context = starting.record;
      tracks = starting.tracks;
    } else if (context?.uri !== snapshot.contextUri) {
      // Unbekannte Platte (in Schritt 2: z. B. am Handy gestartet) – ohne Titelliste.
      context = null;
      tracks = [];
    }
    setPlayback({
      context,
      tracks,
      index: snapshot.index,
      playing: snapshot.playing,
      positionMs: snapshot.positionMs,
      at: snapshot.at,
    });
  });

  /**
   * Titelliste einer Platte laden (mit Cache und einem automatischen Wiederholversuch).
   * @param {RecordItem} record
   * @returns {Promise<Track[]>}
   */
  function loadTracks(record) {
    const cached = store.get().tracklists[record.id];
    if (cached?.status === 'ready') return Promise.resolve(cached.items);
    const running = loadingTracks.get(record.id);
    if (running) return running;

    const task = (async () => {
      setTrackList(record.id, { status: 'loading', error: null });
      for (let attempt = 0; ; attempt++) {
        try {
          const items = await source.getTracks(record);
          setTrackList(record.id, { status: 'ready', items, error: null });
          return items;
        } catch (err) {
          const error = toSourceError(err);
          if (error.retryable && attempt < TRACK_RETRIES_MS.length && !isAbortError(err)) {
            await new Promise((resolve) => setTimeout(resolve, error.retryAfterMs ?? TRACK_RETRIES_MS[attempt]));
            continue;
          }
          setTrackList(record.id, { status: 'error', error });
          throw error;
        }
      }
    })().finally(() => loadingTracks.delete(record.id));

    loadingTracks.set(record.id, task);
    return task;
  }

  /**
   * Befehl in die Warteschlange stellen; Fehler werden gemeldet, nie geworfen.
   * @param {() => Promise<void>} command
   * @returns {Promise<boolean>} true bei Erfolg
   */
  function run(command) {
    const result = queue.then(async () => {
      setPlayback({ pending: true, error: null });
      try {
        await command();
        return true;
      } catch (err) {
        setPlayback({ error: toSourceError(err) });
        return false;
      } finally {
        starting = null;
        setPlayback({ pending: false });
      }
    });
    queue = result.then(() => undefined);
    return result;
  }

  const isContext = (/** @type {RecordItem} */ record) => store.get().playback.context?.id === record.id;

  /**
   * Platte ab einem bestimmten Titel abspielen.
   * @param {RecordItem} record
   * @param {number} [index]
   */
  function playRecord(record, index = 0) {
    return run(async () => {
      const tracks = await loadTracks(record);
      if (!tracks.length) throw new SourceError('unknown', { message: 'Auf dieser Platte sind keine Titel.' });
      starting = { record, tracks };
      await device.play({ contextUri: record.uri, index: Math.max(0, Math.min(index, tracks.length - 1)), tracks });
    });
  }

  return {
    loadTracks,

    playRecord,

    /**
     * Nadel auf die Platte: läuft sie schon (pausiert) auf demselben Titel → fortsetzen,
     * sonst ab dem gewählten Titel starten.
     * @param {RecordItem} record
     * @param {number} index
     */
    dropNeedle(record, index) {
      const { playback } = store.get();
      if (isContext(record) && playback.index === index && !playback.playing) return run(() => device.resume());
      return playRecord(record, index);
    },

    pause: () => run(() => device.pause()),
    resume: () => run(() => device.resume()),
    next: () => run(() => device.next()),
    previous: () => run(() => device.previous()),

    /** Platte einpacken: Wiedergabe beenden. */
    stop: () => run(() => device.stop()),

    /** Ist diese Platte gerade die laufende (auch pausiert)? */
    isContext,
  };
}

/** @typedef {ReturnType<typeof createPlayback>} PlaybackController */
