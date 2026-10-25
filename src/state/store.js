// @ts-check
// Minimaler Zustandsspeicher: ein unveränderliches State-Objekt, Änderungen per
// set(), Benachrichtigung aller Abonnenten. Ein fehlerhafter Abonnent bringt die
// anderen nicht zu Fall.

/**
 * @template S
 * @typedef {Object} Store
 * @property {() => S} get
 * @property {(patch: Partial<S> | ((s: S) => Partial<S>)) => void} set
 * @property {(fn: (state: S, prev: S) => void) => () => void} subscribe
 */

/**
 * @template S
 * @param {S} initial
 * @returns {Store<S>}
 */
export function createStore(initial) {
  let state = initial;
  /** @type {Set<(state: S, prev: S) => void>} */
  const listeners = new Set();

  return {
    get: () => state,

    set(patch) {
      const prev = state;
      const delta = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...delta };
      for (const fn of listeners) {
        try {
          fn(state, prev);
        } catch (err) {
          console.error('[store] Abonnent fehlgeschlagen', err);
        }
      }
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
