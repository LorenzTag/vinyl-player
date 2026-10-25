// @ts-check
// Einheitliche Fehler aller Datenquellen. Die UI entscheidet nur anhand von
// `kind` und `retryable`, was sie anzeigt – nie anhand von HTTP-Details.

/**
 * @typedef {'network' | 'timeout' | 'auth' | 'rate-limit' | 'no-device' | 'premium-required' | 'forbidden' | 'not-found' | 'unknown'} SourceErrorKind
 */

/** @type {Record<SourceErrorKind, string>} */
const MESSAGES = {
  network: 'Keine Verbindung. Bitte WLAN prüfen.',
  timeout: 'Spotify antwortet gerade nicht.',
  auth: 'Bitte erneut bei Spotify anmelden.',
  'rate-limit': 'Zu viele Anfragen – kurz warten.',
  'no-device': 'Spotify ist auf diesem Gerät nicht bereit. Öffne kurz die Spotify-App.',
  'premium-required': 'Die Steuerung erfordert Spotify Premium.',
  forbidden: 'Spotify verweigert den Zugriff.',
  'not-found': 'Bei Spotify nicht gefunden.',
  unknown: 'Da ist etwas schiefgegangen.',
};

export class SourceError extends Error {
  /**
   * @param {SourceErrorKind} kind
   * @param {{ message?: string, retryAfterMs?: number, cause?: unknown }} [details]
   */
  constructor(kind, details = {}) {
    super(details.message ?? MESSAGES[kind], { cause: details.cause });
    this.name = 'SourceError';
    /** @type {SourceErrorKind} */
    this.kind = kind;
    /** Wartezeit laut Server (429 Retry-After), sonst null. */
    this.retryAfterMs = details.retryAfterMs ?? null;
  }

  /** Lohnt sich ein erneuter Versuch ohne Zutun des Nutzers? */
  get retryable() {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'rate-limit';
  }
}

/**
 * Beliebigen Fehler in einen SourceError übersetzen.
 * @param {unknown} err
 * @returns {SourceError}
 */
export function toSourceError(err) {
  if (err instanceof SourceError) return err;
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new SourceError('timeout', { cause: err });
  }
  if (err instanceof TypeError) {
    // fetch() wirft TypeError bei Netzwerkfehlern.
    return new SourceError('network', { cause: err });
  }
  // Unerwartete Fehler mit Namen melden – hilft beim Nachvollziehen auf dem iPad.
  const name = err instanceof Error ? err.name : typeof err;
  console.error('[unerwarteter Fehler]', err);
  return new SourceError('unknown', { message: `Da ist etwas schiefgegangen (${name}).`, cause: err });
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbortError(err) {
  return err instanceof DOMException && err.name === 'AbortError';
}
