// Document adapters: one per file type, each turning raw bytes into
// {text, metadata}. Mirrors the ArchiveProvider pattern in src/index.js -
// a generic contract, source-specific logic stays inside each adapter.
//
// Heavy libraries (pdf.js, mammoth, SheetJS) are lazy-loaded via dynamic
// import() from public/vendor/ only when a matching file is actually
// encountered, so a user who never uploads a PDF never pays for pdf.js.

class DocumentAdapter {
  constructor({ id, matches, extract }) {
    this.id = id;
    this.matches = matches; // (filename, mimeType) => boolean
    this.extract = extract; // async (bytes: Uint8Array, filename) => { text, metadata }
  }
}

function extOf(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(filename || '');
  return m ? m[1].toLowerCase() : '';
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });

const TextAdapter = new DocumentAdapter({
  id: 'text',
  matches: (filename) => ['txt', 'csv', 'json', 'md', 'log'].includes(extOf(filename)),
  extract: async (bytes) => ({ text: textDecoder.decode(bytes), metadata: {} })
});

const PdfAdapter = new DocumentAdapter({
  id: 'pdf',
  matches: (filename) => extOf(filename) === 'pdf',
  extract: async (bytes) => {
    const pdfjsLib = await import('/vendor/pdfjs/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];
    // pageOffsets[i] is the character offset in the final joined `text`
    // where page i+1 begins - lets a search hit be mapped back to a page
    // number for citations and passage-anchored "open at page" links.
    const pageOffsets = [];
    let offset = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => it.str).join(' ');
      pageOffsets.push(offset);
      pages.push(pageText);
      offset += pageText.length + 2; // +2 accounts for the '\n\n' joiner below
    }
    return { text: pages.join('\n\n'), metadata: { pageCount: doc.numPages, pageOffsets } };
  }
});

const DocxAdapter = new DocumentAdapter({
  id: 'docx',
  matches: (filename) => extOf(filename) === 'docx',
  extract: async (bytes) => {
    // mammoth ships only a classic UMD browser bundle (no ESM build). Importing
    // it for its side effect executes the UMD wrapper, which assigns window.mammoth.
    if (!window.mammoth) await import('/vendor/mammoth/mammoth.browser.js');
    const { value } = await window.mammoth.extractRawText({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    return { text: value, metadata: {} };
  }
});

const XlsxAdapter = new DocumentAdapter({
  id: 'xlsx',
  matches: (filename) => ['xlsx', 'xls'].includes(extOf(filename)),
  extract: async (bytes) => {
    const XLSX = await import('/vendor/xlsx/xlsx.mjs');
    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheetNames = workbook.SheetNames;
    const parts = [];
    const rowCounts = {};
    for (const name of sheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      rowCounts[name] = rows.length;
      parts.push(`# ${name}\n` + rows.map((r) => r.join(' ')).join('\n'));
    }
    return { text: parts.join('\n\n'), metadata: { sheetNames, rowCounts } };
  }
});

// RFC822-ish .eml parser. No dependency - headers + text/plain body, with basic
// multipart/alternative boundary splitting. .msg/PST are out of scope (binary
// Outlook formats need much heavier parsing) - see docs plan for this milestone.
const EmailAdapter = new DocumentAdapter({
  id: 'email',
  matches: (filename) => extOf(filename) === 'eml',
  extract: async (bytes) => {
    const raw = textDecoder.decode(bytes);
    const headerEnd = raw.search(/\r?\n\r?\n/);
    const headerBlock = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
    let body = headerEnd >= 0 ? raw.slice(headerEnd).replace(/^\r?\n\r?\n/, '') : '';

    const headers = {};
    for (const line of headerBlock.split(/\r?\n/)) {
      const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
      if (m) headers[m[1].toLowerCase()] = m[2];
    }

    const contentType = headers['content-type'] || '';
    const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\r?\\n`));
      const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
      if (plain) {
        const partHeaderEnd = plain.search(/\r?\n\r?\n/);
        body = partHeaderEnd >= 0 ? plain.slice(partHeaderEnd).replace(/^\r?\n\r?\n/, '') : plain;
      }
    }

    const text = [
      headers.from ? `From: ${headers.from}` : '',
      headers.to ? `To: ${headers.to}` : '',
      headers.subject ? `Subject: ${headers.subject}` : '',
      headers.date ? `Date: ${headers.date}` : '',
      '',
      body.trim()
    ].filter(Boolean).join('\n');

    return {
      text,
      metadata: { from: headers.from || null, to: headers.to || null, subject: headers.subject || null, date: headers.date || null }
    };
  }
});

export const ADAPTERS = [TextAdapter, PdfAdapter, DocxAdapter, XlsxAdapter, EmailAdapter];

export function findAdapter(filename, mimeType) {
  return ADAPTERS.find((a) => a.matches(filename, mimeType)) || null;
}

export async function extractContent(filename, mimeType, bytes) {
  const adapter = findAdapter(filename, mimeType);
  if (!adapter) return { text: null, metadata: {}, note: 'No text extractor for this file type yet.' };
  try {
    const { text, metadata } = await adapter.extract(bytes, filename);
    return { text, metadata, note: null };
  } catch (e) {
    return { text: null, metadata: {}, note: `Extraction failed: ${e.message}` };
  }
}
