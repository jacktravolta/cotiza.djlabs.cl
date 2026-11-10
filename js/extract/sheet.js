// Spreadsheet shaping: rows -> JSON -> the text the ingester stores.
//
// The server never sees the file (see api.js): the browser reads the
// spreadsheet, shapes it as JSON ({ headers, rows }) and renders a compact
// table. That table is what the RAG indexes, so every value keeps the label
// it belongs to (a price without its "PRECIO" header is useless to the
// brain, and a bare list of numbers invents context).

/**
 * @typedef {{ headers: string[], rows: string[][] }} Sheet
 * @typedef {{ name?: string, headers: string[], rows: string[][] }} NamedSheet
 */

/**
 * Normalizes a parsed sheet into { headers, rows }.
 *
 * Empty headers get a positional name ("Columna 3") so no value loses its
 * column, and fully empty rows are dropped.
 *
 * @param {Array<Array<string>>} headers
 * @param {Array<Array<string>>} rows
 * @returns {Sheet}
 */
export function buildSheet(headers, rows) {
  const safeHeaders = (headers || []).map((header, index) => {
    const text = String(header == null ? '' : header).trim();
    return text === '' ? `Columna ${index + 1}` : text;
  });

  const width = Math.max(safeHeaders.length, 1);
  const safeRows = (rows || [])
    .map((row) => {
      const cells = [];
      for (let i = 0; i < width; i += 1) {
        cells.push(String(row && row[i] != null ? row[i] : '').trim());
      }
      return cells;
    })
    .filter((cells) => cells.some((cell) => cell !== ''));

  return { headers: safeHeaders, rows: safeRows };
}

/**
 * Renders the sheets as the plain text the ingester stores.
 *
 * Format (one line per row, labels above):
 *   [catalogo-productos.csv]
 *   PRODUCTO | PRECIO | STOCK
 *   Jaula canastilla pickup | 185000 | 12
 *
 * @param {NamedSheet[]} sheets
 * @returns {string}
 */
export function sheetsToText(sheets) {
  const blocks = [];

  for (const sheet of sheets || []) {
    const lines = [];

    if (sheet.name) {
      lines.push(`[${sheet.name}]`);
    }
    if (sheet.headers && sheet.headers.length) {
      lines.push(sheet.headers.join(' | '));
    }
    for (const row of sheet.rows || []) {
      lines.push(row.join(' | '));
    }

    if (lines.length) {
      blocks.push(lines.join('\n'));
    }
  }

  return blocks.join('\n\n');
}
