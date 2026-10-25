// @ts-check
// Wiedergabe-Steuerung: verbindet Oberfläche, Datenquelle (Titellisten) und
// Abspielgerät. Die Oberfläche ruft nur diese Absichten auf; der Zustand
// `playback` wird ausschließlich aus den Meldungen des Geräts gesetzt.
//
// - Befehle laufen nacheinander (kein Durcheinander bei schnellem Tippen)
// - Fehler landen in `playback.error`, die Oberfläche zeigt sie an
// - Titellisten werden je Platte einmal geladen und zwischengespeichert
// - Läuft etwas, das nicht hier gestartet wurde (anderes Gerät, nach dem
//   Neuladen), wird die Platte nachgeschlagen und angezeigt
// - Scheitert Abspielen an „kein Gerät", kann der Befehl nach dem Öffnen der
//   Spotify-App einmal wiederholt werden (retryAfterWake)

import { SourceError, isAbortError, toSourceError } from '../data/errors.js';

/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {import('../data/types.js').Track} Track */
/** @typedef {import('../data/types.js').LibrarySource} LibrarySource */
/** @typedef {import('../data/types.js').PlaybackDevice} PlaybackDevice */
/** @typedef {import('../data/types.js').PlaybackSnapshot} PlaybackSnapshot */
/** @typedef {import('./app-state.js').AppStore} AppStore */
/** @typedef {import('./app-state.js').Playback} Playback */
/** @typedef {import('./app-state.js').TrackList} TrackList */

const TRACK_RETRIES_MS = [800];
const WAKE_RETRY_WINDOW_MS = 2 * 60_000;

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
  /** Nachschlagen unbekannter Platten (je URI nur einmal gleichzeitig) */
  /** @type {Map<string, Promise<RecordItem | null>>} */
  const resolving = new Map();
  /** Befehl, der an „kein Gerät" gescheitert ist */
  /** @type {{ command: () => Promise<void>, at: number } | null} */
  let failedForDevice = null;
  /** Warteschlange: Befehle nacheinander ausführen */
  let queue = Promise.resolve();
  /** letzte Gerätemeldung (für späteres Zuordnen nachgeladener Platten) */
  /** @type {PlaybackSnapshot | null} */
  let lastSnapshot = null;

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

  /** Platte in den geladenen Listen suchen */
  function findInLibrary(/** @type {string} */ uri) {
    for (const resource of Object.values(store.get().library)) {
      const hit = resource.items.find((item) => item.record.uri === uri);
      if (hit) return hit.record;
    }
    return null;
  }

  /** Titel-Index aus der Titel-URI bestimmen (Spotify nennt keinen Index). */
  function indexOf(/** @type {Track[]} */ tracks, /** @type {PlaybackSnapshot} */ snapshot) {
    if (snapshot.track) {
      const i = tracks.findIndex((t) => t.uri === snapshot.track?.uri);
      if (i >= 0) return i;
    }
    return snapshot.index < tracks.length ? snapshot.index : -1;
  }

  /** @param {PlaybackSnapshot} snapshot */
  function applySnapshot(snapshot) {
    lastSnapshot = snapshot;
    const { playback } = store.get();
    let { context, tracks } = playback;
    if (!snapshot.contextUri) {
      context = null;
      tracks = [];
    } else if (starting && starting.record.uri === snapshot.contextUri) {
      context = starting.record;
      tracks = starting.tracks;
    } else if (context?.uri !== snapshot.contextUri) {
      // Nicht hier gestartet: Platte nachschlagen, solange ohne Anzeige.
      const record = findInLibrary(snapshot.contextUri);
      context = record;
      tracks = record ? store.get().tracklists[record.id]?.items ?? [] : [];
      if (!record) resolveContext(snapshot.contextUri);
      else if (!tracks.length) adoptTracks(record);
    }
    setPlayback({
      context,
      tracks,
      index: indexOf(tracks, snapshot),
      track: snapshot.track,
      playing: snapshot.playing,
      positionMs: snapshot.positionMs,
      at: snapshot.at,
      deviceName: snapshot.deviceName,
    });
  }

  /** Unbekannte Platte per URI holen und, falls sie noch läuft, übernehmen. */
  function resolveContext(/** @type {string} */ uri) {
    if (resolving.has(uri)) return;
    const task = source.getRecord(uri).catch(() => null);
    resolving.set(uri, task);
    task.then((record) => {
      resolving.delete(uri);
      if (record && lastSnapshot?.contextUri === uri && store.get().playback.context?.uri !== uri) {
        setPlayback({ context: record, tracks: [] });
        adoptTracks(record);
      }
    });
  }

  /** Titelliste nachladen und – falls die Platte noch läuft – zuordnen. */
  function adoptTracks(/** @type {RecordItem} */ record) {
    loadTracks(record).then((tracks) => {
      const { playback } = store.get();
      if (playback.context?.id !== record.id || !lastSnapshot) return;
      setPlayback({ tracks, index: indexOf(tracks, lastSnapshot) });
    }, () => {});
  }

  // Meldungen des Geräts sind die Wahrheit.
  device.subscribe(applySnapshot);

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
        failedForDevice = null;
        return true;
      } catch (err) {
        const error = toSourceError(err);
        failedForDevice = error.kind === 'no-device' ? { command, at: Date.now() } : null;
        setPlayback({ error });
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
   * Platte ab einem bestimmten Titel abspielen. Ohne Titelliste (fremde
   * Playlist) wird über die Position gestartet.
   * @param {RecordItem} record
   * @param {number} [index]
   */
  function playRecord(record, index = 0) {
    return run(async () => {
      /** @type {Track[]} */
      let tracks = [];
      try {
        tracks = await loadTracks(record);
      } catch (err) {
        const error = toSourceError(err);
        if (error.retryable) throw error; // Netzproblem: lieber melden als blind starten
      }
      const count = tracks.length || record.trackCount;
      if (!count) throw new SourceError('unknown', { message: 'Auf dieser Platte sind keine Titel.' });
      starting = { record, tracks };
      await device.play({ contextUri: record.uri, index: Math.max(0, Math.min(index, count - 1)), tracks });
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

    /**
     * Nach dem Öffnen der Spotify-App: den an „kein Gerät" gescheiterten
     * Befehl einmal wiederholen (nur kurz danach).
     */
    retryAfterWake() {
      const failed = failedForDevice;
      failedForDevice = null;
      if (!failed || Date.now() - failed.at > WAKE_RETRY_WINDOW_MS) return Promise.resolve(false);
      return run(failed.command);
    },

    /** Ist diese Platte gerade die laufende (auch pausiert)? */
    isContext,
  };
}

/** @typedef {ReturnType<typeof createPlayback>} PlaybackController */
