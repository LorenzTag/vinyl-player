// @ts-check
// Vorschlag A: Plattenregal. Reihen mit Holzbrett, Hüllen frontal, Papier-Etiketten.
// Spaltenzahl folgt der Breite (Hochformat 3, Querformat 4–5).

import { h } from './dom.js';
import { createCover, jitter } from './cover-art.js';
import { accessibleName, metaLine } from './format.js';

/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */
/** @typedef {import('./view-types.js').View} View */
/** @typedef {import('./view-types.js').OpenHandler} OpenHandler */

/** @param {number} width */
function columnsFor(width) {
  if (width < 520) return 2;
  if (width < 940) return 3;
  if (width < 1300) return 4;
  if (width < 1700) return 5;
  return 6;
}

/**
 * @param {{ onOpen: OpenHandler }} handlers
 * @returns {View}
 */
export function createShelfView({ onOpen }) {
  const cabinet = h('div', { class: 'shelf__cabinet tex-wall' });
  const root = h('div', { class: 'view shelf' }, cabinet);

  /** @type {DisplayItem[]} */
  let items = [];
  /** @type {Map<string, DisplayItem>} */
  let byKey = new Map();
  let columns = 0;

  /**
   * @param {DisplayItem} item
   * @param {number} index
   * @param {number} column
   */
  function renderItem(item, index, column) {
    const { record } = item;
    return h('button', {
      type: 'button',
      class: 'shelf-item',
      'aria-label': accessibleName(record),
      dataset: { key: item.key },
      style: {
        'grid-column': column + 1,
        '--i': index,
        '--tilt': `${(jitter(record, 0x51) * 1.1).toFixed(2)}deg`,
        '--label-tilt': `${(jitter(record, 0xa7) * 0.9).toFixed(2)}deg`,
      },
    },
      h('div', { class: 'shelf-item__stand' },
        h('div', { class: 'shelf-item__sleeve' }, createCover(record)),
      ),
      h('div', { class: 'shelf-item__label tex-paper', 'aria-hidden': 'true' },
        h('div', { class: 'shelf-item__title' }, record.title),
        h('div', { class: 'shelf-item__subtitle' }, record.subtitle),
        h('div', { class: 'shelf-item__meta' }, metaLine(item)),
      ),
    );
  }

  /** @param {boolean} animate */
  function render(animate) {
    if (!columns) return;
    const rows = [];
    for (let start = 0; start < items.length; start += columns) {
      const slice = items.slice(start, start + columns);
      rows.push(h('div', { class: 'shelf__row', style: { '--cols': columns } },
        h('div', { class: 'shelf__board tex-board', 'aria-hidden': 'true' }),
        ...slice.map((item, i) => renderItem(item, start + i, i)),
      ));
    }
    cabinet.classList.toggle('no-enter', !animate);
    cabinet.replaceChildren(...rows);
  }

  // Spaltenzahl an die Breite anpassen (Drehen, Split View).
  const resizeObserver = new ResizeObserver((entries) => {
    const width = entries[entries.length - 1].contentRect.width;
    const next = columnsFor(width);
    if (next === columns || width === 0) return;
    const anchor = getAnchorKey();
    columns = next;
    render(false);
    if (anchor) scrollToKey(anchor);
  });
  resizeObserver.observe(root);

  cabinet.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.shelf-item'));
    const item = button && byKey.get(button.dataset.key ?? '');
    if (!button || !item) return;
    const sleeve = /** @type {HTMLElement} */ (button.querySelector('.shelf-item__sleeve'));
    onOpen(item, sleeve, button);
  });

  /** Oberste (teilweise) sichtbare Platte – für Wechsel zwischen Tabs/Layouts. */
  function getAnchorKey() {
    const top = root.getBoundingClientRect().top;
    for (const button of cabinet.querySelectorAll('.shelf-item')) {
      if (button.getBoundingClientRect().bottom > top + 40) return /** @type {HTMLElement} */ (button).dataset.key ?? null;
    }
    return null;
  }

  /** @param {string} key */
  function scrollToKey(key) {
    const button = cabinet.querySelector(`.shelf-item[data-key="${CSS.escape(key)}"]`);
    if (!button) return;
    const row = /** @type {HTMLElement} */ (button.closest('.shelf__row'));
    root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - 20;
  }

  return {
    el: root,

    setItems(next, { anchorKey } = {}) {
      items = next;
      byKey = new Map(next.map((item) => [item.key, item]));
      if (!columns) columns = columnsFor(root.clientWidth || window.innerWidth);
      render(true);
      root.scrollTop = 0;
      if (anchorKey) scrollToKey(anchorKey);
    },

    getAnchorKey,

    findSleeve(key) {
      return /** @type {HTMLElement | null} */ (
        cabinet.querySelector(`.shelf-item[data-key="${CSS.escape(key)}"] .shelf-item__sleeve`)
      );
    },

    destroy() {
      resizeObserver.disconnect();
      root.remove();
    },
  };
}
