// @ts-check
// Plattenschrank: jede Zeile ist ein Regal (Cover-Flow). Die Zeile im Blick
// steht mittig und hell, die Nachbarn schauen gedimmt oben/unten herein.
//
// - links/rechts wischen: blättern in der Zeile (macht die Zeile selbst)
// - hoch/runter wischen: Regal wechseln – folgt dem Finger, rastet ein
// - Nachbar-Zeile antippen: in den Blick holen
// - Tastatur: ↑/↓ Regal, ←/→ Platte; Trackpad: senkrecht scrollen = Regal
//
// Zuverlässigkeit: bewegt wird nur per transform; Zeilen weit weg vom Blick
// zeichnen keine Hüllen.

import { h, clamp, prefersReducedMotion } from './dom.js';
import { createCrateView } from './crate-view.js';

/** @typedef {import('../state/shelves.js').Row} Row */
/** @typedef {import('./view-types.js').OpenHandler} OpenHandler */
/** @typedef {ReturnType<typeof createCrateView>} CrateView */

const GESTURE_SLOP = 10;    // px
const ROW_FLICK = 0.45;     // px/ms – schneller Wisch wechselt die Zeile auch ohne weiten Weg
const RUBBER = 0.35;

/**
 * @param {{ onOpen: OpenHandler, onFocusChange?: (rowId: string) => void, onSetup?: () => void }} handlers
 */
export function createCabinetView({ onOpen, onFocusChange, onSetup }) {
  const rowsEl = h('div', { class: 'cabinet__rows' });
  const root = h('div', { class: 'view cabinet' }, rowsEl);

  /**
   * @typedef {{ row: Row, el: HTMLElement, crate: CrateView, signature: string, plate: HTMLElement, empty: HTMLElement }} RowView
   * @type {RowView[]}
   */
  let views = [];
  let focus = 0;
  /** @type {number} aktuelle Verschiebung der Zeilen (px) */
  let offset = 0;

  // ---------- Aufbau ----------

  /** @param {Row} row */
  function signatureOf(row) {
    return `${row.name}|${row.items.map((i) => i.key).join(',')}`;
  }

  /** @param {Row} row @returns {RowView} */
  function createRow(row) {
    const crate = createCrateView({ onOpen });
    const plate = h('div', { class: 'cabinet-row__plate' });
    const empty = h('p', { class: 'cabinet-row__empty', hidden: true },
      'Leeres Regal – ',
      h('button', { type: 'button', class: 'cabinet-row__setup', onclick: () => onSetup?.() }, 'Platten einsortieren'),
    );
    const el = h('section', { class: 'cabinet-row', dataset: { id: row.id, kind: row.kind } },
      plate,
      h('div', { class: 'cabinet-row__crate' }, crate.el),
      empty,
      h('div', { class: 'cabinet-row__board tex-board', 'aria-hidden': 'true' }),
    );
    return { row, el, crate, signature: '', plate, empty };
  }

  /** @param {RowView} view @param {Row} row */
  function fillRow(view, row) {
    view.row = row;
    view.plate.replaceChildren(
      h('span', { class: 'cabinet-row__name' }, row.name),
      h('span', { class: 'cabinet-row__count' }, String(row.items.length)),
    );
    view.el.setAttribute('aria-label', `Regal ${row.name}`);
    view.empty.hidden = row.items.length > 0;
    const signature = signatureOf(row);
    if (signature !== view.signature) {
      const anchor = view.crate.getAnchorKey();
      view.signature = signature;
      view.crate.setItems(row.items, { anchorKey: anchor });
    }
  }

  // ---------- Lage der Zeilen ----------

  /** Verschiebung, bei der Zeile `index` mittig steht (ohne laufende Transform gemessen). */
  function offsetFor(index) {
    const view = views[index];
    if (!view) return 0;
    const height = root.clientHeight;
    return (height - view.el.offsetHeight) / 2 - view.el.offsetTop;
  }

  /** @param {boolean} animated */
  function place(animated) {
    rowsEl.classList.toggle('is-moving', animated && !prefersReducedMotion());
    rowsEl.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
  }

  function applyFocusState() {
    views.forEach((view, i) => {
      const isFocus = i === focus;
      view.el.classList.toggle('is-focus', isFocus);
      view.el.classList.toggle('is-near', Math.abs(i - focus) === 1);
      view.crate.setActive(isFocus);
      view.crate.setVisible(Math.abs(i - focus) <= 1);
      view.el.setAttribute('aria-hidden', String(!isFocus));
    });
  }

  /**
   * @param {number} index
   * @param {{ animated?: boolean, notify?: boolean }} [opts]
   */
  function setFocus(index, { animated = true, notify = true } = {}) {
    if (!views.length) return;
    const next = clamp(index, 0, views.length - 1);
    const changed = next !== focus;
    focus = next;
    applyFocusState();
    offset = offsetFor(focus);
    place(animated);
    if (changed && notify) onFocusChange?.(views[focus].row.id);
  }

  // ---------- Gesten: hoch/runter ----------

  /** @type {{ id: number, x: number, y: number, mode: 'vertical' | 'other' | null, start: number, samples: Array<{ t: number, y: number }> } | null} */
  let gesture = null;

  root.addEventListener('pointerdown', (event) => {
    if (gesture || !views.length || (event.pointerType === 'mouse' && event.button !== 0)) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: null, start: offset, samples: [{ t: event.timeStamp, y: event.clientY }] };
  });

  /** @param {PointerEvent} event */
  function onMove(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.mode) {
      if (Math.hypot(dx, dy) < GESTURE_SLOP) return;
      // Blättert die Zeile schon waagerecht? Dann gehört die Geste ihr.
      const dragging = views[focus]?.el.querySelector('.crate__stage.is-dragging');
      gesture.mode = !dragging && Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'other';
    }
    if (gesture.mode !== 'vertical') return;
    gesture.samples.push({ t: event.timeStamp, y: event.clientY });
    if (gesture.samples.length > 8) gesture.samples.shift();
    const min = offsetFor(views.length - 1);
    const max = offsetFor(0);
    let next = gesture.start + dy;
    if (next > max) next = max + (next - max) * RUBBER;
    if (next < min) next = min + (next - min) * RUBBER;
    offset = next;
    place(false);
  }

  /** @param {PointerEvent} event */
  function onUp(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    if (g.mode === null) {
      // Tippen auf eine gedimmte Nachbar-Zeile: in den Blick holen (nach Lage,
      // nicht nach Ziel-Element – die Zeile im Blick bekommt ihre Klicks selbst).
      const index = views.findIndex((v, i) => {
        if (i === focus) return false;
        const r = v.el.getBoundingClientRect();
        return event.clientY >= r.top && event.clientY <= r.bottom;
      });
      if (index >= 0) setFocus(index);
      return;
    }
    if (g.mode !== 'vertical') return;
    const last = g.samples[g.samples.length - 1];
    const first = g.samples.find((s) => last.t - s.t <= 100) ?? last;
    const vy = (last.y - first.y) / Math.max(1, last.t - first.t);
    const dy = last.y - g.y;
    const rowStep = views[focus]?.el.offsetHeight || 1;
    let steps = Math.round(-dy / (rowStep * 0.55));
    if (steps === 0 && Math.abs(vy) > ROW_FLICK) steps = vy < 0 ? 1 : -1;
    setFocus(focus + clamp(steps, -2, 2));
  }

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);

  // Trackpad/Mausrad: senkrecht = Regal wechseln (mit kurzer Sperre gegen Durchrauschen)
  let wheelLock = 0;
  root.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || Math.abs(event.deltaY) < 8) return;
    event.preventDefault();
    if (event.timeStamp < wheelLock) return;
    wheelLock = event.timeStamp + 450;
    setFocus(focus + (event.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setFocus(focus + (event.key === 'ArrowDown' ? 1 : -1));
    views[focus]?.crate.focusCenter();
  });

  const resizeObserver = new ResizeObserver(() => setFocus(focus, { animated: false, notify: false }));
  resizeObserver.observe(root);

  // ---------- Schnittstelle ----------

  return {
    el: root,

    /**
     * Zeilen setzen; bestehende Zeilen (gleiche ID) bleiben erhalten, samt Position.
     * @param {Row[]} rows
     * @param {string | null} focusId  gewünschte Zeile im Blick
     */
    setRows(rows, focusId) {
      const byId = new Map(views.map((v) => [v.row.id, v]));
      const focusIdBefore = views[focus]?.row.id ?? focusId;
      const next = rows.map((row) => {
        const view = byId.get(row.id) ?? createRow(row);
        byId.delete(row.id);
        fillRow(view, row);
        return view;
      });
      for (const old of byId.values()) {
        old.crate.destroy();
        old.el.remove();
      }
      views = next;
      rowsEl.replaceChildren(...views.map((v) => v.el));
      const wanted = views.findIndex((v) => v.row.id === (focusIdBefore ?? focusId));
      focus = wanted >= 0 ? wanted : 0;
      setFocus(focus, { animated: false, notify: false });
    },

    /** Hülle einer Platte (für die Rückflug-Animation) – zuerst in der Zeile im Blick. */
    findSleeve(/** @type {string} */ key) {
      const ordered = [views[focus], ...views.filter((_, i) => i !== focus)];
      for (const view of ordered) {
        const sleeve = view?.crate.findSleeve(key);
        if (sleeve) return sleeve;
      }
      return null;
    },

    focusedRowId: () => views[focus]?.row.id ?? null,

    destroy() {
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      for (const view of views) view.crate.destroy();
      root.remove();
    },
  };
}
