// XLSX extraction (SpreadsheetML) in the browser, without dependencies.
//
// An .xlsx file is a ZIP archive with XML parts. We read the ZIP central
// directory, inflate the parts we need with the platform's
// DecompressionStream ('deflate-raw') and parse the XML with DOMParser.
// Everything stays in the browser: the server only receives the resulting
// text (same contract as PDF/DOCX).

import { buildSheet, sheetsToText } from './sheet.js?v=4';

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * @typedef {{ name: string, headers: string[], rows: string[][] }} Sheet
 */

/**
 * Finds the End Of Central Directory record (scanning backwards, the
 * comment at the end of the file may push it away).
 *
 * @param {DataView} view
 * @returns {number} offset or -1
 */
function findCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);

  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }

  return -1;
}

/**
 * Lists the entries of the ZIP archive.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Map<string, { method: number, offset: number, compressedSize: number }>}
 */
function readZipEntries(buffer) {
  const view = new DataView(buffer);
  const eocd = findCentralDirectory(view);

  if (eocd < 0) {
    throw new Error('No pudimos leer el archivo Excel: parece que está incompleto o dañado.');
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = new Map();

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_SIGNATURE) {
      break;
    }

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, cursor + 46, nameLength));

    entries.set(name, { method, offset: localOffset, compressedSize });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Reads one entry of the ZIP archive and returns its bytes.
 *
 * @param {ArrayBuffer} buffer
 * @param {{ method: number, offset: number }} entry
 * @returns {Promise<Uint8Array>}
 */
async function readZipEntry(buffer, entry) {
  const view = new DataView(buffer);

  if (view.getUint32(entry.offset, true) !== ZIP_LOCAL_SIGNATURE) {
    throw new Error('No pudimos leer el archivo Excel: su estructura no es la esperada.');
  }

  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const dataStart = entry.offset + 30 + nameLength + extraLength;
  const raw = new Uint8Array(buffer, dataStart, entry.compressedSize);

  if (entry.method === 0) {
    return raw;
  }

  if (entry.method !== 8) {
    throw new Error('No pudimos leer el archivo Excel: usa un formato comprimido que no soportamos.');
  }

  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const inflated = await new Response(stream).arrayBuffer();
  return new Uint8Array(inflated);
}

/**
 * @param {ArrayBuffer} buffer
 * @param {Map<string, { method: number, offset: number, compressedSize: number }>} entries
 * @param {string} name
 * @returns {Promise<string>}
 */
async function readXmlPart(buffer, entries, name) {
  const entry = entries.get(name);

  if (!entry) {
    return '';
  }

  const bytes = await readZipEntry(buffer, entry);
  return new TextDecoder().decode(bytes);
}

/**
 * @param {string} xml
 * @returns {Document}
 */
function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];

  if (error) {
    throw new Error('No pudimos leer el archivo Excel: su contenido no es el esperado.');
  }

  return doc;
}

/**
 * Shared strings: every cell may point to an index of this table.
 *
 * @param {string} xml
 * @returns {string[]}
 */
function readSharedStrings(xml) {
  if (!xml) {
    return [];
  }

  const doc = parseXml(xml);
  const items = doc.getElementsByTagName('si');

  return Array.from(items).map((item) =>
    Array.from(item.getElementsByTagName('t'))
      .map((node) => node.textContent || '')
      .join('')
  );
}

/**
 * Column letters to index: "A" -> 0, "B" -> 1, "AA" -> 26.
 *
 * @param {string} reference
 * @returns {number}
 */
function columnIndex(reference) {
  const letters = String(reference || '').match(/^[A-Z]+/i);
  if (!letters) {
    return -1;
  }

  let index = 0;
  for (const char of letters[0].toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }

  return index - 1;
}

/**
 * One worksheet -> rows of cells.
 *
 * @param {string} xml
 * @param {string[]} sharedStrings
 * @returns {Array<Array<string>>}
 */
function readSheetRows(xml, sharedStrings) {
  const doc = parseXml(xml);
  const rows = [];

  for (const rowElement of doc.getElementsByTagName('row')) {
    const cells = [];

    for (const cell of rowElement.getElementsByTagName('c')) {
      const type = cell.getAttribute('t');
      const reference = cell.getAttribute('r');
      const index = reference ? columnIndex(reference) : cells.length;
      let value = '';

      if (type === 'inlineStr') {
        value = Array.from(cell.getElementsByTagName('t'))
          .map((node) => node.textContent || '')
          .join('');
      } else {
        const raw = cell.getElementsByTagName('v')[0];
        const rawText = raw ? (raw.textContent || '') : '';

        if (type === 's') {
          value = sharedStrings[Number(rawText)] != null ? sharedStrings[Number(rawText)] : '';
        } else if (type === 'b') {
          value = rawText === '1' ? 'Sí' : 'No';
        } else {
          value = rawText;
        }
      }

      if (index >= 0) {
        cells[index] = value;
      } else {
        cells.push(value);
      }
    }

    rows.push(Array.from(cells, (cell) => (cell == null ? '' : cell)));
  }

  return rows;
}

/**
 * Resolves the worksheet targets declared in the workbook.
 *
 * @param {string} workbookXml
 * @param {string} relsXml
 * @returns {Array<{ name: string, target: string }>}
 */
function readWorkbookSheets(workbookXml, relsXml) {
  const workbook = parseXml(workbookXml);
  const targets = new Map();

  if (relsXml) {
    const rels = parseXml(relsXml);
    for (const relation of rels.getElementsByTagName('Relationship')) {
      const id = relation.getAttribute('Id');
      const target = relation.getAttribute('Target') || '';
      if (id) {
        targets.set(id, target);
      }
    }
  }

  const sheets = [];

  for (const sheet of workbook.getElementsByTagName('sheet')) {
    const name = sheet.getAttribute('name') || 'Hoja';
    const relationId =
      sheet.getAttribute('r:id') ||
      sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
      '';
    let target = targets.get(relationId) || '';

    if (target) {
      if (target.startsWith('/')) {
        target = target.slice(1);
      } else if (!target.startsWith('xl/')) {
        target = `xl/${target}`;
      }
    }

    sheets.push({ name, target });
  }

  return sheets;
}

/**
 * Reads an .xlsx file and shapes it for the ingester.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function extractXlsx(file) {
  const buffer = await file.arrayBuffer();
  const entries = readZipEntries(buffer);
  const sharedStrings = readSharedStrings(await readXmlPart(buffer, entries, 'xl/sharedStrings.xml'));
  const sheets = readWorkbookSheets(
    await readXmlPart(buffer, entries, 'xl/workbook.xml'),
    await readXmlPart(buffer, entries, 'xl/_rels/workbook.xml.rels')
  );

  const shaped = [];

  for (const sheet of sheets) {
    if (!sheet.target) {
      continue;
    }

    const rows = readSheetRows(await readXmlPart(buffer, entries, sheet.target), sharedStrings);
    if (!rows.length) {
      continue;
    }

    const [headers, ...body] = rows;
    shaped.push({ name: `${file.name} · ${sheet.name}`, ...buildSheet(headers, body) });
  }

  if (!shaped.length) {
    throw new Error('No encontramos hojas con datos en el archivo Excel.');
  }

  return sheetsToText(shaped);
}

export const XLSX_MIME_TYPE = XLSX_MIME;
