// @ts-check
// Plattenspieler-Bildschirm: Die angetippte Hülle fliegt an ihren Platz und
// legt sich schräg, die Schallplatte gleitet heraus auf den Plattenteller.
//
// Bedienung
// - Tonarm auf die Platte ziehen = abspielen (die Nadelposition wählt den Titel),
//   herunterziehen = Pause. Antippen schaltet ebenfalls um.
// - Platte zur Hülle ziehen = einpacken: Wiedergabe endet, zurück zur Sammlung.
// - Nach links/rechts wischen = nächster/vorheriger Titel.
// - Leiste: Sammlung (Musik läuft weiter), ⏮ ▶/❚❚ ⏭, Titelliste.
//
// Zuverlässigkeit: Endpositionen legt CSS fest (Quer- und Hochformat);
// animiert wird nur transform/opacity. Jede Animation hat eine Zeitgrenze und
// endet in einem definierten Zustand – auch wenn sie unterbrochen wird.
// Angezeigt wird immer der Zustand des Abspielgeräts, nicht die Absicht.

import { h, svg, clamp, prefersReducedMotion } from './dom.js';
import { createCover } from './cover-art.js';
import { playerTheme, paletteFromImage } from './cover-colors.js';
import { formatDuration, metaLine } from './format.js';
import { createTonearm } from './tonearm.js';
import { createTracklist } from './tracklist.js';

/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */
/** @typedef {import('../state/app-state.js').AppStore} AppStore */
/** @typedef {import('../state/app-state.js').AppState} AppState */
/** @typedef {import('../state/playback.js').PlaybackController} PlaybackController */

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
const SPIN_SECONDS = 1.8;      // 33⅓ U/min
const TICK_MS = 250;           // Fortschritt und Tonarm nachführen
const GESTURE_SLOP = 10;       // px, ab dann ist es eine Wischgeste
const SKIP_DISTANCE = 70;      // px Wischweg für Titelwechsel
const PUTAWAY_FRACTION = 0.38; // so weit muss die Platte zur Hülle gezogen werden

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

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {DOMRect} rect */
function isUsable(rect) {
  return rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < window.innerHeight
    && rect.right > 0 && rect.left < window.innerWidth;
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
    rate = target > rate ? Math.min(target, rate + dt / 0.8) : Math.max(target, rate - dt / 1.2);
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
  let view = { isCurrent: false, playing: false, tracks: /** @type {import('../data/types.js').Track[]} */ ([]), index: -1 };

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
    if (event.key !== 'Escape') return;
    if (current?.tracklist.isOpen()) current.tracklist.close();
    else onRequestClose();
  });

  // ---------- Aufbau ----------

  /** @param {DisplayItem} item */
  function build(item) {
    const { record } = item;

    const spinEl = h('div', { class: 'record__spin' },
      h('div', { class: 'record__label' },
        h('div', { class: 'record__label-title' }, record.title),
        h('div', { class: 'record__label-sub' }, record.kind === 'album' ? record.subtitle : 'Playlist'),
      ),
    );
    const disc = h('div', { class: 'record__disc', 'aria-hidden': 'true' }, spinEl, h('div', { class: 'record__sheen' }));
    const sleeve = h('div', { class: 'record__sleeve' }, createCover(record));
    const recordEl = h('div', { class: 'record' }, disc, sleeve);
    const platter = h('div', { class: 'platter', 'aria-hidden': 'true' });
    const tonearm = createTonearm({
      onRequest: (on, fraction) => onArmRequest(on, fraction),
      onHover: (fraction) => showArmHint(fraction),
    });
    const deck = h('div', { class: 'player__deck' }, platter, recordEl, tonearm.el);
    const hint = h('div', { class: 'player__hint', 'aria-hidden': 'true' });
    const stage = h('div', { class: 'player__stage' }, deck, hint);

    const title = h('h2', { class: 'player__title', id: 'player-title' });
    const subtitle = h('div', { class: 'player__subtitle' });
    const status = h('div', { class: 'player__status', 'aria-live': 'polite' });
    const progressFill = h('div', { class: 'player__progress-fill' });
    const progress = h('div', { class: 'player__progress', 'aria-hidden': 'true' }, progressFill);

    const back = h('button', { type: 'button', class: 'player__back', 'aria-label': 'Zurück zur Sammlung (Musik läuft weiter)', onclick: () => onRequestClose() },
      h('span', { 'aria-hidden': 'true' }, '←'), h('span', { class: 'player__back-label' }, 'Sammlung'));
    const prev = h('button', { type: 'button', class: 'player__ctrl', 'aria-label': 'Vorheriger Titel', onclick: () => skip(-1) });
    const toggle = h('button', { type: 'button', class: 'player__toggle', onclick: () => onToggle() });
    const next = h('button', { type: 'button', class: 'player__ctrl', 'aria-label': 'Nächster Titel', onclick: () => skip(1) });
    const listButton = h('button', { type: 'button', class: 'player__ctrl', 'aria-label': 'Titelliste', onclick: () => current?.tracklist.open() });
    prev.append(svg(ICONS.prev));
    next.append(svg(ICONS.next));
    listButton.append(svg(ICONS.list));

    const bar = h('div', { class: 'player__bar' },
      back,
      h('div', { class: 'player__now' }, title, subtitle, status),
      h('div', { class: 'player__controls' }, prev, toggle, next, listButton),
      progress,
    );

    const tracklist = createTracklist({
      onSelect: (index) => {
        tracklist.close();
        playback.playRecord(record, index);
      },
      onClose: () => tracklist.close(),
    });
    const toast = h('div', { class: 'player__toast', role: 'status', 'aria-live': 'polite' });

    const backdrop = h('div', { class: 'player-layer__backdrop' });
    layer.replaceChildren(
      backdrop,
      h('div', { class: 'player' }, stage, bar),
      tracklist.el,
      toast,
    );

    stage.addEventListener('pointerdown', onStagePointerDown);

    return {
      record: recordEl, disc, sleeve, platter, tonearm, deck, stage, bar, backdrop, hint,
      title, subtitle, status, progress, progressFill, toggle, prev, next, tracklist, toast,
      spin: createSpin(spinEl),
    };
  }

  /** Farben des Covers übernehmen (echtes Cover: sobald die Farben gelesen sind). */
  function applyTheme(/** @type {DisplayItem} */ item) {
    const set = (/** @type {Record<string, string>} */ vars) => {
      for (const [name, value] of Object.entries(vars)) layer.style.setProperty(name, value);
    };
    set(playerTheme(item.record));
    if (item.record.imageUrl) {
      paletteFromImage(item.record.imageUrl).then((palette) => {
        if (palette && current?.item.key === item.key) set(playerTheme(item.record, palette));
      });
    }
  }

  // ---------- Darstellung aus dem Zustand ----------

  /** Position im aktuellen Titel (hochgerechnet) */
  function positionMs(/** @type {AppState['playback']} */ pb) {
    return pb.playing ? pb.positionMs + (Date.now() - pb.at) : pb.positionMs;
  }

  /** Fortschritt über die ganze Platte (0…1) – bestimmt die Lage des Tonarms. */
  function recordProgress(/** @type {AppState['playback']} */ pb) {
    const n = view.tracks.length;
    if (!view.isCurrent || !n) return 0;
    const track = view.tracks[view.index];
    const within = track ? clamp(positionMs(pb) / track.durationMs, 0, 1) : 0;
    return (view.index + within) / n;
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
    const index = isCurrent ? pb.index : -1;
    const track = isCurrent ? tracks[index] : undefined;
    const playing = isCurrent && pb.playing;
    view = { isCurrent, playing, tracks, index };

    // Tonarm und Teller. Solange ein Befehl unterwegs ist, bleibt der Arm, wo
    // die Hand ihn hingelegt hat; danach folgt er dem tatsächlichen Zustand.
    if (!pb.pending) current.tonearm.setState({ on: playing, progress: recordProgress(pb) });
    current.spin.set(playing);

    // Leiste
    current.title.textContent = track ? track.title : record.title;
    current.subtitle.textContent = track ? `${track.artists} · ${record.title}` : `${record.subtitle} · ${metaLine(item)}`;
    current.status.textContent = pb.pending
      ? 'Einen Moment …'
      : isCurrent
        ? `${playing ? 'Titel' : 'Pausiert · Titel'} ${index + 1} von ${tracks.length}`
        : pb.context
          ? `Läuft gerade: ${pb.context.title}`
          : 'Tonarm auf die Platte ziehen';
    current.toggle.replaceChildren(svg(playing ? ICONS.pause : ICONS.play));
    current.toggle.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
    current.prev.disabled = !isCurrent;
    current.next.disabled = !isCurrent;
    current.bar.classList.toggle('has-progress', isCurrent);

    current.tracklist.render({
      recordTitle: record.title,
      tracks,
      current: index,
      playing,
      status: isCurrent ? 'ready' : list?.status ?? 'loading',
      error: list?.error?.message,
    });

    if (pb.error && pb.error !== shownError) {
      shownError = pb.error;
      showToast(pb.error.message);
    }
    tick();
  }

  /** Fortschrittsbalken, Zeit und Tonarm nachführen (läuft 4× pro Sekunde). */
  function tick() {
    if (!current) return;
    const pb = store.get().playback;
    const track = view.isCurrent ? view.tracks[view.index] : undefined;
    if (!track) {
      current.progressFill.style.transform = 'scaleX(0)';
      return;
    }
    const pos = clamp(positionMs(pb), 0, track.durationMs);
    current.progressFill.style.transform = `scaleX(${(pos / track.durationMs).toFixed(4)})`;
    current.status.dataset.time = `${formatDuration(pos)} / ${formatDuration(track.durationMs)}`;
    if (view.playing && !pb.pending && !gesture) {
      current.tonearm.setState({ on: true, progress: recordProgress(pb) }, 'track');
    }
  }

  /** @param {string} text */
  function showToast(text) {
    if (!current) return;
    clearTimeout(toastTimer);
    current.toast.textContent = text;
    current.toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => current?.toast.classList.remove('is-visible'), 2200);
  }

  /** Hinweis beim Ziehen des Tonarms: welcher Titel liegt unter der Nadel? */
  function showArmHint(/** @type {number | null} */ fraction) {
    if (!current) return;
    const { hint } = current;
    const n = view.tracks.length || store.get().tracklists[current.item.record.id]?.items.length || 0;
    if (fraction === null || !n) {
      hint.classList.remove('is-visible');
      return;
    }
    const tracks = view.tracks.length ? view.tracks : store.get().tracklists[current.item.record.id]?.items ?? [];
    const index = Math.min(n - 1, Math.floor(fraction * n));
    hint.textContent = `${index + 1} · ${tracks[index]?.title ?? ''}`;
    hint.classList.add('is-visible');
  }

  // ---------- Absichten ----------

  /**
   * @param {boolean} on
   * @param {number | null} fraction  Nadelposition (null = angetippt)
   */
  function onArmRequest(on, fraction) {
    if (!current) return;
    const { record } = current.item;
    if (!on) {
      playback.pause();
      return;
    }
    if (fraction === null) {
      // Angetippt: laufende Platte fortsetzen, sonst von vorn.
      if (playback.isContext(record)) playback.resume();
      else playback.playRecord(record, 0);
      return;
    }
    const n = view.tracks.length || store.get().tracklists[record.id]?.items.length || 1;
    playback.dropNeedle(record, Math.min(n - 1, Math.floor(fraction * n)));
  }

  function onToggle() {
    if (!current) return;
    const { record } = current.item;
    if (view.playing) playback.pause();
    else if (playback.isContext(record)) playback.resume();
    else playback.playRecord(record, 0);
  }

  /** @param {1 | -1} direction */
  function skip(direction) {
    if (!view.isCurrent) {
      showToast('Erst den Tonarm auflegen');
      return;
    }
    showToast(direction > 0 ? 'Nächster Titel' : 'Vorheriger Titel');
    if (direction > 0) playback.next();
    else playback.previous();
  }

  // ---------- Gesten auf der Bühne ----------

  /**
   * @type {{
   *   id: number, x: number, y: number, onDisc: boolean,
   *   mode: 'putaway' | 'skip' | 'none' | null,
   *   samples: Array<{ t: number, x: number, y: number }>,
   *   along: number,
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
  function onStagePointerDown(event) {
    if (gesture || closing || opening || !current || current.tracklist.isOpen()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = /** @type {Element} */ (event.target);
    if (target.closest('.tonearm__grip, button')) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      onDisc: !!target.closest('.record__disc'),
      mode: null,
      samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }],
      along: 0,
    };
  }

  /** @param {PointerEvent} event */
  function onGestureMove(event) {
    if (!gesture || event.pointerId !== gesture.id || !current) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    gesture.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (gesture.samples.length > 8) gesture.samples.shift();

    if (!gesture.mode) {
      if (Math.hypot(dx, dy) < GESTURE_SLOP) return;
      const dir = sleeveDirection();
      const along = dx * dir.ux + dy * dir.uy;
      const across = Math.abs(dx * dir.uy - dy * dir.ux);
      if (gesture.onDisc && along > 0 && along >= across) {
        gesture.mode = 'putaway';
        current.disc.classList.add('is-dragging');
        current.tonearm.park(true);
        try {
          current.stage.setPointerCapture(event.pointerId);
        } catch {
          // ohne Capture: Loslassen wird trotzdem fensterweit erkannt
        }
      } else {
        gesture.mode = Math.abs(dx) > Math.abs(dy) ? 'skip' : 'none';
      }
    }

    if (gesture.mode === 'putaway') {
      const dir = sleeveDirection();
      gesture.along = clamp(dx * dir.ux + dy * dir.uy, -24, dir.length);
      const keep = 1 - gesture.along / dir.length;
      current.disc.style.transform = `translate(${(dir.out.x * keep).toFixed(1)}px, ${(dir.out.y * keep).toFixed(1)}px)`;
    }
  }

  /** @param {PointerEvent} event */
  function onGestureEnd(event) {
    if (!gesture || event.pointerId !== gesture.id || !current) return;
    const g = gesture;
    gesture = null;
    const last = g.samples[g.samples.length - 1];
    const first = g.samples.find((s) => last.t - s.t <= 100) ?? last;
    const dt = Math.max(1, last.t - first.t);
    const cancelled = event.type === 'pointercancel';

    if (g.mode === 'putaway') {
      const dir = sleeveDirection();
      const speed = ((last.x - first.x) * dir.ux + (last.y - first.y) * dir.uy) / dt; // px/ms Richtung Hülle
      const fraction = g.along / dir.length;
      if (!cancelled && (fraction > PUTAWAY_FRACTION || (fraction > 0.12 && speed > 0.6))) {
        onRequestClose({ putAway: true });
      } else {
        springBack();
      }
    } else if (g.mode === 'skip' && !cancelled) {
      const dx = last.x - g.x;
      const vx = (last.x - first.x) / dt;
      if (dx < -SKIP_DISTANCE || (dx < -30 && vx < -0.5)) skip(1);
      else if (dx > SKIP_DISTANCE || (dx > 30 && vx > 0.5)) skip(-1);
    }
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

  window.addEventListener('pointermove', onGestureMove, true);
  window.addEventListener('pointerup', onGestureEnd, true);
  window.addEventListener('pointercancel', onGestureEnd, true);

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
    applyTheme(item);
    layer.hidden = false;
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
      if (current?.record === parts.record && !closing) parts.toggle.focus({ preventScroll: true });
    } catch (err) {
      console.error('[player] Öffnen-Animation fehlgeschlagen', err);
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
    parts.tracklist.close();

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
      parts.tracklist.destroy();
      layer.hidden = true;
      for (const animation of [...active, ...layer.getAnimations({ subtree: true })]) animation.cancel();
      active.clear();
      layer.replaceChildren();
      layer.removeAttribute('style');
      parts.button.classList.remove('is-opening');
      current = null;
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
