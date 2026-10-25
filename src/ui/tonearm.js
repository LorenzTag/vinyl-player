// @ts-check
// Tonarm wie beim Plattenspieler: auf die Platte ziehen = abspielen,
// herunterziehen = stoppen. Wo die Nadel landet, bestimmt den Titel (wie bei
// echtem Vinyl); während der Wiedergabe wandert der Arm langsam nach innen.
// Antippen (oder Leertaste/Enter) schaltet ebenfalls um.
//
// Geometrie (Ursprung = Drehpunkt): Ruhelage 0° zeigt senkrecht nach unten,
// positive Winkel schwenken den Arm nach links über die Platte. Zwischen
// ON_MIN (Einlaufrille) und ON_MAX (Auslaufrille) liegt die Nadel in den Rillen.
//
// Der Arm meldet nur Absichten (onRequest). Was wirklich läuft, kommt per
// setState() vom Zustand zurück – bei Spotify erst, wenn das Gerät es bestätigt.

import { h, clamp, prefersReducedMotion } from './dom.js';

const REST = 0;
const ON_MIN = 18;
const ON_MAX = 33;
const DROP_FROM = 13;    // ab hier gilt Loslassen als „auf die Platte gelegt"
const LIMIT_MIN = -2;
const LIMIT_MAX = 36;
const TAP_SLOP = 6;      // px

/** Winkel ↔ Position auf der Platte (0 = Anfang, 1 = Ende) */
const toAngle = (/** @type {number} */ f) => ON_MIN + (ON_MAX - ON_MIN) * clamp(f, 0, 1);
const toFraction = (/** @type {number} */ deg) => (clamp(deg, ON_MIN, ON_MAX) - ON_MIN) / (ON_MAX - ON_MIN);

/**
 * @param {{
 *   onRequest: (on: boolean, fraction: number | null) => void,
 *   onHover?: (fraction: number | null) => void,
 * }} handlers
 */
export function createTonearm({ onRequest, onHover }) {
  const grip = h('button', {
    type: 'button',
    class: 'tonearm__grip',
    role: 'switch',
    'aria-checked': 'false',
    'aria-label': 'Tonarm: auf die Platte legen zum Abspielen',
  });
  const arm = h('div', { class: 'tonearm__arm' },
    h('div', { class: 'tonearm__weight' }),
    h('div', { class: 'tonearm__tube' }),
    h('div', { class: 'tonearm__head' }),
    grip,
  );
  const base = h('div', { class: 'tonearm__base' });
  const el = h('div', { class: 'tonearm' }, h('div', { class: 'tonearm__rest' }), arm, base);

  // Gewünschter Zustand (von außen) – daraus ergibt sich der Winkel.
  let on = false;
  let progress = 0;     // 0…1 über die ganze Platte
  let parked = false;   // vorübergehend in Ruhelage (z. B. während die Platte gezogen wird)

  let angle = REST;
  let lastMove = 0;

  /**
   * @param {number} deg
   * @param {'instant' | 'swing' | 'track'} motion
   */
  function setAngle(deg, motion) {
    if (Math.abs(deg - angle) < 0.01) return;
    angle = deg;
    arm.classList.toggle('is-instant', motion === 'instant' || prefersReducedMotion());
    arm.classList.toggle('is-tracking', motion === 'track');
    arm.style.transform = `rotate(${deg.toFixed(3)}deg)`;
    if (motion !== 'track') lastMove = performance.now();
  }

  /** Winkel aus dem gewünschten Zustand ableiten. */
  function apply(/** @type {'swing' | 'track'} */ motion = 'swing') {
    if (drag?.moved) return; // Während des Ziehens bestimmt der Finger die Lage.
    const target = on && !parked ? toAngle(progress) : REST;
    // Sprünge (Titelwechsel, Auflegen) schwenken, kleine Fortschritte gleiten.
    setAngle(target, motion === 'track' && Math.abs(target - angle) < 0.6 ? 'track' : 'swing');
  }

  // ---------- Ziehen ----------

  /** @type {{ id: number, startAngle: number, startPointer: number, x: number, y: number, moved: boolean } | null} */
  let drag = null;
  let suppressClickUntil = 0;

  /** Winkel des Zeigers um den Drehpunkt (0° = senkrecht darunter). */
  function pointerAngle(clientX, clientY) {
    const r = base.getBoundingClientRect();
    return (Math.atan2(r.left + r.width / 2 - clientX, clientY - (r.top + r.height / 2)) * 180) / Math.PI;
  }

  grip.addEventListener('pointerdown', (event) => {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag = {
      id: event.pointerId,
      startAngle: angle,
      startPointer: pointerAngle(event.clientX, event.clientY),
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // ohne Capture funktioniert es trotzdem (Loslassen wird fensterweit erkannt)
    }
  });

  grip.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < TAP_SLOP) return;
      drag.moved = true;
      el.classList.add('is-lifted');
    }
    const next = clamp(drag.startAngle + (pointerAngle(event.clientX, event.clientY) - drag.startPointer), LIMIT_MIN, LIMIT_MAX);
    setAngle(next, 'instant');
    onHover?.(next >= DROP_FROM ? toFraction(next) : null);
  });

  /** @param {PointerEvent} event */
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const { moved } = drag;
    drag = null;
    el.classList.remove('is-lifted');
    onHover?.(null);
    if (!moved) return; // Tippen: das click-Ereignis schaltet um.
    suppressClickUntil = event.timeStamp + 400;

    const wantsOn = event.type !== 'pointercancel' && angle >= DROP_FROM;
    if (wantsOn) {
      // Nadel sanft in die Rillen setzen und Titel an dieser Stelle anfordern.
      setAngle(clamp(angle, ON_MIN, ON_MAX), 'swing');
      onRequest(true, toFraction(angle));
    } else {
      setAngle(REST, 'swing');
      if (on) onRequest(false, null);
    }
  }

  // Loslassen fensterweit erkennen, damit der Arm nie „am Finger" hängen bleibt.
  window.addEventListener('pointerup', endDrag, true);
  window.addEventListener('pointercancel', endDrag, true);
  grip.addEventListener('lostpointercapture', (event) => {
    if (drag && event.pointerId === drag.id) endDrag(event);
  });

  // Antippen bzw. Tastatur
  grip.addEventListener('click', (event) => {
    if (event.timeStamp < suppressClickUntil) return;
    onRequest(!on, null);
  });

  arm.style.transform = `rotate(${REST}deg)`;

  return {
    el,

    /**
     * Zustand von außen setzen (Quelle der Wahrheit ist der App-Zustand).
     * @param {{ on: boolean, progress: number }} next
     * @param {'swing' | 'track'} [motion]
     */
    setState(next, motion = 'swing') {
      const changed = next.on !== on;
      on = next.on;
      progress = next.progress;
      grip.setAttribute('aria-checked', String(on));
      grip.setAttribute('aria-label', on ? 'Tonarm: von der Platte nehmen zum Stoppen' : 'Tonarm: auf die Platte legen zum Abspielen');
      el.classList.toggle('is-on', on);
      apply(changed ? 'swing' : motion);
    },

    /** Arm vorübergehend in die Ruhelage (true) bzw. zurück an seinen Platz (false). */
    park(value) {
      parked = value;
      apply('swing');
    },

    /** ms, bis eine laufende Schwenkbewegung sicher abgeschlossen ist */
    settleTime: () => Math.max(0, lastMove + 650 - performance.now()),

    destroy() {
      drag = null;
      window.removeEventListener('pointerup', endDrag, true);
      window.removeEventListener('pointercancel', endDrag, true);
    },
  };
}
