const EXTENSION_MIME_TYPES: Record<string, Set<string>> = {
  pdf: new Set(['application/pdf']),
  docx: new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  pptx: new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  txt: new Set(['text/plain']),
  md: new Set(['text/markdown', 'text/x-markdown', 'text/plain']),
  csv: new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain']),
};

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Проверяется и расширение, и MIME. Расширение вне списка отклоняет файл независимо от
 * заявленного MIME (это ловит подмену типа вроде `virus.exe`). `application/octet-stream`
 * принимается для разрешённых расширений отдельно: часть клиентов не умеет выставлять
 * точный MIME для офисных форматов и присылает общий бинарный тип — расширение тогда
 * остаётся единственным надёжным сигналом.
 */
export function isSupportedDocument(filename: string, mimetype: string): boolean {
  const allowedMimeTypes = EXTENSION_MIME_TYPES[fileExtension(filename)];
  if (!allowedMimeTypes) {
    return false;
  }
  return allowedMimeTypes.has(mimetype) || mimetype === 'application/octet-stream';
}
