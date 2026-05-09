import express from 'express';
import multer from 'multer';
import { extractText } from 'unpdf';

const app = express();
const PORT = Number(process.env.PORT) || 3031;

// Store files in memory as Buffer
const upload = multer({ storage: multer.memoryStorage() });

const COA_BASE_URL = 'https://coas.freedomdiagnosticstesting.com';

const SEARCH_CODE_RE = /Coff\d+/i;
const LOT_RE = /CP[A-Z0-9]{6,}/;
const PURITY_RE = /\d{1,3}\.\d+%/;

function parseFields(text, filename) {
  const searchCodeMatch = text.match(SEARCH_CODE_RE);
  const lotMatch = text.match(LOT_RE);

  let product = null;
  if (lotMatch) {
    const afterLot = text.slice(lotMatch.index + lotMatch[0].length);
    const purityMatch = afterLot.match(PURITY_RE);
    if (purityMatch) {
      product = afterLot.slice(0, purityMatch.index).trim().replace(/\s+/g, ' ');
    }
  }

  const coaLink = `${COA_BASE_URL}/${encodeURIComponent(filename)}`;

  return {
    searchCode: searchCodeMatch ? searchCodeMatch[0] : null,
    lot: lotMatch ? lotMatch[0] : null,
    product: product || null,
    coaLink,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/parse-pdf', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const results = await Promise.all(
    req.files.map(async (file) => {
      try {
        const fileBytes = new Uint8Array(
          file.buffer.buffer,
          file.buffer.byteOffset,
          file.buffer.byteLength
        );
        const pdf = await extractText(fileBytes, { mergePages: true });
        const text = Array.isArray(pdf.text) ? pdf.text.join('\n') : pdf.text ?? '';
        const fields = parseFields(text, file.originalname);
        return { filename: file.originalname, ...fields, error: null };
      } catch (err) {
        return {
          filename: file.originalname,
          searchCode: null,
          lot: null,
          product: null,
          coaLink: `${COA_BASE_URL}/${encodeURIComponent(file.originalname)}`,
          error: err.message || 'Failed to parse PDF.',
        };
      }
    })
  );

  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`PDF API server running at http://localhost:${PORT}`);
});
