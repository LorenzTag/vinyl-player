// @ts-check
// Kleiner Helfer zum Erzeugen von DOM-Elementen. Texte landen immer als
// Textknoten im DOM (nie als HTML) – Titel aus Spotify sind damit ungefährlich.

/**
 * @typedef {Record<string, unknown> & {
 *   class?: string,
 *   style?: Record<string, string | number>,
 *   dataset?: Record<string, string>,
 * }} Props
 */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Props} [props]
 * @param {...(Node | string | number | null | undefined | false)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') {
      el.className = String(value);
    } else if (key === 'style') {
      for (const [prop, v] of Object.entries(/** @type {Record<string, string | number>} */ (value))) {
        el.style.setProperty(prop, String(v));
      }
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), /** @type {EventListener} */ (value));
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/**
 * SVG-Markup aus eigenen Konstanten (nie aus Fremddaten!) in ein Element setzen.
 * @param {string} markup
 * @returns {DocumentFragment}
 */
export function svg(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content;
}

/**
 * @param {number} value @param {number} min @param {number} max
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
