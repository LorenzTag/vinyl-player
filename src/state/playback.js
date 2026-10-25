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
// - Sofortige Rückmeldung: Befehle setzen den erwarteten Zustand gleich
//   (Platte stoppt/dreht, Arm bewegt sich). Spotify bestätigt mit Verzögerung –
//   widersprechende, also veraltete Meldungen werden kurz ignoriert. Scheitert
//   der Befehl, springt die Anzeige zurück.

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
const EXPECT_MS = 3000; // so lange gelten widersprechende Gerätemeldungen als veraltet
const RESTART_AFTER_MS = 3000; // „Zurück" nach 3 s: Titel neu starten

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
  /**
   * Erwarteter Zustand nach einem Befehl. Meldungen, die ihm widersprechen,
   * stammen von vor dem Befehl und werden bis `until` übergangen.
   * @type {{ playing?: boolean, contextUri?: string | null, trackUri?: string, until: number } | null}
   */
  let expect = null;

  /** @param {PlaybackSnapshot} snapshot */
  function isStale(snapshot) {
    if (!expect) return false;
    if (Date.now() > expect.until) {
      expect = null;
      return false;
    }
    if (expect.playing !== undefined && snapshot.playing !== expect.playing) return true;
    if (expect.contextUri !== undefined && snapshot.contextUri !== expect.contextUri) return true;
    if (expect.trackUri !== undefined && snapshot.track?.uri !== expect.trackUri) return true;
    return false;
  }

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
    if (isStale(snapshot)) return;
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
    const before = store.get().playback;
    setPlayback({
      context,
      tracks,
      index: indexOf(tracks, snapshot),
      track: snapshot.track,
      playing: snapshot.playing,
      positionMs: snapshot.positionMs,
      at: snapshot.at,
      deviceName: snapshot.deviceName,
      shuffle: snapshot.shuffle,
    });
    // Neues Lied oder Shuffle umgeschaltet: Warteschlange nachladen.
    if (context && (snapshot.track?.uri !== before.queueFor || snapshot.shuffle !== before.shuffle)) refreshQueue();
  }

  /** @type {Promise<void> | null} */
  let queueLoading = null;
  let queueAgain = false;

  /**
   * Was als Nächstes kommt – in Spotifys echter Reihenfolge (bei Shuffle gemischt).
   * Nie mehrere Abfragen gleichzeitig; Fehler sind hier unkritisch.
   */
  function refreshQueue() {
    if (queueLoading) {
      queueAgain = true;
      return queueLoading;
    }
    const forUri = store.get().playback.track?.uri ?? null;
    queueLoading = device.getQueue()
      .then((queue) => {
        // Inzwischen anderes Lied? Dann gehört die Antwort nicht mehr dazu.
        if (store.get().playback.track?.uri === forUri) setPlayback({ queue, queueFor: forUri });
      }, () => {})
      .finally(() => {
        queueLoading = null;
        if (queueAgain) {
          queueAgain = false;
          refreshQueue();
        }
      });
    return queueLoading;
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

  /** aktuelle (hochgerechnete) Position im Titel */
  function currentPosition() {
    const pb = store.get().playback;
    return pb.playing ? pb.positionMs + (Date.now() - pb.at) : pb.positionMs;
  }

  /**
   * Erwarteten Zustand sofort anzeigen, Befehl senden; bei Fehler zurück.
   * @param {Partial<Playback>} patch
   * @param {Omit<NonNullable<typeof expect>, 'until'> | null} expectation
   * @param {() => Promise<void>} command
   */
  function optimistic(patch, expectation, command) {
    const current = store.get().playback;
    /** @type {Partial<Playback>} */
    const before = {};
    for (const key of /** @type {(keyof Playback)[]} */ (Object.keys(patch))) {
      // @ts-ignore – gleiche Schlüssel, gleicher Typ
      before[key] = current[key];
    }
    setPlayback(patch);
    const mine = expectation ? { ...expectation, until: Date.now() + EXPECT_MS } : null;
    expect = mine;
    return run(command).then((ok) => {
      if (!ok && expect === mine) {
        expect = null;
        setPlayback(before);
      }
      return ok;
    });
  }

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
      const start = Math.max(0, Math.min(index, count - 1));
      const before = store.get().playback;
      starting = { record, tracks };
      // Sofort anzeigen: Platte läuft ab diesem Titel.
      setPlayback({
        context: record,
        tracks,
        index: tracks.length ? start : -1,
        track: tracks[start] ?? null,
        playing: true,
        positionMs: 0,
        at: Date.now(),
      });
      const mine = { contextUri: record.uri, playing: true, ...(tracks[start] ? { trackUri: tracks[start].uri } : {}), until: Date.now() + EXPECT_MS };
      expect = mine;
      try {
        await device.play({ contextUri: record.uri, index: start, tracks });
      } catch (err) {
        if (expect === mine) {
          expect = null;
          setPlayback({
            context: before.context, tracks: before.tracks, index: before.index, track: before.track,
            playing: before.playing, positionMs: before.positionMs, at: before.at,
          });
        }
        throw err;
      }
    });
  }

  const controller = {
    loadTracks,

    playRecord,

    /**
     * Nadel auf die Platte: läuft die Platte schon (pausiert) → fortsetzen,
     * sonst ab dem gewählten Titel starten.
     * @param {RecordItem} record
     * @param {number} index  gewählter Titel (nur für eine noch nicht laufende Platte)
     */
    dropNeedle(record, index) {
      const { playback } = store.get();
      if (isContext(record)) return playback.playing ? Promise.resolve(true) : controller.resume();
      return playRecord(record, index);
    },

    pause() {
      return optimistic({ playing: false, positionMs: currentPosition(), at: Date.now() }, { playing: false }, () => device.pause());
    },

    resume() {
      if (!store.get().playback.context) return run(() => device.resume());
      return optimistic({ playing: true, positionMs: currentPosition(), at: Date.now() }, { playing: true }, () => device.resume());
    },

    next() {
      const { tracks, index, shuffle, queue, queueFor, track } = store.get().playback;
      // Bei Shuffle (und generell, wenn bekannt) sagt Spotifys Warteschlange, was kommt.
      const queueFresh = queueFor !== null && queueFor === (track?.uri ?? null);
      const target = queueFresh && queue[0] ? queue[0] : shuffle ? undefined : index >= 0 ? tracks[index + 1] : undefined;
      if (!target) return run(() => device.next());
      const targetIndex = tracks.findIndex((t) => t.uri === target.uri);
      return optimistic(
        { index: targetIndex, track: target, positionMs: 0, at: Date.now(), queue: queueFresh ? queue.slice(1) : queue, queueFor: target.uri },
        { trackUri: target.uri },
        () => device.next(),
      ).then((ok) => {
        // Spotify ergänzt die Warteschlange nach dem Sprung – kurz danach neu laden.
        if (ok) setTimeout(refreshQueue, 900);
        return ok;
      });
    },

    previous() {
      const { tracks, index, shuffle } = store.get().playback;
      if (currentPosition() > RESTART_AFTER_MS || index <= 0) {
        return optimistic({ positionMs: 0, at: Date.now() }, null, () => device.previous());
      }
      // Bei Shuffle springt Spotify im Verlauf zurück – das Ziel ist unbekannt.
      if (shuffle) return run(() => device.previous());
      const target = tracks[index - 1];
      return optimistic({ index: index - 1, track: target, positionMs: 0, at: Date.now() }, { trackUri: target.uri }, () => device.previous());
    },

    /** Warteschlange neu laden (z. B. beim Öffnen der Titelliste). */
    refreshQueue,

    /** Platte einpacken: Wiedergabe beenden. */
    stop() {
      return optimistic(
        { context: null, tracks: [], index: -1, track: null, playing: false },
        { contextUri: null, playing: false },
        () => device.stop(),
      );
    },

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
  return controller;
}

/** @typedef {ReturnType<typeof createPlayback>} PlaybackController */
