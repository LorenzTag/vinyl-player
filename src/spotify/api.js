// @ts-check
// Zentrale HTTP-Schicht für die Spotify Web API. Jede Anfrage läuft hier durch:
//
// - Timeout für jede Anfrage
// - 401 → Token einmal erneuern, Anfrage wiederholen
// - 429 → Wartezeit aus Retry-After einhalten (begrenzt), sonst Fehler
// - Netzfehler/5xx → mit wachsender Pause wiederholen – NUR bei Leseanfragen.
//   Befehle wie „Weiter" werden nie blind wiederholt (sonst würde doppelt
//   gesprungen, falls der erste Versuch doch angekommen ist).
// - Fehler kommen immer als SourceError mit verständlicher Meldung.

import { SourceError } from '../data/errors.js';

/** @typedef {import('./auth.js').SpotifyAuth} SpotifyAuth */

const BASE = 'https://api.spotify.com/v1';
const TIMEOUT_MS = 12_000;
const READ_RETRIES_MS = [600, 1800];
const MAX_RATE_LIMIT_WAIT_MS = 20_000;

/**
 * @typedef {Object} RequestOptions
 * @property {Record<string, string | number | undefined>} [query]
 * @property {unknown} [body]
 * @property {AbortSignal} [signal]
 */

/**
 * Zwei Abbruch-Signale verbinden (AbortSignal.any gibt es erst ab iPadOS 17.4).
 * @param {AbortSignal | undefined} a
 * @param {AbortSignal} b
 */
function anySignal(a, b) {
  if (!a) return b;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const controller = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/** @param {number} ms @param {AbortSignal | undefined} signal */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/**
 * HTTP-Fehler in einen SourceError übersetzen (Spotify liefert `error.reason`).
 * @param {Response} response
 * @param {string} path
 */
async function toError(response, path) {
  const body = await response.json().catch(() => null);
  const reason = body?.error?.reason ?? '';
  const message = String(body?.error?.message ?? '');
  if (reason === 'NO_ACTIVE_DEVICE' || (response.status === 404 && path.startsWith('/me/player'))) {
    return new SourceError('no-device', { cause: body });
  }
  if (reason === 'PREMIUM_REQUIRED') return new SourceError('premium-required', { cause: body });
  if (response.status === 401) return new SourceError('auth', { cause: body });
  if (response.status === 403) {
    const notRegistered = /not registered|user may not be registered/i.test(message);
    return new SourceError('forbidden', {
      message: notRegistered
        ? 'Dein Spotify-Konto ist in der App nicht freigeschaltet (Dashboard → User Management).'
        : 'Spotify verweigert den Zugriff auf diese Daten.',
      cause: body,
    });
  }
  if (response.status === 404) return new SourceError('not-found', { cause: body });
  if (response.status === 429) {
    return new SourceError('rate-limit', {
      message: reason === 'QUOTA_EXCEEDED' ? 'Spotify-Kontingent für heute aufgebraucht.' : undefined,
      cause: body,
    });
  }
  return new SourceError('unknown', { message: `Spotify-Fehler ${response.status}.`, cause: body });
}

/**
 * @param {SpotifyAuth} auth
 */
export function createApi(auth) {
  /**
   * @param {'GET' | 'PUT' | 'POST' | 'DELETE'} method
   * @param {string} pathOrUrl  "/me/player" oder eine vollständige `next`-URL von Spotify
   * @param {RequestOptions} [opts]
   * @returns {Promise<any>}  JSON-Antwort oder null (204 / leerer Body)
   */
  async function request(method, pathOrUrl, { query, body, signal } = {}) {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const path = url.pathname.replace(/^\/v1/, '');
    const isRead = method === 'GET';
    let refreshed = false;
    let rateLimited = 0;

    for (let attempt = 0; ; attempt++) {
      const token = await auth.getAccessToken();
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const combined = anySignal(signal, timeout);

      /** @type {Response} */
      let response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: combined,
        });
      } catch (err) {
        if (signal?.aborted) throw err; // vom Aufrufer abgebrochen
        const kind = timeout.aborted ? 'timeout' : 'network';
        if (isRead && attempt < READ_RETRIES_MS.length) {
          await sleep(READ_RETRIES_MS[attempt], signal);
          continue;
        }
        throw new SourceError(kind, { cause: err });
      }

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await auth.getAccessToken({ forceRefresh: true });
        continue;
      }

      if (response.status === 429) {
        const waitMs = (Number(response.headers.get('Retry-After')) || 2) * 1000;
        if (waitMs <= MAX_RATE_LIMIT_WAIT_MS && rateLimited < 2) {
          rateLimited++;
          await sleep(waitMs, signal);
          continue;
        }
        const error = await toError(response, path);
        error.retryAfterMs = waitMs;
        throw error;
      }

      if (response.status >= 500 && isRead && attempt < READ_RETRIES_MS.length) {
        await sleep(READ_RETRIES_MS[attempt], signal);
        continue;
      }

      if (!response.ok) throw await toError(response, path);
      if (response.status === 204) return null;
      const text = await response.text().catch(() => '');
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch (err) {
        // Spotify beantwortet Befehle (Weiter, Zurück, Pause …) teils mit 200 und
        // einem Text, der kein JSON ist. Der Befehl hat trotzdem geklappt.
        if (!isRead) return null;
        throw new SourceError('unknown', { message: 'Spotify hat unerwartet geantwortet.', cause: err });
      }
    }
  }

  /**
   * Alle Seiten einer Spotify-Liste laden (folgt `next`).
   * @param {string} path
   * @param {{ query?: Record<string, string | number | undefined>, max?: number, signal?: AbortSignal }} [opts]
   * @returns {Promise<any[]>}
   */
  async function getAll(path, { query, max = 1000, signal } = {}) {
    /** @type {any[]} */
    const items = [];
    /** @type {string | null} */
    let next = path;
    let first = true;
    while (next && items.length < max) {
      const page = await request('GET', next, { query: first ? query : undefined, signal });
      first = false;
      items.push(...(page?.items ?? []));
      next = page?.next ?? null;
    }
    return items.slice(0, max);
  }

  return { request, getAll };
}

/** @typedef {ReturnType<typeof createApi>} SpotifyApi */
