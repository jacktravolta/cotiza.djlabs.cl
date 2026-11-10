// Extraction dispatcher: routes a file to the right extractor.

import { detectType } from './detect.js?v=4';
import { extractImage } from './image.js?v=4';
import { extractPdf } from './pdf.js?v=4';
import { extractDocx } from './docx.js?v=4';
import { extractText } from './text.js?v=4';
import { extractAudio } from './audio.js?v=4';
import { extractCsv } from './csv.js?v=4';
import { extractXlsx } from './xlsx.js?v=4';

export const DOC_ERROR =
  'El formato .doc no está permitido. Guarda el documento como .docx y vuelve a intentarlo.';

export const XLS_ERROR =
  'El formato .xls no está permitido (es un Excel antiguo, binario). ' +
  'Guárdalo como .xlsx y vuelve a intentarlo.';

export const UNKNOWN_ERROR =
  'No reconocemos ese formato. Puedes adjuntar imágenes (PNG, JPG, WEBP, GIF), ' +
  'PDF, documentos Word .docx, hojas de cálculo (.csv, .xlsx), texto plano (.txt, .md) ' +
  'o audio (MP3, WAV, OGG, M4A).';

/**
 * Extracts plain text from a supported file.
 *
 * @param {File} file
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{ text: string, sourceType: 'image'|'pdf'|'docx'|'text'|'audio'|'csv'|'xlsx' }>}
 */
export async function extract(file, onProgress = () => {}) {
  const { type } = detectType(file);

  switch (type) {
    case 'image':
      return { text: await extractImage(file, onProgress), sourceType: 'image' };

    case 'pdf':
      return { text: await extractPdf(file, onProgress), sourceType: 'pdf' };

    case 'docx':
      return { text: await extractDocx(file), sourceType: 'docx' };

    case 'csv':
      return { text: await extractCsv(file), sourceType: 'csv' };

    case 'xlsx':
      return { text: await extractXlsx(file), sourceType: 'xlsx' };

    case 'text':
      return { text: await extractText(file), sourceType: 'text' };

    case 'audio':
      return { text: await extractAudio(file, onProgress), sourceType: 'audio' };

    case 'doc':
      throw new Error(DOC_ERROR);

    case 'xls':
      throw new Error(XLS_ERROR);

    default:
      throw new Error(UNKNOWN_ERROR);
  }
}