// CSV extraction: comma / semicolon / tab delimited, parsed in the browser.
//
// No dependency: the delimiter is detected from the header line and the
// fields follow the usual quoting rules (a quoted field may contain the
// delimiter and newlines; "" is a literal quote).

import { buildSheet, sheetsToText } from './sheet.js?v=4';

const DELIMITERS = [',', ';', '\t', '|'];

/**
 * Detects the delimiter by counting the candidates outside quotes on the
 * first non-empty line.
 *
 * @param {string} text
 * @returns {string}
 */
function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/).find((line) => line.trim() !== '') || '';
  let best = ',';
  let bestCount = 0;

  for (const delimiter of DELIMITERS) {
    let count = 0;
    let inQuotes = false;

    for (let i = 0; i < firstLine.length; i += 1) {
      const char = firstLine[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }

    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

/**
 * @param {string} text
 * @param {string} delimiter
 * @returns {Array<Array<string>>}
 */
function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Reads a CSV file as UTF-8 text and shapes it for the ingester.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function extractCsv(file) {
  const raw = String(await file.text() || '').replace(/^\uFEFF/, '');
  const rows = parseRows(raw, detectDelimiter(raw));

  if (!rows.length) {
    return '';
  }

  const [headers, ...body] = rows;
  const sheet = buildSheet(headers, body);

  return sheetsToText([{ name: file.name, ...sheet }]);
}
