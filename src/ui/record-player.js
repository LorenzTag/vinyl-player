// @ts-check
// Plattenspieler-Bildschirm: Die angetippte Hülle fliegt an ihren Platz und
// legt sich schräg, die Schallplatte gleitet heraus auf den Plattenteller.
//
// Bedienung ohne Leiste, nur mit Gesten:
// - Tonarm auf die Platte ziehen / antippen = abspielen, herunter = Pause
// - nach oben / unten wischen = nächstes / vorheriges Lied (das Cover wechselt)
// - nach links wischen = Titelliste fährt von rechts herein, nach rechts = zu
// - nach rechts wischen (ohne Titelliste) = zurück zur Sammlung, Musik läuft weiter
// - Platte aufs Cover ziehen = einpacken: Wiedergabe endet
// - ins Leere tippen = Standby: Leiste aus- bzw. wieder einblenden
//
// Zuverlässigkeit: Endpositionen legt CSS fest (Quer- und Hochformat);
// animiert wird nur transform/opacity. Jede Animation hat eine Zeitgrenze und
// endet in einem definierten Zustand – auch wenn sie unterbrochen wird.
// Angezeigt wird der Zustand des Abspielgeräts (bzw. der sofort erwartete).

import { h, svg, clamp, prefersReducedMotion } from './dom.js';
import { createCover } from './cover-art.js';
import { playerTheme, paletteFromImage } from './cover-colors.js';
import { formatDuration } from './format.js';
import { createTonearm } from './tonearm.js';
import { createTracklist } from './tracklist.js';

/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */
/** @typedef {import('../state/app-state.js').AppStore} AppStore */
/** @typedef {import('../state/app-state.js').AppState} AppState */
/** @typedef {import('../state/playback.js').PlaybackController} PlaybackController */
/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {import('../data/types.js').Track} Track */

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
const SPIN_SECONDS = 1.8;      // 33⅓ U/min
const TICK_MS = 250;           // Fortschritt und Tonarm nachführen
const GESTURE_SLOP = 10;       // px, ab dann ist es eine Wischgeste
const TAP_MAX_MS = 450;
const SWIPE_DISTANCE = 60;     // px für Liedwechsel / Titelliste
const FLICK_SPEED = 0.5;       // px/ms – kurzer, schneller Wisch zählt auch
const PUTAWAY_FRACTION = 0.38; // so weit muss die Platte aufs Cover gezogen werden
const LIST_GAP = 24;           // Abstand der Titelliste zum Rand

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="2.2" height="12" rx="1" fill="currentColor"/><path d="M19 6.2v11.6L9 12z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="16.8" y="6" width="2.2" height="12" rx="1" fill="currentColor"/><path d="M5 6.2v11.6L15 12z" fill="currentColor"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.5" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="17" r="1.2" fill="currentColor" stroke="none"/></svg>',
};

/**
 * Startwerte (Hülle → Endposition) für FLIP.
 * @param {DOMRect} from
 * @param {DOMRect} to
 */
function inverse(from, to) {
  const scale = from.width / to.width;
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`;
}

/**
 * Schräglage der Hülle – identisch zur CSS-Regel `.record.is-tilted .record__sleeve`.
 * @param {number} size  Hüllengröße in px
 */
function tilt(size) {
  return `perspective(${size * 3.2}px) rotateY(18deg) rotateX(4deg) rotateZ(-5deg) scale(1.12)`;
}

/**
 * Wartet, bis alle Animationen fertig sind – höchstens aber ihre Laufzeit plus
 * Puffer. Danach stehen sie garantiert im Endzustand, auch wenn der Browser
 * keine Frames liefert (App im Hintergrund, Tab verdeckt).
 * @param {Animation[]} animations
 */
async function settle(animations) {
  const longest = Math.max(0, ...animations.map((a) => Number(a.effect?.getComputedTiming().endTime) || 0));
  await Promise.race([
    Promise.allSettled(animations.map((a) => a.finished)),
    new Promise((resolve) => setTimeout(resolve, longest + 300)),
  ]);
  for (const animation of animations) {
    try {
      animation.finish();
    } catch {
      // bereits beendet oder abgebrochen
    }
  }
}

/** @param {DOMRect} rect */
function isUsable(rect) {
  return rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < window.innerHeight
    && rect.right > 0 && rect.left < window.innerWidth;
}

/**
 * Welches Cover gehört zu diesem Lied? Echtes Album-Cover, bei Alben das
 * Album selbst, sonst ein eigenes generiertes Cover je Lied.
 * @param {RecordItem} record
 * @param {Track | null | undefined} track
 * @returns {RecordItem}
 */
function coverRecordFor(record, track) {
  if (!track) return record;
  if (track.imageUrl) {
    return { ...record, id: `${track.id}:cover`, title: track.title, subtitle: track.artists, kind: 'album', imageUrl: track.imageUrl };
  }
  if (record.kind === 'album') return record;
  return { ...record, id: `${track.id}:cover`, title: track.title, subtitle: track.artists, kind: 'album', imageUrl: null };
}

/**
 * Drehen der Platte mit Hoch- und Auslaufen (wie ein echter Plattenteller).
 * @param {HTMLElement} el
 */
function createSpin(el) {
  const animation = el.animate(
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
    { duration: SPIN_SECONDS * 1000, iterations: Infinity },
  );
  animation.pause();
  let rate = 0;
  let target = 0;
  let raf = 0;
  let last = 0;

  /** @param {number} now */
  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Anlaufen 0,6 s, Auslaufen 0,9 s – passt zur Bewegung des Tonarms.
    rate = target > rate ? Math.min(target, rate + dt / 0.6) : Math.max(target, rate - dt / 0.9);
    if (rate <= 0) {
      animation.pause();
    } else {
      animation.playbackRate = rate;
      if (animation.playState !== 'running') animation.play();
    }
    raf = rate === target ? 0 : requestAnimationFrame(step);
  }

  return {
    /** @param {boolean} on */
    set(on) {
      const next = on ? (prefersReducedMotion() ? 0.3 : 1) : 0;
      if (next === target) return;
      target = next;
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    },
    cancel() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      animation.cancel();
    },
  };
}

/**
 * @param {{
 *   store: AppStore,
 *   playback: PlaybackController,
 *   onRequestClose: (opts?: { putAway?: boolean }) => void,
 * }} deps
 */
export function createRecordPlayer({ store, playback, onRequestClose }) {
  const layer = h('div', {
    class: 'player-layer',
    hidden: true,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'player-title',
  });

  /**
   * @typedef {ReturnType<typeof build>} Parts
   * @type {(Parts & { item: DisplayItem, button: HTMLElement }) | null}
   */
  let current = null;
  /** @type {Promise<void> | null} */
  let opening = null;
  /** @type {Promise<void> | null} */
  let closing = null;
  let ticker = 0;
  let toastTimer = 0;
  /** zuletzt angezeigter Fehler (jeden nur einmal melden) */
  /** @type {unknown} */
  let shownError = null;

  /** Was gerade dargestellt wird – für Ticker und Gesten */
  let view = {
    isCurrent: false,
    playing: false,
    /** @type {Track[]} */
    tracks: [],
    index: -1,
    /** @type {Track | null} */
    track: null,
    count: 0,
  };
  /** Gewähltes Lied einer Platte, die noch nicht läuft (per Wischen) */
  let selectedIndex = 0;
  /** Arm bleibt, wo die Hand ihn hingelegt hat, bis der Befehl durch ist */
  let armHold = false;
  /** Cover wird gerade von Öffnen/Schließen gesteuert – nicht wechseln */
  let coverLocked = true;
  /** Titelliste: 0 = zu, 1 = offen */
  let listProgress = 0;
  /** Richtung des letzten Liedwechsels per Geste (für die Cover-Animation) */
  let swipeDirection = 0;

  /** Selbst gestartete, noch laufende Animationen */
  /** @type {Set<Animation>} */
  const active = new Set();

  /**
   * @param {Element} el
   * @param {Keyframe[] | PropertyIndexedKeyframes} keyframes
   * @param {KeyframeAnimationOptions} options
   */
  function animate(el, keyframes, options) {
    const animation = el.animate(keyframes, options);
    active.add(animation);
    const forget = () => active.delete(animation);
    animation.finished.then(forget, forget);
    return animation;
  }

  /** Laufende Animationen sofort in ihren Endzustand bringen. */
  function finishAnimations() {
    for (const animation of [...active]) {
      try {
        animation.finish();
      } catch {
        active.delete(animation);
      }
    }
  }

  layer.addEventListener('keydown', (event) => {
    if (!current) return;
    if (event.key === 'Escape') {
      if (listProgress > 0) setList(false);
      else onRequestClose();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (/** @type {Element} */ (event.target).closest('.tracklist')) return;
      event.preventDefault();
      changeSong(event.key === 'ArrowUp' ? 1 : -1);
    }
  });

  // ---------- Aufbau ----------

  /** @param {DisplayItem} item */
  function build(item) {
    const { record } = item;

    const labelTitle = h('div', { class: 'record__label-title' }, record.title);
    const labelSub = h('div', { class: 'record__label-sub' }, record.subtitle);
    const spinEl = h('div', { class: 'record__spin' }, h('div', { class: 'record__label' }, labelTitle, labelSub));
    const disc = h('div', { class: 'record__disc', 'aria-hidden': 'true' }, spinEl, h('div', { class: 'record__sheen' }));
    const coverCard = h('div', { class: 'record__cover' }, createCover(record));
    const sleeve = h('div', { class: 'record__sleeve' }, coverCard);
    const recordEl = h('div', { class: 'record' }, disc, sleeve);
    const platter = h('div', { class: 'platter', 'aria-hidden': 'true' });
    const tonearm = createTonearm({ onRequest: (on) => onArmRequest(on) });
    const deck = h('div', { class: 'player__deck' }, platter, recordEl, tonearm.el);
    const stage = h('div', { class: 'player__stage' }, deck);

    const heading = h('h2', { class: 'visually-hidden', id: 'player-title' }, record.title);
    const status = h('div', { class: 'player__status', 'aria-live': 'polite' });
    const wake = h('a', { class: 'player__wake', href: 'spotify:', hidden: true }, 'Spotify öffnen');
    const progressFill = h('div', { class: 'player__progress-fill' });
    const progress = h('div', { class: 'player__progress', 'aria-hidden': 'true' }, progressFill);

    const back = h('button', { type: 'button', class: 'player__back', 'aria-label': 'Zurück zur Sammlung (Musik läuft weiter)', onclick: () => onRequestClose() },
      h('span', { 'aria-hidden': 'true' }, '←'), h('span', { class: 'player__back-label' }, 'Sammlung'));
    const prev = h('button', { type: 'button', class: 'player__ctrl', 'aria-label': 'Vorheriges Lied', onclick: () => changeSong(-1) });
    const toggle = h('button', { type: 'button', class: 'player__toggle', onclick: () => onToggle() });
    const next = h('button', { type: 'button', class: 'player__ctrl', 'aria-label': 'Nächstes Lied', onclick: () => changeSong(1) });
    const listButton = h('button', { type: 'button', class: 'player__ctrl', 'aria-label': 'Titelliste', onclick: () => setList(listProgress < 1) });
    prev.append(svg(ICONS.prev));
    next.append(svg(ICONS.next));
    listButton.append(svg(ICONS.list));

    const bar = h('div', { class: 'player__bar' },
      back,
      h('div', { class: 'player__info' }, heading, status, wake),
      h('div', { class: 'player__controls' }, prev, toggle, next, listButton),
      progress,
    );

    const tracklist = createTracklist({
      onSelect: (index) => selectFromList(index),
      onClose: () => setList(false),
    });
    const toast = h('div', { class: 'player__toast', role: 'status', 'aria-live': 'polite' });
    const player = h('div', { class: 'player' }, stage, bar);

    const backdrop = h('div', { class: 'player-layer__backdrop' });
    layer.replaceChildren(backdrop, player, tracklist.el, toast);

    return {
      record: recordEl, disc, sleeve, coverCard, platter, tonearm, deck, stage, bar, player, backdrop,
      labelTitle, labelSub, status, wake, progressFill, toggle, prev, next, tracklist, toast,
      spin: createSpin(spinEl),
      /** @type {string} Cover, das gerade gezeigt wird */
      coverId: record.id,
    };
  }

  // ---------- Farben und Cover ----------

  /**
   * Farben übernehmen. Der Hintergrund blendet weich über (neue Ebene), das
   * Vinyl wechselt direkt.
   * @param {RecordItem} coverRecord
   * @param {boolean} fade
   */
  function applyTheme(coverRecord, fade) {
    if (!current) return;
    const parts = current;
    const apply = (/** @type {Record<string, string>} */ vars) => {
      if (!current || current !== parts) return;
      for (const [name, value] of Object.entries(vars)) parts.record.style.setProperty(name, value);
      const next = h('div', { class: 'player-layer__backdrop' });
      for (const [name, value] of Object.entries(vars)) next.style.setProperty(name, value);
      const old = parts.backdrop;
      old.after(next);
      parts.backdrop = next;
      if (fade && !prefersReducedMotion()) {
        const anim = animate(next, { opacity: [0, 1] }, { duration: 700, easing: 'ease-out' });
        settle([anim]).then(() => old.remove());
      } else {
        old.remove();
      }
    };
    apply(playerTheme(coverRecord));
    if (coverRecord.imageUrl) {
      paletteFromImage(coverRecord.imageUrl).then((palette) => {
        if (palette && current?.coverId === coverRecord.id) apply(playerTheme(coverRecord, palette));
      });
    }
  }

  /**
   * Cover auf der Hülle wechseln: altes gleitet weg, neues kommt nach.
   * @param {RecordItem} coverRecord
   * @param {number} direction  1 = nächstes (nach oben), -1 = vorheriges, 0 = überblenden
   */
  function showCover(coverRecord, direction) {
    if (!current || current.coverId === coverRecord.id) return;
    const parts = current;
    parts.coverId = coverRecord.id;
    const old = parts.coverCard;
    const card = h('div', { class: 'record__cover' }, createCover(coverRecord));
    old.after(card);
    parts.coverCard = card;
    applyTheme(coverRecord, true);
    if (prefersReducedMotion()) {
      old.remove();
      return;
    }
    const shift = direction * 55;
    settle([
      animate(old, { transform: [old.style.transform || 'none', `translateY(${-shift}%) scale(0.92)`], opacity: [1, 0] }, { duration: 360, easing: EASE_IN_OUT }),
      animate(card, { transform: [`translateY(${shift}%) scale(0.92)`, 'none'], opacity: [0, 1] }, { duration: 420, easing: EASE_OUT }),
    ]).then(() => old.remove());
  }

  // ---------- Darstellung aus dem Zustand ----------

  /** Position im aktuellen Titel (hochgerechnet) */
  function positionMs(/** @type {AppState['playback']} */ pb) {
    return pb.playing ? pb.positionMs + (Date.now() - pb.at) : pb.positionMs;
  }

  /** Fortschritt über die ganze Platte (0…1) – bestimmt die Lage des Tonarms. */
  function recordProgress(/** @type {AppState['playback']} */ pb) {
    if (!view.isCurrent || !view.count || view.index < 0) return 0.04;
    const within = view.track?.durationMs ? clamp(positionMs(pb) / view.track.durationMs, 0, 1) : 0;
    return (view.index + within) / view.count;
  }

  /** @param {AppState} state */
  function render(state) {
    if (!current) return;
    const { item } = current;
    const { record } = item;
    const pb = state.playback;
    const isCurrent = pb.context?.id === record.id;
    const list = state.tracklists[record.id];
    const tracks = isCurrent ? pb.tracks : list?.items ?? [];
    if (!isCurrent) selectedIndex = clamp(selectedIndex, 0, Math.max(0, tracks.length - 1));
    const index = isCurrent ? pb.index : tracks.length ? selectedIndex : -1;
    const track = isCurrent ? tracks[index] ?? pb.track : tracks[index] ?? null;
    const playing = isCurrent && pb.playing;
    const count = tracks.length || record.trackCount;
    view = { isCurrent, playing, tracks, index, track, count };

    // Tonarm und Teller
    if (!armHold) current.tonearm.setState({ on: playing, progress: recordProgress(pb) });
    current.spin.set(playing);

    // Etikett und Cover zeigen das Lied
    current.labelTitle.textContent = track?.title ?? record.title;
    current.labelSub.textContent = track?.artists ?? record.subtitle;
    if (!coverLocked) {
      showCover(coverRecordFor(record, track), swipeDirection);
      swipeDirection = 0;
    }

    // Leiste (nur das Nötigste – Titel steht auf der Platte)
    const where = pb.deviceName ?? '';
    current.status.textContent = pb.error
      ? pb.error.message
      : isCurrent
        ? [playing ? '' : 'Pausiert', index >= 0 ? `${index + 1} / ${tracks.length}` : '', where].filter(Boolean).join(' · ')
        : pb.context
          ? `Läuft gerade: ${pb.context.title}`
          : 'Tonarm auflegen';
    current.wake.hidden = pb.error?.kind !== 'no-device';
    current.toggle.replaceChildren(svg(playing ? ICONS.pause : ICONS.play));
    current.toggle.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
    current.bar.classList.toggle('has-progress', isCurrent);

    current.tracklist.render({
      recordTitle: record.title,
      tracks,
      current: index,
      playing,
      status: isCurrent && tracks.length ? 'ready' : list?.status ?? 'loading',
      error: list?.error?.message,
    });

    if (pb.error && pb.error !== shownError) {
      shownError = pb.error;
      showToast(pb.error.message);
      current.player.classList.remove('is-standby'); // Fehler nie verstecken
    }
    tick();
  }

  /** Fortschrittsbalken, Zeit und Tonarm nachführen (läuft 4× pro Sekunde). */
  function tick() {
    if (!current) return;
    const pb = store.get().playback;
    const track = view.isCurrent ? view.track : null;
    if (!track?.durationMs) {
      current.progressFill.style.transform = 'scaleX(0)';
      delete current.status.dataset.time;
      return;
    }
    const pos = clamp(positionMs(pb), 0, track.durationMs);
    current.progressFill.style.transform = `scaleX(${(pos / track.durationMs).toFixed(4)})`;
    current.status.dataset.time = `${formatDuration(pos)} / ${formatDuration(track.durationMs)}`;
    if (view.playing && !armHold && !gesture) {
      current.tonearm.setState({ on: true, progress: recordProgress(pb) }, 'track');
    }
  }

  /** @param {string} text */
  function showToast(text) {
    if (!current) return;
    clearTimeout(toastTimer);
    current.toast.textContent = text;
    current.toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => current?.toast.classList.remove('is-visible'), 2400);
  }

  // ---------- Absichten ----------

  /** @param {boolean} on */
  function onArmRequest(on) {
    if (!current) return;
    const { record } = current.item;
    if (!on) {
      playback.pause();
      return;
    }
    armHold = true;
    playback.dropNeedle(record, selectedIndex).finally(() => {
      armHold = false;
      render(store.get());
    });
  }

  function onToggle() {
    if (!current) return;
    const { record } = current.item;
    if (view.playing) playback.pause();
    else if (playback.isContext(record)) playback.resume();
    else playback.playRecord(record, selectedIndex);
  }

  /**
   * Nächstes / vorheriges Lied. Läuft die Platte, wird gesprungen; sonst nur
   * gewählt (startet beim Auflegen der Nadel).
   * @param {1 | -1} direction
   */
  function changeSong(direction) {
    if (!current) return;
    swipeDirection = direction;
    if (view.isCurrent) {
      if (direction > 0) playback.next();
      else playback.previous();
      return;
    }
    if (!view.tracks.length) {
      swipeDirection = 0;
      showToast('Für diese Platte gibt es keine Titelliste – Nadel auflegen zum Abspielen.');
      return;
    }
    const nextIndex = clamp(selectedIndex + direction, 0, view.tracks.length - 1);
    if (nextIndex === selectedIndex) {
      swipeDirection = 0;
      bounceCover(direction);
      return;
    }
    selectedIndex = nextIndex;
    render(store.get());
  }

  /** Am Anfang/Ende der Platte: Cover federt nur kurz. */
  function bounceCover(/** @type {number} */ direction) {
    if (!current || prefersReducedMotion()) return;
    animate(current.coverCard, { transform: ['none', `translateY(${-direction * 6}%)`, 'none'] }, { duration: 320, easing: EASE_OUT });
  }

  /** @param {number} index */
  function selectFromList(index) {
    if (!current) return;
    const { record } = current.item;
    swipeDirection = index >= view.index ? 1 : -1;
    selectedIndex = index;
    setList(false);
    playback.playRecord(record, index);
  }

  // ---------- Titelliste (Seite von rechts) ----------

  /** Wie weit Plattenspieler und Liste verschoben werden (px). */
  function listGeometry() {
    if (!current) return { deckShift: 0, listShift: 0 };
    const listWidth = current.tracklist.el.offsetWidth || window.innerWidth;
    const portrait = window.innerHeight > window.innerWidth;
    // Querformat: Cover verschwindet links, der Plattenteller bleibt neben der Liste.
    const platter = current.platter.getBoundingClientRect();
    const deckShift = portrait ? window.innerWidth : Math.max(0, platter.left - LIST_GAP);
    return { deckShift, listShift: listWidth + LIST_GAP * 2 };
  }

  /**
   * @param {number} progress  0 = zu, 1 = offen
   * @param {boolean} animated
   */
  function placeList(progress, animated) {
    if (!current) return;
    listProgress = clamp(progress, 0, 1);
    const { deckShift, listShift } = listGeometry();
    for (const el of [current.deck, current.tracklist.el]) el.classList.toggle('is-sliding', animated && !prefersReducedMotion());
    current.deck.style.transform = listProgress ? `translateX(${(-deckShift * listProgress).toFixed(1)}px)` : '';
    current.tracklist.el.style.transform = `translateX(${(listShift * (1 - listProgress)).toFixed(1)}px)`;
  }

  /** @param {boolean} open */
  function setList(open) {
    if (!current) return;
    placeList(open ? 1 : 0, true);
    current.tracklist.setOpen(open);
    current.player.classList.toggle('is-list', open);
    if (open) current.tracklist.revealCurrent();
  }

  // Beim Drehen des iPad die Lage der Liste neu berechnen.
  window.addEventListener('resize', () => {
    if (current) placeList(listProgress, false);
  });

  // ---------- Gesten ----------

  /**
   * @type {{
   *   id: number, x: number, y: number, t: number,
   *   onDisc: boolean, inList: boolean,
   *   mode: 'putaway' | 'horizontal' | 'vertical' | 'none' | null,
   *   samples: Array<{ t: number, x: number, y: number }>,
   *   along: number,
   *   listStart: number,
   * } | null}
   */
  let gesture = null;

  /** Richtung zur Hülle (Einheitsvektor) und Weg der Platte aus der Hülle */
  function sleeveDirection() {
    const out = discOffset();
    const length = Math.hypot(out.x, out.y) || 1;
    return { ux: -out.x / length, uy: -out.y / length, length, out };
  }

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (gesture || closing || opening || !current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = /** @type {Element} */ (event.target);
    if (target.closest('.tonearm__grip, button, a, .player__bar')) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: event.timeStamp,
      onDisc: !!target.closest('.record__disc') && listProgress === 0,
      inList: !!target.closest('.tracklist'),
      mode: null,
      samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }],
      along: 0,
      listStart: listProgress,
    };
  }

  /** @param {PointerEvent} event */
  function onPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id || !current) return;
    const g = gesture;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    g.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (g.samples.length > 8) g.samples.shift();

    if (!g.mode) {
      if (Math.hypot(dx, dy) < GESTURE_SLOP) return;
      const dir = sleeveDirection();
      const along = dx * dir.ux + dy * dir.uy;
      const across = Math.abs(dx * dir.uy - dy * dir.ux);
      if (g.onDisc && along > 0 && along >= across) {
        g.mode = 'putaway';
        current.disc.classList.add('is-dragging');
        current.tonearm.park(true);
      } else if (Math.abs(dx) >= Math.abs(dy)) {
        g.mode = 'horizontal';
      } else if (!g.inList && listProgress === 0 && !(g.onDisc && Math.abs(dir.uy) > 0.5)) {
        g.mode = 'vertical';
      } else {
        g.mode = 'none'; // z. B. Scrollen in der Titelliste
      }
    }

    if (g.mode === 'putaway') {
      const dir = sleeveDirection();
      g.along = clamp(dx * dir.ux + dy * dir.uy, -24, dir.length);
      const keep = 1 - g.along / dir.length;
      current.disc.style.transform = `translate(${(dir.out.x * keep).toFixed(1)}px, ${(dir.out.y * keep).toFixed(1)}px)`;
    } else if (g.mode === 'horizontal') {
      const { deckShift } = listGeometry();
      const progress = g.listStart - dx / Math.max(1, deckShift);
      // Ohne Liste nach rechts: kein Vorschieben, nur Rückmeldung am Ende.
      if (g.listStart === 0 && dx > 0) return;
      placeList(progress, false);
    } else if (g.mode === 'vertical') {
      current.coverCard.style.transform = `translateY(${(dy * 0.35).toFixed(1)}px)`;
    }
  }

  /** @param {PointerEvent} event */
  function onPointerUp(event) {
    if (!gesture || event.pointerId !== gesture.id || !current) return;
    const g = gesture;
    gesture = null;
    const last = g.samples[g.samples.length - 1];
    const first = g.samples.find((s) => last.t - s.t <= 100) ?? last;
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;
    const dx = last.x - g.x;
    const dy = last.y - g.y;
    const cancelled = event.type === 'pointercancel';

    if (!g.mode) {
      // Tippen ins Leere → Standby (Leiste aus/ein)
      if (!cancelled && !g.inList && event.timeStamp - g.t < TAP_MAX_MS) toggleStandby();
      return;
    }

    if (g.mode === 'putaway') {
      const dir = sleeveDirection();
      const speed = ((last.x - first.x) * dir.ux + (last.y - first.y) * dir.uy) / dt;
      const fraction = g.along / dir.length;
      if (!cancelled && (fraction > PUTAWAY_FRACTION || (fraction > 0.12 && speed > 0.6))) {
        onRequestClose({ putAway: true });
      } else {
        springBack();
      }
      return;
    }

    if (g.mode === 'horizontal') {
      if (cancelled) {
        setList(g.listStart > 0.5);
        return;
      }
      const left = dx < -SWIPE_DISTANCE || (dx < -20 && vx < -FLICK_SPEED);
      const right = dx > SWIPE_DISTANCE || (dx > 20 && vx > FLICK_SPEED);
      if (g.listStart === 0) {
        if (left) setList(true);
        else if (right) onRequestClose(); // zurück zur Sammlung, Musik läuft weiter
        else setList(false);
      } else {
        setList(!right);
      }
      return;
    }

    if (g.mode === 'vertical') {
      const card = current.coverCard;
      const from = card.style.transform;
      card.style.transform = '';
      const up = dy < -SWIPE_DISTANCE || (dy < -20 && vy < -FLICK_SPEED);
      const down = dy > SWIPE_DISTANCE || (dy > 20 && vy > FLICK_SPEED);
      if (!cancelled && (up || down)) {
        changeSong(up ? 1 : -1);
      } else if (from && !prefersReducedMotion()) {
        animate(card, { transform: [from, 'none'] }, { duration: 260, easing: EASE_OUT });
      }
    }
  }

  function toggleStandby() {
    if (!current) return;
    current.player.classList.toggle('is-standby');
  }

  /** Platte zurück auf den Plattenteller federn lassen. */
  function springBack() {
    if (!current) return;
    const { disc, tonearm } = current;
    const from = disc.style.transform;
    disc.style.transform = '';
    disc.classList.remove('is-dragging');
    tonearm.park(false);
    if (from) {
      const { out } = sleeveDirection();
      animate(disc, { transform: [from, `translate(${out.x}px, ${out.y}px)`] }, { duration: 300, easing: EASE_OUT });
    }
  }

  layer.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

  // ---------- Öffnen / Schließen ----------

  /** Zielverschiebung der Platte (aus CSS, je nach Ausrichtung) in px. */
  function discOffset() {
    if (!current) return { x: 0, y: 0, size: 0 };
    const style = getComputedStyle(current.deck);
    const size = current.record.offsetWidth;
    return {
      x: (parseFloat(style.getPropertyValue('--out-x')) || 0) * size,
      y: (parseFloat(style.getPropertyValue('--out-y')) || 0) * size,
      size,
    };
  }

  /**
   * @param {DisplayItem} item
   * @param {HTMLElement} sleeve   angetippte Hülle (Startpunkt)
   * @param {HTMLElement} button   wird während des Öffnens ausgeblendet
   */
  function open(item, sleeve, button) {
    if (current) return;
    opening = runOpen(item, sleeve, button).finally(() => { opening = null; });
  }

  /**
   * @param {DisplayItem} item
   * @param {HTMLElement} sleeve
   * @param {HTMLElement} button
   */
  async function runOpen(item, sleeve, button) {
    const from = sleeve.getBoundingClientRect();
    const parts = build(item);
    current = { item, button, ...parts };
    shownError = store.get().playback.error; // alte Fehler nicht erneut melden
    selectedIndex = 0;
    listProgress = 0;
    swipeDirection = 0;
    coverLocked = true; // erst das Platten-Cover zeigen, damit der Flug passt
    applyTheme(item.record, false);
    layer.hidden = false;
    placeList(0, false);
    playback.loadTracks(item.record).catch(() => {}); // Fehler zeigt die Titelliste
    render(store.get());
    clearInterval(ticker);
    ticker = window.setInterval(tick, TICK_MS);
    const reduced = prefersReducedMotion();

    try {
      const to = parts.record.getBoundingClientRect();
      const out = discOffset();
      button.classList.add('is-opening');
      // Endzustand per CSS-Klassen; die Animationen laufen nur dorthin.
      parts.record.classList.add('is-tilted', 'is-out');

      if (reduced || !isUsable(from)) {
        await settle([animate(layer, { opacity: [0, 1] }, { duration: reduced ? 180 : 300, easing: 'ease-out' })]);
      } else {
        await settle([
          animate(parts.backdrop, { opacity: [0, 1] }, { duration: 380, easing: 'ease-out' }),
          animate(parts.record, { transform: [inverse(from, to), 'none'] }, { duration: 600, easing: EASE_OUT }),
          animate(parts.sleeve, { transform: ['none', tilt(out.size)] }, { duration: 600, easing: EASE_OUT }),
          animate(parts.platter, { opacity: [0, 1], transform: ['scale(0.94)', 'none'] }, { duration: 420, delay: 220, easing: EASE_OUT, fill: 'backwards' }),
          animate(parts.tonearm.el, { opacity: [0, 1] }, { duration: 420, delay: 320, easing: 'ease-out', fill: 'backwards' }),
          animate(parts.disc,
            { transform: ['translate(0px, 0px)', `translate(${out.x}px, ${out.y}px)`] },
            { duration: 720, delay: 480, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'backwards' }),
          animate(parts.bar,
            { opacity: [0, 1], transform: ['translateY(16px)', 'none'] },
            { duration: 420, delay: 700, easing: EASE_OUT, fill: 'backwards' }),
        ]);
      }
      if (current?.record === parts.record && !closing) {
        coverLocked = false;
        render(store.get()); // jetzt das Cover des laufenden/gewählten Lieds
        parts.toggle.focus({ preventScroll: true });
      }
    } catch (err) {
      console.error('[player] Öffnen-Animation fehlgeschlagen', err);
      coverLocked = false;
    }
  }

  /**
   * Schließen ist jederzeit erlaubt – auch mitten im Öffnen.
   * @param {HTMLElement | null} sleeve  Hülle, in die die Platte zurückkehrt (falls sichtbar)
   */
  function close(sleeve) {
    if (!current) return Promise.resolve();
    closing ??= runClose(sleeve).finally(() => { closing = null; });
    return closing;
  }

  /** @param {HTMLElement | null} sleeve */
  async function runClose(sleeve) {
    if (opening) {
      finishAnimations();
      await opening;
    }
    if (!current) return;
    const parts = current;
    const reduced = prefersReducedMotion();
    gesture = null;
    if (listProgress > 0) setList(false);
    // Für den Rückflug wieder das Cover der Platte zeigen (passt zur Hülle im Regal).
    coverLocked = false;
    showCover(parts.item.record, 0);
    coverLocked = true;

    try {
      const target = sleeve?.isConnected ? sleeve.getBoundingClientRect() : null;
      if (reduced || !target || !isUsable(target)) {
        await settle([animate(layer, { opacity: [1, 0] }, { duration: reduced ? 160 : 260, easing: 'ease-in', fill: 'forwards' })]);
      } else {
        // Platte von dort, wo sie gerade ist (evtl. halb gezogen), zurück in die Hülle.
        const out = discOffset();
        const discFrom = parts.disc.style.transform || `translate(${out.x}px, ${out.y}px)`;
        parts.record.classList.remove('is-out');
        parts.disc.style.transform = '';
        parts.bar.style.opacity = '0';
        parts.tonearm.el.style.opacity = '0';
        await settle([
          animate(parts.bar, { opacity: [1, 0] }, { duration: 160, easing: 'ease-in' }),
          animate(parts.tonearm.el, { opacity: [1, 0] }, { duration: 220, easing: 'ease-in' }),
          animate(parts.disc, { transform: [discFrom, 'translate(0px, 0px)'] }, { duration: 420, easing: EASE_IN_OUT }),
        ]);
        const to = parts.record.getBoundingClientRect();
        parts.record.classList.remove('is-tilted');
        parts.record.style.transform = inverse(target, to);
        parts.backdrop.style.opacity = '0';
        parts.platter.style.opacity = '0';
        await settle([
          animate(parts.sleeve, { transform: [tilt(out.size), 'none'] }, { duration: 440, easing: EASE_IN_OUT }),
          animate(parts.record, { transform: ['none', inverse(target, to)] }, { duration: 440, easing: EASE_IN_OUT }),
          animate(parts.platter, { opacity: [1, 0] }, { duration: 240, easing: 'ease-in' }),
          animate(parts.backdrop, { opacity: [1, 0] }, { duration: 440, easing: 'ease-in' }),
        ]);
      }
    } catch (err) {
      console.error('[player] Schließen-Animation fehlgeschlagen', err);
    } finally {
      // Immer in den Ausgangszustand zurück – egal, was oben passiert ist.
      clearInterval(ticker);
      clearTimeout(toastTimer);
      parts.spin.cancel();
      parts.tonearm.destroy();
      layer.hidden = true;
      for (const animation of [...active, ...layer.getAnimations({ subtree: true })]) animation.cancel();
      active.clear();
      layer.replaceChildren();
      layer.removeAttribute('style');
      parts.button.classList.remove('is-opening');
      current = null;
      armHold = false;
      listProgress = 0;
    }
  }

  store.subscribe((state) => render(state));

  return {
    el: layer,
    open,
    close,
    isOpen: () => current !== null,
    /** Schlüssel der aufgelegten Platte (für die Rückkehr-Animation) */
    currentKey: () => current?.item.key ?? null,
    currentRecord: () => current?.item.record ?? null,
  };
}
