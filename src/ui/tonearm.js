// @ts-check
// Tonarm wie beim Plattenspieler: auf die Platte ziehen = abspielen,
// herunterziehen = stoppen. Antippen (oder Leertaste/Enter) schaltet ebenfalls um.
//
// Geometrie (in Plattenradien r, Ursprung = Drehpunkt des Arms):
// Ruhelage 0° zeigt senkrecht nach unten, positive Winkel schwenken den Arm
// nach links über die Platte. Zwischen ON_MIN und ON_MAX liegt die Nadel in
// den Rillen.
//
// Der Arm meldet nur Absichten (onRequest). Ob wirklich gespielt wird,
// entscheidet der Zustand und setzt ihn per setOn() – in Schritt 2 erst, wenn
// Spotify die Wiedergabe bestätigt hat.

import { h, clamp, prefersReducedMotion } from './dom.js';

const REST = 0;          // Ruhelage
const ON_START = 19;     // Einlaufrille (Anfang der Platte)
const ON_MIN = 18;       // äußerste Rille
const ON_MAX = 33;       // innerste Rille
const DROP_FROM = 13;    // ab hier gilt Loslassen als „auf die Platte gelegt"
const LIMIT_MIN = -2;
const LIMIT_MAX = 36;
const TAP_SLOP = 6;      // px

/**
 * @param {{ onRequest: (on: boolean) => void }} handlers
 */
export function createTonearm({ onRequest }) {
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
  const el = h('div', { class: 'tonearm' },
    h('div', { class: 'tonearm__rest' }),
    arm,
    base,
  );

  let on = false;
  let angle = REST;
  let lastMove = 0;

  /** @param {number} deg @param {boolean} animated */
  function setAngle(deg, animated) {
    angle = deg;
    arm.classList.toggle('is-instant', !animated || prefersReducedMotion());
    arm.style.transform = `rotate(${deg.toFixed(2)}deg)`;
    lastMove = performance.now();
  }

  /**
   * Zustand von außen setzen (Quelle der Wahrheit ist der App-Zustand).
   * @param {boolean} next
   */
  function setOn(next) {
    on = next;
    grip.setAttribute('aria-checked', String(on));
    grip.setAttribute('aria-label', on ? 'Tonarm: von der Platte nehmen zum Stoppen' : 'Tonarm: auf die Platte legen zum Abspielen');
    el.classList.toggle('is-on', on);
    if (drag) return; // Während des Ziehens bestimmt der Finger die Lage.
    if (on && (angle < ON_MIN || angle > ON_MAX)) setAngle(ON_START, true);
    if (!on && angle !== REST) setAngle(REST, true);
  }

  // ---------- Ziehen ----------

  /** @type {{ id: number, startAngle: number, startPointer: number, x: number, y: number, moved: boolean } | null} */
  let drag = null;
  let suppressClickUntil = 0;

  /** Winkel des Zeigers um den Drehpunkt (0° = senkrecht darunter). */
  function pointerAngle(clientX, clientY) {
    const r = base.getBoundingClientRect();
    const px = r.left + r.width / 2;
    const py = r.top + r.height / 2;
    return (Math.atan2(px - clientX, clientY - py) * 180) / Math.PI;
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
      // ohne Capture funktioniert es trotzdem, solange der Finger auf dem Arm bleibt
    }
  });

  grip.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < TAP_SLOP) return;
      drag.moved = true;
      el.classList.add('is-lifted');
    }
    const next = drag.startAngle + (pointerAngle(event.clientX, event.clientY) - drag.startPointer);
    setAngle(clamp(next, LIMIT_MIN, LIMIT_MAX), false);
  });

  /** @param {PointerEvent} event */
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const { moved } = drag;
    drag = null;
    el.classList.remove('is-lifted');
    if (!moved) return; // Tippen: das click-Ereignis schaltet um.
    suppressClickUntil = event.timeStamp + 400;

    const wantsOn = event.type !== 'pointercancel' && angle >= DROP_FROM;
    // Nadel sanft in die Rillen bzw. zurück in die Ruhelage setzen …
    setAngle(wantsOn ? clamp(angle, ON_MIN, ON_MAX) : REST, true);
    // … und die Absicht melden. Der Zustand kommt per setOn() zurück.
    if (wantsOn !== on) onRequest(wantsOn);
    else setOn(on);
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
    onRequest(!on);
  });

  setAngle(REST, false);

  return {
    el,
    setOn,
    isOn: () => on,
    /** ms, bis eine laufende Arm-Bewegung sicher abgeschlossen ist */
    settleTime: () => Math.max(0, lastMove + 650 - performance.now()),
    destroy() {
      drag = null;
      window.removeEventListener('pointerup', endDrag, true);
      window.removeEventListener('pointercancel', endDrag, true);
    },
  };
}
