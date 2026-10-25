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
import { playerTheme, paletteFromImage, cachedPalette, neutralTheme, loadImage, within } from './cover-colors.js';
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
const ERROR_VISIBLE_MS = 8000; // so lange steht ein Fehler in der Leiste

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
 * Was Hülle und Etikett zeigen: die Platte selbst oder ein Lied.
 * @typedef {{ key: string, cover: RecordItem, title: string, artist: string }} Display
 */

/**
 * Welches Cover gehört zu diesem Lied? Echtes Album-Cover, bei Alben das
 * Album selbst, sonst ein eigenes generiertes Cover je Lied. Gleiches Bild =
 * gleicher Schlüssel → kein unnötiger Wechsel (z. B. Lieder eines Albums).
 * @param {RecordItem} record
 * @param {Track | null | undefined} track
 * @returns {Display}
 */
function displayFor(record, track) {
  /** @type {RecordItem} */
  let cover = record;
  if (track?.imageUrl) {
    cover = { ...record, id: `${track.id}:cover`, title: track.title, subtitle: track.artists, kind: 'album', imageUrl: track.imageUrl };
  } else if (track && record.kind !== 'album') {
    cover = { ...record, id: `${track.id}:cover`, title: track.title, subtitle: track.artists, kind: 'album', imageUrl: null };
  }
  return {
    key: cover.imageUrl ? `img:${cover.imageUrl}` : `gen:${cover.id}`,
    cover,
    title: track?.title ?? record.title,
    artist: track?.artists ?? record.subtitle,
  };
}

/**
 * Schriftgröße des Etiketts nach Textlänge – damit nichts über den Rand auf die
 * Rillen ragt (Text liegt zusätzlich in einem Quadrat innerhalb des Kreises).
 * @param {string} text
 * @param {number[]} sizes  cqw-Größen von kurz bis lang
 * @param {number[]} limits Zeichengrenzen
 */
function labelSize(text, sizes, limits) {
  const i = limits.findIndex((limit) => text.length <= limit);
  return `${sizes[i === -1 ? sizes.length - 1 : i]}cqw`;
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
  let errorShownAt = 0;

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
  /** Wurde bei einer nicht laufenden Platte schon ein Lied gewählt? (sonst zeigt die Hülle die Platte) */
  let browsing = false;

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

    const labelTitle = h('div', { class: 'record__label-title' });
    const labelSub = h('div', { class: 'record__label-sub' });
    const labelText = h('div', { class: 'record__label-text' }, labelTitle, labelSub);
    const spinEl = h('div', { class: 'record__spin' }, h('div', { class: 'record__label' }, labelText));
    const disc = h('div', { class: 'record__disc', 'aria-hidden': 'true' }, spinEl, h('div', { class: 'record__sheen' }));
    const coverCard = h('div', { class: 'record__cover' }, createCover(record, { eager: true }));
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
      onSelect: (target) => selectFromList(target),
      onClose: () => setList(false),
    });
    const toast = h('div', { class: 'player__toast', role: 'status', 'aria-live': 'polite' });
    // Standard ist Standby: Leiste erst nach Tippen ins Leere einblenden.
    const player = h('div', { class: 'player is-standby' }, stage, bar);

    const backdrop = h('div', { class: 'player-layer__backdrop' });
    layer.replaceChildren(backdrop, player, tracklist.el, toast);

    return {
      record: recordEl, disc, sleeve, coverCard, platter, tonearm, deck, stage, bar, player, backdrop,
      labelTitle, labelSub, labelText, status, wake, progressFill, toggle, prev, next, tracklist, toast,
      spin: createSpin(spinEl),
      /** Ziel-Cover (Schlüssel aus displayFor), auch während es noch lädt */
      coverKey: displayFor(record, null).key,
      /** Text auf dem Etikett */
      /** @type {string | null} */
      labelKey: null,
    };
  }

  // ---------- Farben und Cover ----------

  /**
   * Farben setzen: Vinyl und Etikett gleiten per CSS-Übergang (registrierte
   * Farb-Variablen), der Hintergrund blendet als neue Ebene weich über.
   * @param {NonNullable<typeof current>} parts
   * @param {Record<string, string>} vars
   * @param {boolean} fade
   */
  function setTheme(parts, vars, fade) {
    if (current !== parts) return;
    for (const [name, value] of Object.entries(vars)) parts.record.style.setProperty(name, value);
    if (!fade || prefersReducedMotion()) {
      // Ohne Überblenden: Farben direkt auf die vorhandene Ebene.
      for (const [name, value] of Object.entries(vars)) parts.backdrop.style.setProperty(name, value);
      return;
    }
    const next = h('div', { class: 'player-layer__backdrop' });
    for (const [name, value] of Object.entries(vars)) next.style.setProperty(name, value);
    const old = parts.backdrop;
    old.after(next);
    parts.backdrop = next;
    settle([animate(next, { opacity: [0, 1] }, { duration: 900, easing: 'ease-in-out' })]).then(() => old.remove());
  }

  /**
   * Farben eines Covers. Bei echten Bildern erst, wenn sie gelesen sind –
   * null heißt: bisherige Farben behalten (nie zufällige Zwischenfarben).
   * @param {RecordItem} cover
   */
  async function themeFor(cover) {
    if (!cover.imageUrl) return playerTheme(cover);
    const palette = await within(paletteFromImage(cover.imageUrl), 1500);
    return palette ? playerTheme(cover, palette) : null;
  }

  /** Bild und Farben schon mal laden (z. B. für die Nachbar-Lieder). */
  function prefetch(/** @type {Display | null} */ display) {
    const url = display?.cover.imageUrl;
    if (!url) return;
    loadImage(url);
    paletteFromImage(url);
  }

  /** Etikett-Text wechseln: kurz aus-, dann einblenden. */
  function showLabel(/** @type {NonNullable<typeof current>} */ parts, /** @type {Display} */ display) {
    const key = `${display.title}\n${display.artist}`;
    if (parts.labelKey === key) return;
    const first = parts.labelKey === null;
    parts.labelKey = key;
    const apply = () => {
      parts.labelTitle.textContent = display.title;
      parts.labelSub.textContent = display.artist;
      parts.labelTitle.style.fontSize = labelSize(display.title, [12, 10, 8.4, 7.2, 6.2], [8, 14, 22, 32]);
      parts.labelSub.style.fontSize = labelSize(display.artist, [6, 5.2, 4.6], [16, 28]);
    };
    if (first || prefersReducedMotion()) {
      apply();
      return;
    }
    const out = animate(parts.labelText, { opacity: [1, 0] }, { duration: 140, easing: 'ease-in', fill: 'forwards' });
    settle([out]).then(() => {
      if (parts.labelKey !== key) return;
      apply();
      animate(parts.labelText, { opacity: [0, 1] }, { duration: 280, easing: 'ease-out' });
      out.cancel();
    });
  }

  let coverSeq = 0;

  /**
   * Cover auf der Hülle wechseln. Das alte gleitet sofort weg (die Geste
   * reagiert ohne Wartezeit); das neue kommt erst, wenn Bild und Farben
   * geladen sind – nichts ploppt nach.
   * @param {NonNullable<typeof current>} parts
   * @param {Display} display
   * @param {number} direction  1 = nächstes (nach oben), -1 = vorheriges, 0 = überblenden
   */
  async function changeCover(parts, display, direction) {
    parts.coverKey = display.key;
    const seq = ++coverSeq;
    const reduced = prefersReducedMotion();
    const old = parts.coverCard;
    const dir = reduced ? 0 : direction;

    if (dir && !old.dataset.gone) flyOut(old, dir);

    const [, theme] = await Promise.all([
      display.cover.imageUrl ? within(loadImage(display.cover.imageUrl), 2500) : null,
      themeFor(display.cover),
    ]);
    if (seq !== coverSeq || current !== parts) return;

    const card = h('div', { class: 'record__cover' }, createCover(display.cover, { eager: true }));
    old.after(card);
    parts.coverCard = card;
    if (theme) setTheme(parts, theme, true);
    const stale = [...parts.sleeve.querySelectorAll('.record__cover')].filter((c) => c !== card);
    if (reduced) {
      stale.forEach((c) => c.remove());
      return;
    }
    /** @type {Animation[]} */
    const animations = [];
    if (dir) {
      animations.push(animate(card, {
        transform: [`translateY(${dir * 62}%) rotate(${dir * 3}deg) scale(0.88)`, 'none'],
        opacity: [0, 1],
      }, { duration: 560, easing: 'cubic-bezier(0.18, 0.9, 0.3, 1.08)' }));
    } else {
      animations.push(animate(card, { transform: ['scale(1.05)', 'none'], opacity: [0, 1] }, { duration: 700, easing: EASE_OUT }));
      // Nur sichtbare alte Cover ausblenden – weggeflogene bleiben unsichtbar.
      for (const c of stale) {
        if (!c.dataset.gone) animations.push(animate(c, { opacity: [1, 0] }, { duration: 700, easing: 'ease-in-out', fill: 'forwards' }));
      }
    }
    await settle(animations);
    stale.forEach((c) => c.remove());
  }

  /**
   * Cover in Wischrichtung wegfliegen lassen (bleibt unsichtbar, bis es entfernt wird).
   * @param {HTMLElement} card
   * @param {number} dir
   */
  function flyOut(card, dir) {
    card.dataset.gone = '1';
    animate(card, {
      transform: [card.style.transform || 'none', `translateY(${-dir * 78}%) rotate(${-dir * 4}deg) scale(0.86)`],
      opacity: [1, 0],
    }, { duration: 340, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
  }

  /**
   * Das nächste Lied ist noch unbekannt (Shuffle, fremde Playlist, Ende der
   * Playlist): altes Cover trotzdem sofort wegfliegen lassen. Das neue kommt,
   * sobald Spotify den Wechsel meldet – bleibt die Meldung aus, kehrt das alte
   * zurück.
   * @param {number} dir
   */
  function launchCover(dir) {
    if (!current || prefersReducedMotion()) return;
    const parts = current;
    const card = parts.coverCard;
    if (card.dataset.gone) return;
    flyOut(card, dir);
    const key = parts.coverKey;
    setTimeout(() => {
      if (current !== parts || parts.coverCard !== card || parts.coverKey !== key || !card.isConnected) return;
      // Kein Wechsel gekommen: Cover zurückholen.
      for (const a of card.getAnimations()) a.cancel();
      delete card.dataset.gone;
      card.style.transform = '';
      animate(card, { transform: [`translateY(${-dir * 30}%) scale(0.92)`, 'none'], opacity: [0, 1] }, { duration: 420, easing: EASE_OUT });
    }, 4500);
  }

  /**
   * Hülle und Etikett auf ein Lied (oder die Platte) einstellen.
   * @param {Display} display
   * @param {number} direction
   */
  function show(display, direction) {
    if (!current) return;
    showLabel(current, display);
    if (current.coverKey !== display.key) changeCover(current, display, direction);
    else if (direction) bounceCover(direction); // gleiches Cover (z. B. Album): kurz nicken
  }

  /** Richtung des zuletzt gewünschten Wechsels – gilt höchstens 4 s. */
  let intent = { direction: 0, until: 0 };
  function takeDirection() {
    const direction = Date.now() < intent.until ? intent.direction : 0;
    intent = { direction: 0, until: 0 };
    return direction;
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
    const index = isCurrent ? pb.index : browsing && tracks.length ? selectedIndex : -1;
    const track = isCurrent ? tracks[index] ?? pb.track : browsing ? tracks[selectedIndex] ?? null : null;
    const playing = isCurrent && pb.playing;
    const count = tracks.length || record.trackCount;
    view = { isCurrent, playing, tracks, index, track, count };

    // Tonarm und Teller
    if (!armHold) current.tonearm.setState({ on: playing, progress: recordProgress(pb) });
    current.spin.set(playing);

    // Etikett und Cover zeigen das Lied (bzw. die Platte, solange nichts gewählt ist)
    const display = displayFor(record, track);
    if (!coverLocked) {
      const direction = current.coverKey !== display.key || current.labelKey !== `${display.title}\n${display.artist}` ? takeDirection() : 0;
      show(display, direction);
      // Nachbar-Lieder vorladen, damit der nächste Wisch sofort sitzt
      if (index >= 0) {
        prefetch(tracks[index + 1] ? displayFor(record, tracks[index + 1]) : null);
        prefetch(tracks[index - 1] ? displayFor(record, tracks[index - 1]) : null);
      }
    } else {
      showLabel(current, displayFor(record, null));
    }

    if (pb.error && pb.error !== shownError) {
      shownError = pb.error;
      errorShownAt = Date.now();
      showToast(pb.error.message);
      current.player.classList.remove('is-standby'); // Fehler nie verstecken
    }
    // Fehler stehen nur kurz in der Leiste – danach wieder der normale Status.
    const recentError = pb.error && Date.now() - errorShownAt < ERROR_VISIBLE_MS ? pb.error : null;

    // Leiste (nur das Nötigste – Titel steht auf der Platte)
    const where = pb.deviceName ?? '';
    current.status.textContent = recentError
      ? recentError.message
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
      nowPlaying: isCurrent ? track : null,
      playing,
      shuffle: isCurrent && pb.shuffle,
      queue: isCurrent && pb.queueFor === (pb.track?.uri ?? null) ? pb.queue : [],
      status: isCurrent && tracks.length ? 'ready' : list?.status ?? 'loading',
      error: list?.error?.message,
    });
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
    playback.dropNeedle(record, browsing ? selectedIndex : 0).finally(() => {
      armHold = false;
      render(store.get());
    });
  }

  function onToggle() {
    if (!current) return;
    const { record } = current.item;
    if (view.playing) playback.pause();
    else if (playback.isContext(record)) playback.resume();
    else playback.playRecord(record, browsing ? selectedIndex : 0);
  }

  /**
   * Nächstes / vorheriges Lied. Läuft die Platte, wird gesprungen; sonst nur
   * gewählt (startet beim Auflegen der Nadel).
   * @param {1 | -1} direction
   */
  function changeSong(direction) {
    if (!current) return;
    intent = { direction, until: Date.now() + 4000 };
    if (view.isCurrent) {
      const coverBefore = current.coverKey;
      const labelBefore = current.labelKey;
      if (direction > 0) playback.next();
      else playback.previous();
      // Kein sofortiger Wechsel (Ziel unbekannt)? Dann trotzdem gleich reagieren.
      if (current && current.coverKey === coverBefore && current.labelKey === labelBefore) launchCover(direction);
      return;
    }
    const { tracks } = view;
    const loaded = store.get().tracklists[current.item.record.id]?.items ?? tracks;
    if (!loaded.length) {
      intent = { direction: 0, until: 0 };
      bounceCover(direction);
      showToast('Für diese Platte gibt es keine Titelliste – Nadel auflegen zum Abspielen.');
      return;
    }
    // Erster Wisch zeigt das erste Lied, danach geht es Lied für Lied.
    const nextIndex = browsing ? clamp(selectedIndex + direction, 0, loaded.length - 1) : 0;
    if (browsing && nextIndex === selectedIndex) {
      intent = { direction: 0, until: 0 };
      bounceCover(direction);
      return;
    }
    browsing = true;
    selectedIndex = nextIndex;
    render(store.get());
  }

  /** Gleiches Cover oder Ende der Platte: das Cover nickt nur kurz in Wischrichtung. */
  function bounceCover(/** @type {number} */ direction) {
    if (!current || prefersReducedMotion()) return;
    const card = current.coverCard;
    const from = card.style.transform || 'none';
    card.style.transform = '';
    animate(card, { transform: [from, `translateY(${-direction * 7}%)`, 'none'] }, { duration: 380, easing: EASE_OUT });
  }

  /**
   * Titel aus der Liste gewählt – aus „Alle Titel" (Index) oder aus der
   * Shuffle-Warteschlange (URI).
   * @param {{ index: number } | { uri: string }} target
   */
  function selectFromList(target) {
    if (!current) return;
    const { record } = current.item;
    const tracks = view.tracks.length ? view.tracks : store.get().tracklists[record.id]?.items ?? [];
    const index = 'index' in target ? target.index : tracks.findIndex((t) => t.uri === target.uri);
    if (index < 0) {
      showToast('Dieser Titel ist nicht auf dieser Platte – er kommt von Spotify als Nächstes.');
      return;
    }
    if (view.isCurrent && tracks[index]?.uri === view.track?.uri) {
      setList(false); // läuft schon
      return;
    }
    intent = { direction: index >= view.index ? 1 : -1, until: Date.now() + 4000 };
    browsing = true;
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
    // Gemessen wird die Lage OHNE die laufende Verschiebung (offsetLeft ignoriert
    // transform) – sonst schaukelt sich die Bewegung beim Ziehen auf.
    const playerLeft = current.player.getBoundingClientRect().left;
    const platterLeft = playerLeft + current.deck.offsetLeft + current.platter.offsetLeft;
    const deckShift = portrait ? window.innerWidth : Math.max(0, platterLeft - LIST_GAP);
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
    if (open) {
      current.tracklist.revealCurrent();
      if (playback.isContext(current.item.record)) playback.refreshQueue();
    }
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
      const up = dy < -SWIPE_DISTANCE || (dy < -20 && vy < -FLICK_SPEED);
      const down = dy > SWIPE_DISTANCE || (dy > 20 && vy > FLICK_SPEED);
      const keyBefore = current.coverKey;
      // Wechsel auslösen, solange die Karte noch am Finger hängt – das alte
      // Cover fliegt dann direkt von dort weiter.
      if (!cancelled && (up || down)) changeSong(up ? 1 : -1);
      if (current && current.coverCard === card && current.coverKey === keyBefore && !card.dataset.gone && card.style.transform) {
        // Kein (sofortiger) Cover-Wechsel: Karte zurückfedern lassen.
        const from = card.style.transform;
        card.style.transform = '';
        if (!prefersReducedMotion()) animate(card, { transform: [from, 'none'] }, { duration: 300, easing: EASE_OUT });
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
    browsing = false;
    listProgress = 0;
    intent = { direction: 0, until: 0 };
    coverLocked = true; // erst das Platten-Cover zeigen, damit der Flug passt
    // Farben: sofort, falls schon bekannt; sonst neutral und weich zu den echten.
    const { record } = item;
    const known = record.imageUrl ? cachedPalette(record.imageUrl) : null;
    setTheme(current, record.imageUrl ? (known ? playerTheme(record, known) : neutralTheme(record)) : playerTheme(record), false);
    if (record.imageUrl && !known) {
      themeFor(record).then((vars) => {
        if (vars && current?.item === item && current.coverKey === displayFor(record, null).key) setTheme(current, vars, true);
      });
    }
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
          // Im Standby (Standard) bleibt die Leiste verborgen – nicht kurz aufblitzen lassen.
          ...(parts.player.classList.contains('is-standby') ? [] : [animate(parts.bar,
            { opacity: [0, 1], transform: ['translateY(16px)', 'none'] },
            { duration: 420, delay: 700, easing: EASE_OUT, fill: 'backwards' })]),
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
    coverLocked = true;
    const home = displayFor(parts.item.record, null);
    showLabel(parts, home);
    if (parts.coverKey !== home.key) changeCover(parts, home, 0);

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
          ...(parts.player.classList.contains('is-standby') ? [] : [animate(parts.bar, { opacity: [1, 0] }, { duration: 160, easing: 'ease-in' })]),
          animate(parts.tonearm.el, { opacity: [1, 0] }, { duration: 220, easing: 'ease-in' }),
          animate(parts.disc, { transform: [discFrom, 'translate(0px, 0px)'] }, { duration: 420, easing: EASE_IN_OUT }),
        ]);
        const to = parts.record.getBoundingClientRect();
        parts.record.classList.remove('is-tilted');
        parts.record.style.transform = inverse(target, to);
        // Alle Hintergrund-Ebenen ausblenden (auch eine, die gerade noch überblendet).
        const backdrops = [...layer.querySelectorAll('.player-layer__backdrop')];
        for (const b of backdrops) /** @type {HTMLElement} */ (b).style.opacity = '0';
        parts.platter.style.opacity = '0';
        await settle([
          animate(parts.sleeve, { transform: [tilt(out.size), 'none'] }, { duration: 440, easing: EASE_IN_OUT }),
          animate(parts.record, { transform: ['none', inverse(target, to)] }, { duration: 440, easing: EASE_IN_OUT }),
          animate(parts.platter, { opacity: [1, 0] }, { duration: 240, easing: 'ease-in' }),
          ...backdrops.map((b) => animate(b, { opacity: [1, 0] }, { duration: 440, easing: 'ease-in' })),
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
