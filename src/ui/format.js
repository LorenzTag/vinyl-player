// @ts-check
// Texte für Etiketten und Bildunterschriften.

/** @typedef {import('../data/types.js').RecordItem} RecordItem */
/** @typedef {import('../state/app-state.js').DisplayItem} DisplayItem */

const relative = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

/**
 * „vor 12 Minuten", „gestern", „vor 3 Tagen"
 * @param {string} iso
 * @param {number} [now]
 */
export function relativeTime(iso, now = Date.now()) {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (Math.abs(minutes) < 1) return 'gerade eben';
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}

/** @param {RecordItem} record */
export function kindLabel(record) {
  return record.kind === 'album' ? 'Album' : 'Playlist';
}

/**
 * Kurze Zusatzzeile: „Album · 1978", „Playlist · 34 Titel", „Album · vor 2 Stunden"
 * @param {DisplayItem} item
 */
export function metaLine(item) {
  const { record } = item;
  if (item.playedAt) return `${kindLabel(record)} · ${relativeTime(item.playedAt)}`;
  if (record.kind === 'album') return record.year ? `Album · ${record.year}` : 'Album';
  return `Playlist · ${record.trackCount} Titel`;
}

/** @param {RecordItem} record */
export function accessibleName(record) {
  return `${record.title} – ${record.subtitle} (${kindLabel(record)})`;
}
