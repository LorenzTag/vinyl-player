// @ts-check
// Spotify-Login per Authorization Code Flow mit PKCE (ohne Client Secret).
//
// - Der Code-Verifier liegt nur kurz im localStorage (überlebt den Sprung zu
//   Spotify und zurück, auch in der Homescreen-App), danach wird er gelöscht.
// - Access-Token wird automatisch erneuert: kurz vor Ablauf und bei 401.
//   Mehrere gleichzeitige Anfragen lösen nur EINE Erneuerung aus.
// - Ist die Erneuerung endgültig gescheitert (Token widerrufen), gilt man als
//   abgemeldet und bekommt einen SourceError('auth').

import { SourceError } from '../data/errors.js';

const ACCOUNTS = 'https://accounts.spotify.com';
const TOKEN_KEY = 'vinyl-player:spotify-token:v1';
const PKCE_KEY = 'vinyl-player:spotify-pkce:v1';
const PKCE_MAX_AGE_MS = 15 * 60_000;
const REFRESH_EARLY_MS = 60_000;     // so lange vor Ablauf erneuern
const TIMEOUT_MS = 12_000;

/**
 * @typedef {Object} TokenSet
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {number} expiresAt   Date.now()-Zeitpunkt des Ablaufs
 * @property {string} scope
 */

/** @param {Uint8Array} bytes */
function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength = 48) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** Kann dieser Browser-Kontext überhaupt PKCE (braucht HTTPS oder 127.0.0.1)? */
export function canLogin() {
  return window.isSecureContext && !!globalThis.crypto?.subtle;
}

/**
 * @param {string} key
 * @returns {any}
 */
function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** @param {string} key @param {unknown} value */
function writeJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Speicher nicht verfügbar (privater Modus): Login gilt nur für diese Sitzung.
  }
}

/**
 * @param {{ clientId: string, redirectUri: string, scopes: string[] }} config
 */
export function createAuth({ clientId, redirectUri, scopes }) {
  /** @type {TokenSet | null} */
  let tokens = readJson(TOKEN_KEY);
  /** @type {Promise<string> | null} */
  let refreshing = null;
  /** @type {Set<() => void>} */
  const logoutListeners = new Set();

  /** @param {TokenSet | null} next */
  function saveTokens(next) {
    tokens = next;
    writeJson(TOKEN_KEY, next);
  }

  /**
   * POST an den Token-Endpunkt.
   * @param {Record<string, string>} params
   */
  async function tokenRequest(params) {
    let response;
    try {
      response = await fetch(`${ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, ...params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new SourceError(err instanceof DOMException && err.name === 'TimeoutError' ? 'timeout' : 'network', { cause: err });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // invalid_grant = Code/Refresh-Token ungültig → neu anmelden
      const kind = response.status >= 500 ? 'unknown' : 'auth';
      throw new SourceError(kind, {
        message: kind === 'auth' ? 'Bitte erneut bei Spotify anmelden.' : `Spotify-Anmeldung gestört (${response.status}).`,
        cause: body,
      });
    }
    return body;
  }

  /** @param {any} body @param {TokenSet | null} previous */
  function toTokenSet(body, previous) {
    return {
      accessToken: body.access_token,
      // Spotify liefert nicht immer ein neues Refresh-Token – dann das alte behalten.
      refreshToken: body.refresh_token ?? previous?.refreshToken ?? '',
      expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
      scope: body.scope ?? previous?.scope ?? '',
    };
  }

  async function refresh() {
    if (!tokens?.refreshToken) throw new SourceError('auth');
    try {
      const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      saveTokens(toTokenSet(body, tokens));
      return /** @type {TokenSet} */ (tokens).accessToken;
    } catch (err) {
      // Nur bei echter Ablehnung abmelden – bei Netzproblemen Tokens behalten.
      if (err instanceof SourceError && err.kind === 'auth') logout();
      throw err;
    }
  }

  function logout() {
    saveTokens(null);
    for (const fn of logoutListeners) fn();
  }

  return {
    isLoggedIn: () => !!tokens?.refreshToken,

    /** Zur Spotify-Anmeldeseite wechseln. */
    async login() {
      if (!clientId) throw new SourceError('auth', { message: 'Die Spotify Client ID fehlt (src/config.js).' });
      if (!canLogin()) {
        throw new SourceError('auth', { message: 'Anmelden geht nur über HTTPS oder http://127.0.0.1.' });
      }
      const verifier = randomString(64);
      const state = randomString(16);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      writeJson(PKCE_KEY, { verifier, state, redirectUri, createdAt: Date.now() });
      const url = new URL(`${ACCOUNTS}/authorize`);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: scopes.join(' '),
        redirect_uri: redirectUri,
        code_challenge_method: 'S256',
        code_challenge: base64url(new Uint8Array(digest)),
        state,
      }).toString();
      window.location.assign(url.toString());
    },

    /**
     * Nach der Rückkehr von Spotify: Code gegen Tokens tauschen und die
     * Adresszeile aufräumen. Gibt null zurück, wenn es keine Rückkehr war.
     * @returns {Promise<null | { ok: true } | { ok: false, message: string }>}
     */
    async handleRedirect() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error');
      if (!code && !error) return null;

      const pending = readJson(PKCE_KEY);
      writeJson(PKCE_KEY, null);
      window.history.replaceState(null, '', redirectUri);

      if (error) {
        return { ok: false, message: error === 'access_denied' ? 'Anmeldung abgebrochen.' : `Spotify meldet: ${error}` };
      }
      if (!pending || pending.state !== params.get('state') || Date.now() - pending.createdAt > PKCE_MAX_AGE_MS) {
        return { ok: false, message: 'Die Anmeldung ist abgelaufen. Bitte noch einmal versuchen.' };
      }
      try {
        const body = await tokenRequest({
          grant_type: 'authorization_code',
          code: /** @type {string} */ (code),
          redirect_uri: pending.redirectUri,
          code_verifier: pending.verifier,
        });
        saveTokens(toTokenSet(body, null));
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.' };
      }
    },

    /**
     * Gültiges Access-Token – erneuert es bei Bedarf (nur eine Erneuerung gleichzeitig).
     * @param {{ forceRefresh?: boolean }} [opts]
     * @returns {Promise<string>}
     */
    async getAccessToken({ forceRefresh = false } = {}) {
      if (!tokens) throw new SourceError('auth');
      const fresh = tokens.expiresAt - REFRESH_EARLY_MS > Date.now();
      if (fresh && !forceRefresh) return tokens.accessToken;
      refreshing ??= refresh().finally(() => { refreshing = null; });
      return refreshing;
    },

    logout,

    /** @param {() => void} fn */
    onLogout(fn) {
      logoutListeners.add(fn);
      return () => logoutListeners.delete(fn);
    },
  };
}

/** @typedef {ReturnType<typeof createAuth>} SpotifyAuth */
