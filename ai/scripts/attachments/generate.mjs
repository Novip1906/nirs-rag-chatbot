import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiPackageJson = path.resolve(__dirname, '../../packages/api/package.json');
const require = createRequire(apiPackageJson);

const docx = require('docx');
const PptxGenJS = require('pptxgenjs');
const XLSX = require('xlsx');
const sharp = require('sharp');

const MB = 1024 * 1024;
const SEED = 20260913;
const outDir = path.resolve(process.cwd(), process.argv[2] || 'bench-files');
const SOFFICE_BIN = process.env.SOFFICE_BIN || 'soffice';

function makePrng(seed) {
  let state = seed >>> 0;
  return function next() {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

const prng = makePrng(SEED);

const wordsRu = [
  'договор',
  'поставка',
  'оплата',
  'счет',
  'акт',
  'накладная',
  'контракт',
  'обязательство',
  'гарантия',
  'неустойка',
  'аренда',
  'отчет',
  'баланс',
  'актив',
  'пассив',
  'выручка',
  'расход',
  'прибыль',
  'инвестиция',
  'кредит',
  'дебет',
  'сделка',
  'партнер',
  'клиент',
  'поставщик',
  'заказчик',
  'исполнитель',
  'срок',
  'условие',
  'ответственность',
];

const wordsEn = [
  'contract',
  'delivery',
  'payment',
  'invoice',
  'report',
  'revenue',
  'expense',
  'profit',
  'asset',
  'liability',
  'agreement',
  'vendor',
  'client',
  'customer',
  'supplier',
  'obligation',
  'warranty',
  'penalty',
  'lease',
  'balance',
  'investment',
  'credit',
  'debit',
  'transaction',
  'partner',
  'deadline',
  'term',
  'condition',
  'compliance',
  'schedule',
];

const allWords = wordsRu.concat(wordsEn);

function pickWord() {
  const index = Math.floor(prng() * allWords.length);
  return allWords[index];
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function sentence() {
  const words = [];
  for (let i = 0; i < 12; i++) {
    words.push(pickWord());
  }
  words[0] = capitalize(words[0]);
  return `${words.join(' ')}.`;
}

function textOfLength(targetChars) {
  let text = '';
  while (text.length < targetChars) {
    text = text.length ? `${text} ${sentence()}` : sentence();
  }
  return text;
}

function nextGaussianPair() {
  let u1 = 0;
  while (u1 === 0) {
    u1 = prng();
  }
  const u2 = prng();
  const radius = Math.sqrt(-2 * Math.log(u1));
  const angle = 2 * Math.PI * u2;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

function clampByte(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function buildNoiseBuffer(width, height, channels, mean, sigma) {
  const size = width * height * channels;
  const buffer = Buffer.allocUnsafe(size);
  let i = 0;
  while (i < size) {
    const [z0, z1] = nextGaussianPair();
    buffer[i++] = clampByte(mean + sigma * z0);
    if (i < size) {
      buffer[i++] = clampByte(mean + sigma * z1);
    }
  }
  return buffer;
}

async function buildNoisePool(budgetBytes, sigma) {
  const pool = [];
  let total = 0;
  while (total < budgetBytes) {
    const raw = buildNoiseBuffer(1200, 800, 3, 128, sigma);
    const buffer = await sharp(raw, { raw: { width: 1200, height: 800, channels: 3 } })
      .jpeg({ quality: 80 })
      .toBuffer();
    pool.push(buffer);
    total += buffer.length;
  }
  return pool;
}

function docxParagraph(text) {
  return new docx.Paragraph({ children: [new docx.TextRun(text)] });
}

function docxPageBreak() {
  return new docx.Paragraph({ children: [new docx.PageBreak()] });
}

function docxImageParagraph(imageBuffer) {
  return new docx.Paragraph({
    children: [
      new docx.ImageRun({
        type: 'jpg',
        data: imageBuffer,
        transformation: { width: 300, height: 200 },
      }),
    ],
  });
}

async function writeDocxText(filePath, pageCount, charsPerPage) {
  const children = [];
  for (let page = 0; page < pageCount; page++) {
    children.push(docxParagraph(textOfLength(charsPerPage)));
    if (page < pageCount - 1) {
      children.push(docxPageBreak());
    }
  }
  const document = new docx.Document({ sections: [{ children }] });
  const buffer = await docx.Packer.toBuffer(document);
  fs.writeFileSync(filePath, buffer);
  return buffer.length;
}

async function writeDocxMixed(filePath, pool, charsPerPage) {
  const pageCount = Math.max(400, pool.length);
  const children = [];
  for (let page = 0; page < pageCount; page++) {
    children.push(docxParagraph(textOfLength(charsPerPage)));
    children.push(docxImageParagraph(pool[page % pool.length]));
    if (page < pageCount - 1) {
      children.push(docxPageBreak());
    }
  }
  const document = new docx.Document({ sections: [{ children }] });
  const buffer = await docx.Packer.toBuffer(document);
  fs.writeFileSync(filePath, buffer);
  return buffer.length;
}

async function writePptxMixed(filePath, pool, charsPerSlide) {
  const pptx = new PptxGenJS();
  for (const image of pool) {
    const slide = pptx.addSlide();
    slide.addText(textOfLength(charsPerSlide), { x: 0.5, y: 0.4, w: 9, h: 2 });
    slide.addImage({
      data: `data:image/jpeg;base64,${image.toString('base64')}`,
      x: 0.5,
      y: 2.6,
      w: 4,
      h: 2.67,
    });
  }
  await pptx.writeFile({ fileName: filePath });
  return fs.statSync(filePath).size;
}

function xlsxRow(index, descWords) {
  const status = index % 2 === 0 ? 'completed' : 'pending review';
  const descriptionWords = [];
  for (let k = 0; k < descWords; k++) {
    descriptionWords.push(pickWord());
  }
  return [
    index,
    `${pickWord()} OOO ${index % 999}`,
    descriptionWords.join(' '),
    (index * 1.2345).toFixed(2),
    `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    status,
  ];
}

function writeXlsxFile(filePath, rows, descWords) {
  const header = ['id', 'company', 'description', 'amount', 'date', 'status'];
  const data = [header];
  for (let i = 0; i < rows; i++) {
    data.push(xlsxRow(i, descWords));
  }
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  XLSX.writeFile(workbook, filePath, { compression: true });
  return fs.statSync(filePath).size;
}

function calibrateXlsxBytesPerRow(descWords) {
  const pilotRows = 50000;
  const pilotPath = path.join(outDir, '.xlsx-pilot.xlsx');
  const size = writeXlsxFile(pilotPath, pilotRows, descWords);
  fs.unlinkSync(pilotPath);
  return size / pilotRows;
}

function convertToPdf(sourcePath) {
  execFileSync(SOFFICE_BIN, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, sourcePath], {
    stdio: 'pipe',
  });
  const pdfName = `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`;
  return path.join(outDir, pdfName);
}

async function buildCalibratedMixedDocx(charsPerPage) {
  const docxPath = path.join(outDir, 'docx-mixed.docx');
  const pdfTargetPath = path.join(outDir, 'pdf-mixed.pdf');
  let budgetMB = 46;
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pool = await buildNoisePool(budgetMB * MB, 8);
    await writeDocxMixed(docxPath, pool, charsPerPage);
    const docxSizeMB = fs.statSync(docxPath).size / MB;

    const pdfPath = convertToPdf(docxPath);
    const pdfSizeMB = fs.statSync(pdfPath).size / MB;

    const withinRange = (mb) => mb >= 45 && mb <= 50;

    if (withinRange(docxSizeMB) && withinRange(pdfSizeMB)) {
      fs.copyFileSync(pdfPath, pdfTargetPath);
      return;
    }

    if (pdfSizeMB > 50 || docxSizeMB > 50) {
      budgetMB -= 2;
      continue;
    }

    if (pdfSizeMB < 45 || docxSizeMB < 45) {
      budgetMB += 2;
      continue;
    }

    fs.copyFileSync(pdfPath, pdfTargetPath);
    return;
  }

  const pdfPath = path.join(outDir, 'docx-mixed.pdf');
  if (fs.existsSync(pdfPath)) {
    fs.copyFileSync(pdfPath, pdfTargetPath);
  }
}

async function buildCalibratedPptxMixed(charsPerSlide) {
  const pptxPath = path.join(outDir, 'pptx-mixed.pptx');
  let budgetMB = 46;
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pool = await buildNoisePool(budgetMB * MB, 8);
    await writePptxMixed(pptxPath, pool, charsPerSlide);
    const sizeMB = fs.statSync(pptxPath).size / MB;

    if (sizeMB >= 45 && sizeMB <= 50) {
      return;
    }
    if (sizeMB > 50) {
      budgetMB -= 2;
      continue;
    }
    budgetMB += 2;
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];

  const textDocxPath = path.join(outDir, 'docx-text.docx');
  await writeDocxText(textDocxPath, 3000, 2500);
  results.push(['docx-text.docx', fs.statSync(textDocxPath).size]);

  await buildCalibratedMixedDocx(2500);
  results.push(['docx-mixed.docx', fs.statSync(path.join(outDir, 'docx-mixed.docx')).size]);
  results.push(['pdf-mixed.pdf', fs.statSync(path.join(outDir, 'pdf-mixed.pdf')).size]);

  await buildCalibratedPptxMixed(600);
  results.push(['pptx-mixed.pptx', fs.statSync(path.join(outDir, 'pptx-mixed.pptx')).size]);

  const descWords = 5;
  const bytesPerRow = calibrateXlsxBytesPerRow(descWords);

  const xlsxTargets = [
    ['xlsx-10mb.xlsx', 10 * MB],
    ['xlsx-25mb.xlsx', 25 * MB],
    ['xlsx-49mb.xlsx', 49 * MB],
  ];

  for (const [name, targetBytes] of xlsxTargets) {
    const rows = Math.min(400000, Math.round(targetBytes / bytesPerRow));
    const filePath = path.join(outDir, name);
    const size = writeXlsxFile(filePath, rows, descWords);
    results.push([name, size]);
  }

  const docxTextPdfPath = convertToPdf(textDocxPath);
  results.push(['docx-text.pdf', fs.statSync(docxTextPdfPath).size]);

  console.log('\nGenerated files:');
  for (const [name, size] of results) {
    console.log(`${name}\t${(size / MB).toFixed(2)} MB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
