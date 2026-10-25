// @ts-check
// Gemeinsame Schnittstelle der beiden Sammlungs-Ansichten (Regal, Stapel).

/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */

/**
 * Wird beim Antippen einer Platte aufgerufen.
 * @callback OpenHandler
 * @param {DisplayItem} item
 * @param {HTMLElement} sleeve   sichtbare Hülle (Startpunkt der Animation)
 * @param {HTMLElement} button   Element, das während der Animation ausgeblendet wird
 * @returns {void}
 */

/**
 * @typedef {Object} View
 * @property {HTMLElement} el
 * @property {(items: DisplayItem[], opts?: { anchorKey?: string | null }) => void} setItems
 * @property {() => string | null} getAnchorKey   Platte, die gerade „vorne" ist
 * @property {(key: string) => HTMLElement | null} findSleeve
 * @property {() => void} destroy
 */

export {};
