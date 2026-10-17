import { getKnowledgeRagUrl } from './url';

describe('getKnowledgeRagUrl', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('берёт собственный адрес базы знаний, когда он задан', () => {
    process.env.KNOWLEDGE_RAG_API_URL = 'http://knowledge-rag:8000';
    process.env.RAG_API_URL = 'http://rag-api:8000';
    expect(getKnowledgeRagUrl()).toBe('http://knowledge-rag:8000');
  });

  it('падает обратно на общий адрес, пока собственный не задан', () => {
    delete process.env.KNOWLEDGE_RAG_API_URL;
    process.env.RAG_API_URL = 'http://rag-api:8000';
    expect(getKnowledgeRagUrl()).toBe('http://rag-api:8000');
  });

  it('возвращает пустую строку, когда не задан ни один', () => {
    delete process.env.KNOWLEDGE_RAG_API_URL;
    delete process.env.RAG_API_URL;
    expect(getKnowledgeRagUrl()).toBe('');
  });

  it('игнорирует пустое значение собственного адреса', () => {
    process.env.KNOWLEDGE_RAG_API_URL = '   ';
    process.env.RAG_API_URL = 'http://rag-api:8000';
    expect(getKnowledgeRagUrl()).toBe('http://rag-api:8000');
  });
});
