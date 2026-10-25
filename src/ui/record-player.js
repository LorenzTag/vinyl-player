// @ts-check
// Plattenteller-Ebene: Die angetippte Hülle fliegt an ihren Platz, die
// Schallplatte gleitet heraus und beginnt sich zu drehen. Danach (vorerst)
// der Platzhalter für den Player aus Schritt 2.
//
// Zuverlässigkeit: Endpositionen legt CSS fest; animiert wird nur von der
// gemessenen Starthülle dorthin (FLIP, nur transform/opacity). Jede Animation
// endet in einem definierten Zustand – auch wenn sie abgebrochen wird.

import { h, prefersReducedMotion } from './dom.js';
import { createCover, labelColors } from './cover-art.js';
import { kindLabel, metaLine } from './format.js';

/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
const DISC_OUT = 'translateX(57%)';

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
  return rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * @param {{ onRequestClose: () => void }} handlers
 */
export function createRecordPlayer({ onRequestClose }) {
  const layer = h('div', {
    class: 'player-layer',
    hidden: true,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'player-title',
  });

  /** @type {{ item: DisplayItem, button: HTMLElement, record: HTMLElement, disc: HTMLElement, info: HTMLElement, backdrop: HTMLElement } | null} */
  let current = null;
  /** @type {Promise<void> | null} */
  let opening = null;
  /** @type {Promise<void> | null} */
  let closing = null;

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

    const disc = h('div', { class: 'record__disc', 'aria-hidden': 'true' },
      h('div', { class: 'record__spin' },
        h('div', { class: 'record__label', style: { '--label-color': colors.color, '--label-ink': colors.ink } },
          h('div', { class: 'record__label-title' }, record.title),
          h('div', { class: 'record__label-sub' }, record.kind === 'album' ? record.subtitle : 'Playlist'),
        ),
      ),
      h('div', { class: 'record__sheen' }),
    );
    const recordEl = h('div', { class: 'record' },
      disc,
      h('div', { class: 'record__sleeve' }, createCover(record)),
    );

    const back = h('button', { type: 'button', class: 'button', onclick: () => onRequestClose() },
      '← Zurück zur Sammlung');
    const info = h('div', { class: 'player__info' },
      h('div', { class: 'player__eyebrow' }, `${kindLabel(record)} aufgelegt`),
      h('h2', { class: 'player__title', id: 'player-title' }, record.title),
      h('div', { class: 'player__subtitle' }, `${record.subtitle} · ${metaLine(item)}`),
      h('div', { class: 'player__note tex-paper' },
        h('strong', {}, 'Player kommt in Schritt 2'),
        h('span', {}, 'Hier steuerst du bald Spotify auf dem iPad – Wiedergabe, Titel, Lautstärke.'),
      ),
      back,
    );

    const backdrop = h('div', { class: 'player-layer__backdrop' });
    layer.replaceChildren(
      backdrop,
      h('div', { class: 'player' }, h('div', { class: 'player__deck' }, recordEl), info),
    );
    return { record: recordEl, disc, info, backdrop, back };
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
    const reduced = prefersReducedMotion();

    try {
      const to = parts.record.getBoundingClientRect();
      button.classList.add('is-opening');
      parts.disc.style.transform = DISC_OUT;

      if (reduced || !isUsable(from)) {
        await settle([animate(layer, { opacity: [0, 1] }, { duration: reduced ? 180 : 300, easing: 'ease-out' })]);
      } else {
        await settle([
          animate(parts.backdrop, { opacity: [0, 1] }, { duration: 380, easing: 'ease-out' }),
          animate(parts.record, { transform: [inverse(from, to), 'none'] }, { duration: 560, easing: EASE_OUT }),
          animate(parts.disc,
            { transform: ['translateX(0)', DISC_OUT] },
            { duration: 640, delay: 420, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'backwards' },
          ),
          animate(parts.info,
            { opacity: [0, 1], transform: ['translateY(14px)', 'none'] },
            { duration: 420, delay: 640, easing: EASE_OUT, fill: 'backwards' },
          ),
        ]);
      }
      if (current?.record === parts.record && !closing) {
        parts.record.classList.add('is-playing');
        parts.back.focus({ preventScroll: true });
      }
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
    const { button, record, disc, info, backdrop } = current;
    const reduced = prefersReducedMotion();

    try {
      record.classList.remove('is-playing');
      const target = sleeve?.isConnected ? sleeve.getBoundingClientRect() : null;

      if (reduced || !target || !isUsable(target)) {
        await settle([animate(layer, { opacity: [1, 0] }, { duration: reduced ? 160 : 260, easing: 'ease-in', fill: 'forwards' })]);
      } else {
        const to = record.getBoundingClientRect();
        disc.style.transform = 'none';
        info.style.opacity = '0';
        await settle([
          animate(info, { opacity: [1, 0] }, { duration: 160, easing: 'ease-in' }),
          animate(disc, { transform: [DISC_OUT, 'translateX(0)'] }, { duration: 380, easing: EASE_IN_OUT }),
        ]);
        record.style.transform = inverse(target, to);
        backdrop.style.opacity = '0';
        await settle([
          animate(record, { transform: ['none', inverse(target, to)] }, { duration: 420, easing: EASE_IN_OUT }),
          animate(backdrop, { opacity: [1, 0] }, { duration: 420, easing: 'ease-in' }),
        ]);
      }
    } catch (err) {
      console.error('[player] Schließen-Animation fehlgeschlagen', err);
    } finally {
      // Immer in den Ausgangszustand zurück – egal, was oben passiert ist.
      layer.hidden = true;
      for (const animation of [...active, ...layer.getAnimations({ subtree: true })]) animation.cancel();
      active.clear();
      layer.replaceChildren();
      button.classList.remove('is-opening');
      current = null;
    }
  }

  return {
    el: layer,
    open,
    close,
    isOpen: () => current !== null,
    /** Schlüssel der aufgelegten Platte (für die Rückkehr-Animation) */
    currentKey: () => current?.item.key ?? null,
  };
}
