import type { IKnowledgeDocument } from '@librechat/data-schemas';
import type { KnowledgeDocumentItem } from 'librechat-data-provider';

/**
 * Общий DTO документа базы знаний — один источник и для админского роутера
 * (`admin/corporate/knowledge.ts`), и для роутера сотрудника (`employee.ts`): набор
 * полей, которые видит клиент, у них одинаковый. `text` и `storagePath` — серверные
 * поля, на клиент не уходят никогда.
 */
export function toKnowledgeDocumentItem(doc: IKnowledgeDocument): KnowledgeDocumentItem {
  return {
    id: doc._id.toString(),
    spaceId: doc.spaceId.toString(),
    fileId: doc.file_id,
    title: doc.title,
    description: doc.description ?? '',
    filename: doc.filename ?? '',
    source: doc.source ?? '',
    owner: doc.owner ?? '',
    uploadedBy: doc.uploadedBy.toString(),
    version: doc.version ?? '',
    effectiveDate: doc.effectiveDate ? doc.effectiveDate.toISOString() : null,
    status: doc.status,
    embeddingModel: doc.embeddingModel ?? '',
    bytes: doc.bytes ?? 0,
    mimetype: doc.mimetype ?? '',
    embedded: doc.embedded ?? false,
    createdAt: doc.createdAt?.toISOString() ?? new Date(0).toISOString(),
  };
}
