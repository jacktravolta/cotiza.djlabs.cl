// Client-side file type detection.
//
// This is a fast guard so we can reject unsupported files before doing any
// work. It is NOT a security boundary: the server re-validates the declared
// type and the real file content.

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TEXT_EXTENSIONS = new Set(['txt', 'md']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'webm']);
const CSV_EXTENSIONS = new Set(['csv']);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = 'application/msword';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';

/**
 * @typedef {'image'|'pdf'|'docx'|'text'|'doc'|'audio'|'csv'|'xlsx'|'xls'|'unknown'} DetectedType
 */

/**
 * @param {File} file
 * @returns {{ type: DetectedType, mime: string, ext: string }}
 */
export function detectType(file) {
  const name = String((file && file.name) || '').toLowerCase();
  const mime = String((file && file.type) || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';

  // Legacy .doc is explicitly rejected: OLE2 binary, no browser parser.
  if (mime === DOC_MIME || ext === 'doc') {
    return { type: 'doc', mime, ext };
  }

  if (mime === 'application/pdf' || ext === 'pdf') {
    return { type: 'pdf', mime, ext };
  }

  if (mime === DOCX_MIME || ext === 'docx') {
    return { type: 'docx', mime, ext };
  }

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return { type: 'image', mime, ext };
  }

  // Spreadsheets: CSV (plain text) and Excel .xlsx (SpreadsheetML). Legacy
  // .xls is binary (OLE2) with no browser parser: it gets its own answer.
  // Checked BEFORE the text branch: a CSV arrives as text/csv and must be
  // parsed as a table, not shipped raw.
  if (mime === 'text/csv' || mime === 'application/csv' || CSV_EXTENSIONS.has(ext)) {
    return { type: 'csv', mime, ext };
  }

  if (mime === XLSX_MIME || ext === 'xlsx') {
    return { type: 'xlsx', mime, ext };
  }

  if (mime === XLS_MIME || ext === 'xls') {
    return { type: 'xls', mime, ext };
  }

  if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
    return { type: 'text', mime, ext };
  }

  // Audio files: mp3, wav, ogg, m4a, flac, webm
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
    return { type: 'audio', mime, ext };
  }

  return { type: 'unknown', mime, ext };
}