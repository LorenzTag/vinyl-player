// @ts-check
// Vorschlag B: Plattenstapel (Cover-Flow) auf Filz.
//
// Position `pos` ist ein Kommawert: welche Platte (Index) gerade in der Mitte
// steht. Ziehen, Schwung, Einrasten, Tastatur und Mausrad verändern nur `pos`;
// render() leitet daraus für jede sichtbare Hülle transform/opacity ab – alles
// im selben Frame, ohne Layout-Arbeit.

import { h, clamp, prefersReducedMotion } from './dom.js';
import { createCover } from './cover-art.js';
import { accessibleName, metaLine } from './format.js';

/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */
/** @typedef {import('./view-types.js').View} View */
/** @typedef {import('./view-types.js').OpenHandler} OpenHandler */

const SLOT = 0.26;        // Abstand benachbarter Hüllen im Stapel (× Hüllengröße)
const PUSH = 0.42;        // Lücke links/rechts der mittleren Hülle (× Hüllengröße)
const ANGLE = 58;         // Drehung der seitlichen Hüllen in Grad
const RANGE = 5;          // so viele Hüllen je Seite werden dargestellt
const DRAG_THRESHOLD = 8; // px, ab dann ist es Ziehen statt Tippen
const RUBBER = 0.3;       // Widerstand hinter dem ersten/letzten Element
const MAX_VELOCITY = 28;  // Platten/s – deckelt Ausreißer bei der Schwungberechnung

/**
 * @typedef {Object} CrateEntry
 * @property {DisplayItem} item
 * @property {HTMLButtonElement} el
 * @property {HTMLElement} shade
 * @property {number} z
 */

/**
 * @param {{ onOpen: OpenHandler }} handlers
 * @returns {View}
 */
export function createCrateView({ onOpen }) {
  // Unsichtbarer Messkörper: liefert die per CSS bestimmte Hüllengröße (--size).
  const probe = h('div', { class: 'crate__probe', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'crate__stage' });
  const title = h('h2', { class: 'crate__title' });
  const subtitle = h('div', { class: 'crate__subtitle' });
  const meta = h('div', { class: 'crate__meta' });
  const caption = h('div', { class: 'crate__caption', 'aria-live': 'polite' }, title, subtitle, meta);
  const count = h('div', { class: 'crate__count', 'aria-hidden': 'true' });
  const root = h('div', { class: 'view crate tex-felt' }, probe, stage, caption, count);

  /** @type {CrateEntry[]} */
  let entries = [];
  /** Indizes, die gerade dargestellt werden */
  const shown = new Set();
  let size = 0;          // Hüllengröße in px
  let pos = 0;           // aktuelle Position (Index in der Mitte, Kommawert)
  let target = 0;        // Ziel der laufenden Animation
  let tau = 0.14;        // Zeitkonstante der Animation in s
  let raf = 0;           // laufende Animation
  let dragFrame = 0;     // ausstehendes Neuzeichnen beim Ziehen
  let lastFrame = 0;
  let centerIndex = -1;

  // ---------- Darstellung ----------

  function measure() {
    size = probe.offsetWidth || 300;
  }

  /**
   * @param {CrateEntry} entry
   * @param {number} d  Abstand zur Mitte in Platten (negativ = links)
   */
  function place(entry, d) {
    const a = Math.abs(d);
    const p = clamp(d, -1, 1);
    const x = d * SLOT * size + p * PUSH * size;
    const scale = 1 - 0.14 * Math.min(a, 1);
    entry.el.style.transform =
      `translate3d(${x.toFixed(2)}px,0,0) perspective(${Math.round(size * 2.6)}px) ` +
      `rotateY(${(-p * ANGLE).toFixed(2)}deg) scale(${scale.toFixed(4)})`;
    entry.el.style.opacity = a > RANGE - 1 ? clamp(RANGE - a, 0, 1).toFixed(3) : '1';
    entry.shade.style.opacity = Math.min(0.78, Math.min(a, 1) * 0.42 + Math.max(0, a - 1) * 0.07).toFixed(3);
    const z = 1000 - Math.round(a * 10);
    if (z !== entry.z) {
      entry.z = z;
      entry.el.style.zIndex = String(z);
    }
  }

  function render() {
    if (!entries.length) return;
    const lo = Math.max(0, Math.floor(pos) - RANGE);
    const hi = Math.min(entries.length - 1, Math.ceil(pos) + RANGE);
    for (const i of shown) {
      if (i < lo || i > hi) {
        entries[i].el.style.display = 'none';
        shown.delete(i);
      }
    }
    for (let i = lo; i <= hi; i++) {
      if (!shown.has(i)) {
        entries[i].el.style.display = '';
        shown.add(i);
      }
      place(entries[i], i - pos);
    }
    const center = clamp(Math.round(pos), 0, entries.length - 1);
    if (center !== centerIndex) setCenter(center);
  }

  /** @param {number} index */
  function setCenter(index) {
    const first = centerIndex === -1;
    centerIndex = index;
    const { item } = entries[index];
    title.textContent = item.record.title;
    subtitle.textContent = item.record.subtitle;
    meta.textContent = metaLine(item);
    count.textContent = `${index + 1} / ${entries.length}`;
    entries.forEach((e, i) => e.el.setAttribute('aria-current', String(i === index)));
    if (!first && !prefersReducedMotion()) {
      caption.classList.remove('is-changing');
      void caption.offsetWidth; // Animation neu starten
      caption.classList.add('is-changing');
    }
  }

  // ---------- Animation ----------

  /**
   * @param {number} index
   * @param {number} [timeConstant]  s; kleiner = schneller
   */
  function animateTo(index, timeConstant = 0.14) {
    if (!entries.length) return;
    target = clamp(Math.round(index), 0, entries.length - 1);
    tau = prefersReducedMotion() ? 0.05 : timeConstant;
    if (!raf) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  /** @param {number} now */
  function step(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    pos += (target - pos) * (1 - Math.exp(-dt / tau));
    if (Math.abs(target - pos) < 0.0008) pos = target;
    render();
    raf = pos === target ? 0 : requestAnimationFrame(step);
  }

  function stopAnimation() {
    if (raf) cancelAnimationFrame(raf);
    if (dragFrame) cancelAnimationFrame(dragFrame);
    raf = dragFrame = 0;
  }

  // ---------- Geste: Ziehen mit Schwung ----------

  /** @type {{ id: number, startX: number, startPos: number, dragging: boolean, samples: Array<{ t: number, x: number }> } | null} */
  let drag = null;
  let suppressClickUntil = 0;

  stage.addEventListener('pointerdown', (event) => {
    if (drag || !entries.length || (event.pointerType === 'mouse' && event.button !== 0)) return;
    stopAnimation();
    drag = { id: event.pointerId, startX: event.clientX, startPos: pos, dragging: false, samples: [{ t: event.timeStamp, x: event.clientX }] };
  });

  stage.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.startX;
    if (!drag.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.dragging = true;
      stage.classList.add('is-dragging');
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // Zeiger schon weg – pointerup/cancel räumt auf.
      }
    }
    const raw = drag.startPos - dx / (SLOT * size);
    const max = entries.length - 1;
    pos = raw < 0 ? raw * RUBBER : raw > max ? max + (raw - max) * RUBBER : raw;
    drag.samples.push({ t: event.timeStamp, x: event.clientX });
    if (drag.samples.length > 8) drag.samples.shift();
    if (!dragFrame) dragFrame = requestAnimationFrame(() => { dragFrame = 0; render(); });
  });

  /** @param {PointerEvent} event */
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const { dragging, samples } = drag;
    drag = null;
    stopAnimation();
    stage.classList.remove('is-dragging');
    if (!dragging) {
      // Tippen: Snap-Position sicherstellen, Klick-Ereignis folgt.
      if (pos !== Math.round(pos)) animateTo(pos);
      return;
    }
    suppressClickUntil = event.timeStamp + 80;

    // Geschwindigkeit aus den letzten ~100 ms (Platten pro Sekunde). Hat der
    // Finger vor dem Loslassen stillgehalten, gibt es keinen Schwung.
    const last = samples[samples.length - 1];
    const firstRecent = samples.find((s) => last.t - s.t <= 100) ?? last;
    const dt = (last.t - firstRecent.t) / 1000;
    const resting = event.timeStamp - last.t > 80;
    const raw = event.type === 'pointercancel' || resting || dt <= 0 ? 0 : -(last.x - firstRecent.x) / dt / (SLOT * size);
    const velocity = clamp(raw, -MAX_VELOCITY, MAX_VELOCITY);

    const projected = pos + velocity * 0.22;
    const destination = clamp(Math.round(projected), 0, entries.length - 1);
    const distance = Math.abs(destination - pos);
    const timeConstant = Math.abs(velocity) > 0.5 ? clamp(distance / Math.abs(velocity), 0.09, 0.3) : 0.14;
    animateTo(destination, timeConstant);
  }

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', (event) => {
    if (drag && event.pointerId === drag.id && drag.dragging) endDrag(event);
  });

  // ---------- Tippen, Tastatur, Mausrad ----------

  stage.addEventListener('click', (event) => {
    if (event.timeStamp < suppressClickUntil) return;
    const button = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.crate-item'));
    if (!button) return;
    const index = entries.findIndex((e) => e.el === button);
    if (index < 0) return;
    if (index === centerIndex && Math.abs(pos - index) < 0.2) {
      onOpen(entries[index].item, button, button);
    } else {
      animateTo(index, 0.16);
    }
  });

  root.addEventListener('keydown', (event) => {
    const stepBy = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!stepBy || !entries.length) return;
    event.preventDefault();
    const next = clamp(Math.round(target) + stepBy, 0, entries.length - 1);
    animateTo(next, 0.12);
    entries[next].el.focus({ preventScroll: true });
  });

  // Fokus per Tab-Taste holt die Platte in die Mitte.
  stage.addEventListener('focusin', (event) => {
    const index = entries.findIndex((e) => e.el === event.target);
    if (index >= 0 && index !== Math.round(target) && !drag) animateTo(index, 0.16);
  });

  let wheelTimer = 0;
  stage.addEventListener('wheel', (event) => {
    if (!entries.length) return;
    event.preventDefault();
    stopAnimation();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const max = entries.length - 1;
    pos = clamp(pos + delta / (SLOT * size * 1.6), -0.3, max + 0.3);
    render();
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => animateTo(pos, 0.12), 120);
  }, { passive: false });

  // Größe hängt vom Bildschirm ab (Drehen, Split View).
  const resizeObserver = new ResizeObserver(() => {
    measure();
    render();
  });
  resizeObserver.observe(stage);

  // ---------- View-Schnittstelle ----------

  return {
    el: root,

    setItems(items, { anchorKey } = {}) {
      stopAnimation();
      drag = null;
      shown.clear();
      centerIndex = -1;
      entries = items.map((item) => {
        const shade = h('div', { class: 'crate-item__shade' });
        const el = h('button', {
          type: 'button',
          class: 'crate-item',
          'aria-label': accessibleName(item.record),
          dataset: { key: item.key },
          style: { display: 'none' },
        }, createCover(item.record), shade);
        return { item, el, shade, z: 0 };
      });
      stage.replaceChildren(...entries.map((e) => e.el));
      const anchorIndex = anchorKey ? entries.findIndex((e) => e.item.key === anchorKey) : -1;
      pos = target = Math.max(0, anchorIndex);
      caption.hidden = entries.length === 0;
      count.hidden = entries.length === 0;
      if (!entries.length) {
        title.textContent = subtitle.textContent = meta.textContent = count.textContent = '';
        return;
      }
      measure();
      render();
    },

    getAnchorKey() {
      return entries[clamp(Math.round(target), 0, entries.length - 1)]?.item.key ?? null;
    },

    findSleeve(key) {
      return entries.find((e) => e.item.key === key)?.el ?? null;
    },

    destroy() {
      stopAnimation();
      clearTimeout(wheelTimer);
      resizeObserver.disconnect();
      root.remove();
    },
  };
}
