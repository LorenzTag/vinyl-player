// @ts-check
// Plattenteller-Ebene: Die angetippte Hülle fliegt an ihren Platz und legt
// sich schräg, die Schallplatte gleitet heraus auf den Plattenteller. Den
// Tonarm auf die Platte ziehen = abspielen, zurück = stoppen.
//
// Zuverlässigkeit: Endpositionen legt CSS fest (Quer- und Hochformat);
// animiert wird nur von der gemessenen Starthülle dorthin (FLIP, nur
// transform/opacity). Jede Animation hat eine Zeitgrenze und endet in einem
// definierten Zustand – auch wenn sie unterbrochen wird.

import { h, svg, prefersReducedMotion } from './dom.js';
import { createCover, labelColors } from './cover-art.js';
import { metaLine } from './format.js';
import { createTonearm } from './tonearm.js';

/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
const SPIN_SECONDS = 1.8; // 33⅓ U/min

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/></svg>';

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
  return `perspective(${size * 3.2}px) translateX(${size * -0.04}px) rotateY(18deg) rotateX(4deg) rotateZ(-5deg)`;
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
  return rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < window.innerHeight;
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
      target = on ? (prefersReducedMotion() ? 0.3 : 1) : 0;
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
 *   onRequestClose: () => void,
 *   onRequestPlay: (on: boolean) => void,
 * }} handlers
 */
export function createRecordPlayer({ onRequestClose, onRequestPlay }) {
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
  let playing = false;

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
    if (event.key === 'Escape') onRequestClose();
  });

  /** @param {DisplayItem} item */
  function build(item) {
    const { record } = item;
    const colors = labelColors(record);

    const spinEl = h('div', { class: 'record__spin' },
      h('div', { class: 'record__label', style: { '--label-color': colors.color, '--label-ink': colors.ink } },
        h('div', { class: 'record__label-title' }, record.title),
        h('div', { class: 'record__label-sub' }, record.kind === 'album' ? record.subtitle : 'Playlist'),
      ),
    );
    const disc = h('div', { class: 'record__disc', 'aria-hidden': 'true' }, spinEl, h('div', { class: 'record__sheen' }));
    const sleeve = h('div', { class: 'record__sleeve' }, createCover(record));
    const recordEl = h('div', { class: 'record' }, disc, sleeve);
    const platter = h('div', { class: 'platter', 'aria-hidden': 'true' });
    const tonearm = createTonearm({ onRequest: onRequestPlay });
    const deck = h('div', { class: 'player__deck' }, platter, recordEl, tonearm.el);

    const status = h('div', { class: 'player__status', 'aria-live': 'polite' });
    const toggle = h('button', { type: 'button', class: 'player__toggle', onclick: () => onRequestPlay(!playing) });
    const back = h('button', { type: 'button', class: 'player__back', onclick: () => onRequestClose() },
      h('span', { 'aria-hidden': 'true' }, '←'), 'Sammlung');
    const bar = h('div', { class: 'player__bar' },
      back,
      h('div', { class: 'player__now' },
        h('h2', { class: 'player__title', id: 'player-title' }, record.title),
        h('div', { class: 'player__subtitle' }, `${record.subtitle} · ${metaLine(item)}`),
        status,
      ),
      toggle,
    );

    const backdrop = h('div', { class: 'player-layer__backdrop' });
    layer.replaceChildren(
      backdrop,
      h('div', { class: 'player' }, h('div', { class: 'player__stage' }, deck), bar),
    );
    return { record: recordEl, disc, sleeve, platter, tonearm, deck, bar, backdrop, status, toggle, spin: createSpin(spinEl) };
  }

  /** Anzeige (Tonarm, Drehen, Leiste) an den Abspielzustand anpassen. */
  function renderPlaying() {
    if (!current) return;
    const { tonearm, spin, status, toggle } = current;
    tonearm.setOn(playing);
    spin.set(playing);
    status.textContent = playing ? 'Läuft · Spotify folgt in Schritt 2' : 'Tonarm auf die Platte ziehen';
    toggle.replaceChildren(svg(playing ? ICON_STOP : ICON_PLAY));
    toggle.setAttribute('aria-label', playing ? 'Stoppen' : 'Abspielen');
    toggle.setAttribute('aria-pressed', String(playing));
  }

  /**
   * Abspielzustand von außen setzen (Quelle der Wahrheit ist der App-Zustand).
   * @param {boolean} on
   */
  function setPlaying(on) {
    playing = on;
    renderPlaying();
  }

  /** Zielverschiebung der Platte (aus CSS, je nach Ausrichtung) in px. */
  function discOffset(parts) {
    const style = getComputedStyle(parts.deck);
    const size = parts.record.offsetWidth;
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
    layer.hidden = false;
    renderPlaying();
    const reduced = prefersReducedMotion();

    try {
      const to = parts.record.getBoundingClientRect();
      const out = discOffset(parts);
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
   * @param {HTMLElement | null} sleeve  Hülle, in die die Platte zurückkehrt (falls noch sichtbar)
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

    try {
      // Tonarm erst zurück in die Ruhelage, dann die Platte einpacken.
      playing = false;
      renderPlaying();
      const armTime = parts.tonearm.settleTime();
      if (armTime > 0 && !reduced) await wait(Math.min(armTime, 700));

      const target = sleeve?.isConnected ? sleeve.getBoundingClientRect() : null;
      if (reduced || !target || !isUsable(target)) {
        await settle([animate(layer, { opacity: [1, 0] }, { duration: reduced ? 160 : 260, easing: 'ease-in', fill: 'forwards' })]);
      } else {
        const out = discOffset(parts);
        parts.record.classList.remove('is-out');
        parts.bar.style.opacity = '0';
        parts.tonearm.el.style.opacity = '0';
        await settle([
          animate(parts.bar, { opacity: [1, 0] }, { duration: 160, easing: 'ease-in' }),
          animate(parts.tonearm.el, { opacity: [1, 0] }, { duration: 260, easing: 'ease-in' }),
          animate(parts.disc,
            { transform: [`translate(${out.x}px, ${out.y}px)`, 'translate(0px, 0px)'] },
            { duration: 460, easing: EASE_IN_OUT }),
        ]);
        const to = parts.record.getBoundingClientRect();
        parts.record.classList.remove('is-tilted');
        parts.record.style.transform = inverse(target, to);
        parts.backdrop.style.opacity = '0';
        parts.platter.style.opacity = '0';
        await settle([
          animate(parts.sleeve, { transform: [tilt(out.size), 'none'] }, { duration: 440, easing: EASE_IN_OUT }),
          animate(parts.record, { transform: ['none', inverse(target, to)] }, { duration: 440, easing: EASE_IN_OUT }),
          animate(parts.platter, { opacity: [1, 0] }, { duration: 260, easing: 'ease-in' }),
          animate(parts.backdrop, { opacity: [1, 0] }, { duration: 440, easing: 'ease-in' }),
        ]);
      }
    } catch (err) {
      console.error('[player] Schließen-Animation fehlgeschlagen', err);
    } finally {
      // Immer in den Ausgangszustand zurück – egal, was oben passiert ist.
      parts.spin.cancel();
      parts.tonearm.destroy();
      layer.hidden = true;
      for (const animation of [...active, ...layer.getAnimations({ subtree: true })]) animation.cancel();
      active.clear();
      layer.replaceChildren();
      parts.button.classList.remove('is-opening');
      current = null;
    }
  }

  return {
    el: layer,
    open,
    close,
    setPlaying,
    isOpen: () => current !== null,
    /** Schlüssel der aufgelegten Platte (für die Rückkehr-Animation) */
    currentKey: () => current?.item.key ?? null,
  };
}
