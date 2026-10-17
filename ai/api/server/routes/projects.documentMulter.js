const path = require('path');
const multer = require('multer');
const paths = require('~/config/paths');

const PROJECT_DOCUMENT_LIMIT_BYTES = 25 * 1024 * 1024;
const PROJECT_DOCUMENTS_ROOT = path.join(paths.uploads, 'knowledge', 'projects');

const projectDocumentUpload = multer({
  dest: path.join(paths.uploads, 'temp', 'projects'),
  limits: { fileSize: PROJECT_DOCUMENT_LIMIT_BYTES },
  // По умолчанию multer/busboy декодирует параметры multipart (включая имя файла из
  // Content-Disposition) как latin1 — для кириллицы и любого не-ASCII имени это
  // гарантированные кракозябры. `title` из полей формы не страдает (обычное текстовое
  // поле), а `file.originalname` идёт именно через этот путь.
  defParamCharset: 'utf8',
});

module.exports = {
  projectDocumentUpload,
  PROJECT_DOCUMENTS_ROOT,
  PROJECT_DOCUMENT_LIMIT_BYTES,
};
