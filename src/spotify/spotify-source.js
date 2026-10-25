// @ts-check
// Spotify-Datenquelle: übersetzt Antworten der Web API in die eigenen Typen
// (RecordItem, Track). UI und Zustand bleiben davon unberührt.
//
// Stand der API (Entwicklermodus, seit Feb./März 2026):
// - Playlist-Inhalte heißen „items" statt „tracks", Einträge „item" statt „track"
//   (beides wird gelesen, solange Spotify noch beides liefert).
// - Titellisten gibt es nur für eigene/gemeinsame Playlists. Bei fremden fehlt
//   das Feld bzw. Spotify antwortet 403 – Abspielen geht trotzdem.

import { SourceError } from '../data/errors.js';

/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {import('../data/types.js').RecentItem} RecentItem */
/** @typedef {import('../data/types.js').Track} Track */
/** @typedef {import('../data/types.js').LibrarySource} LibrarySource */
/** @typedef {import('./api.js').SpotifyApi} SpotifyApi */

const MAX_RECENT_PLAYLIST_LOOKUPS = 10;

/**
 * Passendes Cover wählen: möglichst ~640 px (scharf auf dem iPad), sonst das größte.
 * @param {Array<{ url: string, width?: number | null }> | null | undefined} images
 */
function pickImage(images) {
  if (!images?.length) return null;
  const sized = images.filter((i) => i.width);
  const fit = sized.filter((i) => /** @type {number} */ (i.width) <= 700).sort((a, b) => /** @type {number} */ (b.width) - /** @type {number} */ (a.width))[0];
  return (fit ?? images[0]).url;
}

/** @param {any} p  Spotify-Playlist-Objekt @returns {RecordItem} */
export function mapPlaylist(p) {
  return {
    id: p.id,
    uri: p.uri ?? `spotify:playlist:${p.id}`,
    kind: 'playlist',
    title: p.name || 'Ohne Titel',
    subtitle: p.owner?.display_name ?? p.owner?.id ?? '',
    trackCount: p.items?.total ?? p.tracks?.total ?? 0,
    year: null,
    imageUrl: pickImage(p.images),
  };
}

/** @param {any} a  Spotify-Album-Objekt @returns {RecordItem} */
export function mapAlbum(a) {
  const year = Number(String(a.release_date ?? '').slice(0, 4));
  return {
    id: a.id,
    uri: a.uri ?? `spotify:album:${a.id}`,
    kind: 'album',
    title: a.name || 'Ohne Titel',
    subtitle: (a.artists ?? []).map((x) => x.name).join(', '),
    trackCount: a.total_tracks ?? a.tracks?.total ?? 0,
    year: Number.isFinite(year) && year > 0 ? year : null,
    imageUrl: pickImage(a.images),
  };
}

/** @param {any} t  Spotify-Track-Objekt @returns {Track | null} */
export function mapTrack(t) {
  if (!t || t.type !== 'track' || t.is_local || !t.uri) return null;
  return {
    id: t.id ?? t.uri,
    uri: t.uri,
    title: t.name || 'Ohne Titel',
    artists: (t.artists ?? []).map((x) => x.name).join(', '),
    durationMs: t.duration_ms ?? 0,
    imageUrl: pickImage(t.album?.images),
  };
}

/** "spotify:playlist:abc" → { kind: 'playlist', id: 'abc' } */
function parseUri(uri) {
  const [, kind, id] = String(uri).split(':');
  return { kind, id };
}

/**
 * @param {SpotifyApi} api
 * @returns {LibrarySource}
 */
export function createSpotifySource(api) {
  /** Bekannte Platten (aus den Listen) – spart Nachschlagen bei „Zuletzt gehört" */
  /** @type {Map<string, RecordItem>} */
  const known = new Map();
  const remember = (/** @type {RecordItem[]} */ records) => {
    for (const r of records) known.set(r.uri, r);
    return records;
  };

  /**
   * Metadaten einer Platte per URI holen (für Kontexte, die nicht in den Listen stehen).
   * @param {string} uri
   * @param {AbortSignal} [signal]
   * @returns {Promise<RecordItem | null>}
   */
  async function getRecord(uri, signal) {
    const cached = known.get(uri);
    if (cached) return cached;
    const { kind, id } = parseUri(uri);
    if (!id || (kind !== 'album' && kind !== 'playlist')) return null;
    try {
      const body = await api.request('GET', `/${kind}s/${id}`, { signal });
      const record = kind === 'album' ? mapAlbum(body) : mapPlaylist(body);
      known.set(uri, record);
      return record;
    } catch (err) {
      if (err instanceof SourceError && (err.kind === 'not-found' || err.kind === 'forbidden')) return null;
      throw err;
    }
  }

  return {
    name: 'spotify',

    async getPlaylists(opts) {
      const items = await api.getAll('/me/playlists', { query: { limit: 50 }, max: 500, signal: opts?.signal });
      return remember(items.filter(Boolean).map(mapPlaylist));
    },

    async getAlbums(opts) {
      const items = await api.getAll('/me/albums', { query: { limit: 50 }, max: 500, signal: opts?.signal });
      return remember(items.map((x) => x?.album).filter(Boolean).map(mapAlbum));
    },

    async getRecentlyPlayed(opts) {
      const page = await api.request('GET', '/me/player/recently-played', { query: { limit: 50 }, signal: opts?.signal });
      /** @type {Map<string, { playedAt: string, album: any }>} */
      const contexts = new Map();
      for (const entry of page?.items ?? []) {
        const uri = entry?.context?.uri;
        const { kind } = parseUri(uri);
        if (!uri || contexts.has(uri) || (kind !== 'album' && kind !== 'playlist')) continue;
        contexts.set(uri, { playedAt: entry.played_at, album: entry.track?.album });
      }

      /** @type {RecentItem[]} */
      const result = [];
      let lookups = 0;
      for (const [uri, info] of contexts) {
        let record = known.get(uri) ?? null;
        if (!record && parseUri(uri).kind === 'album' && info.album) record = mapAlbum(info.album);
        if (!record && lookups < MAX_RECENT_PLAYLIST_LOOKUPS) {
          lookups++;
          record = await getRecord(uri, opts?.signal).catch(() => null);
        }
        if (record) result.push({ record, playedAt: info.playedAt });
      }
      return result;
    },

    async getTracks(record, opts) {
      const { kind, id } = parseUri(record.uri);
      if (kind === 'album') {
        const items = await api.getAll(`/albums/${id}/tracks`, { query: { limit: 50 }, max: 1000, signal: opts?.signal });
        // Album-Tracks sind „simplified" (ohne album) – Cover kommt vom Album selbst.
        return items
          .map((t) => mapTrack({ ...t, type: t.type ?? 'track' }))
          .filter((t) => t !== null)
          .map((t) => ({ ...t, imageUrl: record.imageUrl }));
      }
      try {
        const entries = await api.getAll(`/playlists/${id}/items`, {
          query: { limit: 50, additional_types: 'track' },
          max: 2000,
          signal: opts?.signal,
        });
        return entries.map((e) => mapTrack(e?.item ?? e?.track)).filter((t) => t !== null);
      } catch (err) {
        if (err instanceof SourceError && (err.kind === 'forbidden' || err.kind === 'not-found')) {
          throw new SourceError('forbidden', {
            message: 'Spotify zeigt Titellisten nur für eigene Playlists. Abspielen geht trotzdem.',
            cause: err,
          });
        }
        throw err;
      }
    },

    async getRecord(uri, opts) {
      return getRecord(uri, opts?.signal);
    },
  };
}
