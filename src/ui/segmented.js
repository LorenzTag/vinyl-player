// @ts-check
// Segment-Schalter für die Tabs (role="tablist") und den Layout-Umschalter
// (role="radiogroup"). Die Markierung gleitet per transform zum aktiven Segment.
// Pfeiltasten wechseln das Segment (Tastatur am iPad / Mac).

import { h, svg } from './dom.js';

/**
 * @template {string} V
 * @typedef {Object} SegmentOption
 * @property {V} value
 * @property {string} label
 * @property {string} [icon]   SVG-Markup aus eigenen Konstanten
 */

/**
 * @template {string} V
 * @param {{
 *   className: string,
 *   role: 'tablist' | 'radiogroup',
 *   label: string,
 *   idPrefix: string,
 *   options: SegmentOption<V>[],
 *   value: V,
 *   onChange: (value: V) => void,
 * }} config
 */
export function createSegmented({ className, role, label, idPrefix, options, value, onChange }) {
  const itemRole = role === 'tablist' ? 'tab' : 'radio';
  const stateAttr = role === 'tablist' ? 'aria-selected' : 'aria-checked';

  const thumb = h('span', { class: 'segmented__thumb', 'aria-hidden': 'true' });
  const buttons = options.map((opt) => {
    const button = h('button', {
      type: 'button',
      class: 'segmented__item',
      role: itemRole,
      id: `${idPrefix}-${opt.value}`,
      dataset: { value: opt.value },
    });
    if (opt.icon) button.append(svg(opt.icon));
    button.append(h('span', {}, opt.label));
    return button;
  });

  const el = h('div', {
    class: `segmented ${className}`,
    role,
    'aria-label': label,
    style: { '--count': options.length, '--index': 0 },
  }, thumb, ...buttons);

  /** @type {V} */
  let current = value;

  /** @param {V} next */
  function setValue(next) {
    current = next;
    const index = Math.max(0, options.findIndex((o) => o.value === next));
    el.style.setProperty('--index', String(index));
    buttons.forEach((button, i) => {
      button.setAttribute(stateAttr, String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
  }

  el.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.segmented__item'));
    if (!button) return;
    const next = /** @type {V} */ (button.dataset.value);
    if (next !== current) onChange(next);
  });

  el.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = options.findIndex((o) => o.value === current);
    const nextIndex = (index + step + options.length) % options.length;
    onChange(options[nextIndex].value);
    buttons[nextIndex].focus();
  });

  setValue(value);
  return { el, setValue, idFor: (/** @type {V} */ v) => `${idPrefix}-${v}` };
}
