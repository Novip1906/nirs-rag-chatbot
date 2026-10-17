import { KnowledgeSpaceNotEmptyError } from '@librechat/data-schemas';
import { KNOWLEDGE_DOCUMENT_EXTENSIONS } from 'librechat-data-provider';
import { createEmployeeKnowledgeHandlers } from './employee';
import { isSupportedDocument } from './mime';
import type { Response } from 'express';

describe('employee knowledge handlers', () => {
  const SPACE_SALES_ID = '65f0a0000000000000000001';
  const SPACE_HR_ID = '65f0a0000000000000000002';
  const DOC_ID = '65f0a0000000000000000011';
  const INVALID_ID = 'space-sales';

  const readable = [
    { id: SPACE_SALES_ID, name: 'Продажи', allowedDepartments: ['dep'], enabled: true },
  ];

  const DEPARTMENT_ID = 'dep';

  function buildHandlers(overrides = {}) {
    return createEmployeeKnowledgeHandlers({
      resolveAllowedSpaces: jest.fn().mockResolvedValue(readable),
      resolveWritableSpaces: jest.fn().mockResolvedValue([]),
      listDocuments: jest.fn().mockResolvedValue([]),
      getDocumentById: jest.fn().mockResolvedValue(null),
      updateDocument: jest.fn(),
      archiveDocument: jest.fn(),
      deleteDocument: jest.fn(),
      deleteVectors: jest.fn().mockResolvedValue(undefined),
      ingest: jest.fn(),
      removeOriginal: jest.fn().mockResolvedValue(undefined),
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId: DEPARTMENT_ID }),
      getSpaceById: jest.fn().mockResolvedValue(null),
      createSpace: jest.fn(),
      updateSpace: jest.fn(),
      deleteSpace: jest.fn(),
      ...overrides,
    });
  }

  const res = () => {
    const r = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    return r as never as Response;
  };

  it('в списке помечает пространства, доступные на запись', async () => {
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
    });
    const r = res();
    await handlers.listSpaces({ user: { id: 'u1', role: 'USER' } } as never, r);
    expect(r.json).toHaveBeenCalledWith({
      spaces: [expect.objectContaining({ id: SPACE_SALES_ID, canWrite: true })],
    });
  });

  it('отказывает в загрузке в пространство, недоступное на запись', async () => {
    const handlers = buildHandlers();
    const r = res();
    await handlers.uploadDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: SPACE_SALES_ID },
        body: { title: 'Регламент' },
        file: { path: '/tmp/x', originalname: 'x.pdf', mimetype: 'application/pdf', size: 10 },
      } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('отказывает в правке чужого документа сотруднику', async () => {
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'someone-else' }),
    });
    const r = res();
    await handlers.updateDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: DOC_ID },
        body: { title: 'Новое' },
      } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('разрешает главе правку чужого документа в своём пространстве', async () => {
    const updateDocument = jest.fn().mockResolvedValue({ _id: DOC_ID, title: 'Новое' });
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'someone-else' }),
      updateDocument,
    });
    const r = res();
    await handlers.updateDocument(
      {
        user: { id: 'u1', role: 'HEAD' },
        params: { id: DOC_ID },
        body: { title: 'Новое' },
      } as never,
      r,
    );
    expect(updateDocument).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({ title: 'Новое' }),
    );
  });

  it('отклоняет правку с пустым названием', async () => {
    const updateDocument = jest.fn();
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'u1' }),
      updateDocument,
    });
    const r = res();
    await handlers.updateDocument(
      { user: { id: 'u1', role: 'USER' }, params: { id: DOC_ID }, body: { title: '' } } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(400);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('отклоняет правку с названием из одних пробелов', async () => {
    const updateDocument = jest.fn();
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'u1' }),
      updateDocument,
    });
    const r = res();
    await handlers.updateDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: DOC_ID },
        body: { title: '   ' },
      } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(400);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('обрезает пробелы у названия при правке', async () => {
    const updateDocument = jest.fn().mockResolvedValue({ _id: DOC_ID, title: 'Регламент' });
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'u1' }),
      updateDocument,
    });
    const r = res();
    await handlers.updateDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: DOC_ID },
        body: { title: '  Регламент  ' },
      } as never,
      r,
    );
    expect(updateDocument).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({ title: 'Регламент' }),
    );
  });

  it('отклоняет правку с неразбираемой датой вместо молчаливой очистки', async () => {
    const updateDocument = jest.fn();
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'u1' }),
      updateDocument,
    });
    const r = res();
    await handlers.updateDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: DOC_ID },
        body: { effectiveDate: 'вчера' },
      } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(400);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('явная очистка даты (null) проходит и передаётся как null', async () => {
    const updateDocument = jest.fn().mockResolvedValue({ _id: DOC_ID });
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'u1' }),
      updateDocument,
    });
    const r = res();
    await handlers.updateDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: DOC_ID },
        body: { effectiveDate: null },
      } as never,
      r,
    );
    expect(updateDocument).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({ effectiveDate: null }),
    );
  });

  it('не принимает описание длиннее 200 знаков', async () => {
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
    });
    const r = res();
    await handlers.uploadDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: SPACE_SALES_ID },
        body: { title: 'Регламент', description: 'я'.repeat(201) },
        file: { path: '/tmp/x', originalname: 'x.pdf', mimetype: 'application/pdf', size: 10 },
      } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('расширения, которые клиент разрешает выбрать до отправки, сервер действительно принимает', () => {
    for (const extension of KNOWLEDGE_DOCUMENT_EXTENSIONS) {
      expect(isSupportedDocument(`file.${extension}`, 'application/octet-stream')).toBe(true);
    }
  });

  it('запрашивает у хранилища только активные документы', async () => {
    const listDocuments = jest.fn().mockResolvedValue([]);
    const handlers = buildHandlers({ listDocuments });
    const r = res();
    await handlers.listDocuments(
      { user: { id: 'u1', role: 'USER' }, params: { id: SPACE_SALES_ID } } as never,
      r,
    );
    expect(listDocuments).toHaveBeenCalledWith({ spaceId: SPACE_SALES_ID, status: 'active' });
  });

  it('документы чужого пространства не отдаёт', async () => {
    const handlers = buildHandlers();
    const r = res();
    await handlers.listDocuments(
      { user: { id: 'u1', role: 'USER' }, params: { id: SPACE_HR_ID } } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('отказывает при некорректном формате id пространства в списке документов', async () => {
    const handlers = buildHandlers();
    const r = res();
    await handlers.listDocuments(
      { user: { id: 'u1', role: 'USER' }, params: { id: INVALID_ID } } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('отказывает при некорректном формате id пространства при загрузке', async () => {
    const handlers = buildHandlers();
    const r = res();
    await handlers.uploadDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: INVALID_ID },
        body: { title: 'Регламент' },
        file: { path: '/tmp/x', originalname: 'x.pdf', mimetype: 'application/pdf', size: 10 },
      } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('отказывает при некорректном формате id документа в правке', async () => {
    const handlers = buildHandlers();
    const r = res();
    await handlers.updateDocument(
      { user: { id: 'u1', role: 'USER' }, params: { id: INVALID_ID }, body: {} } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('отказывает при некорректном формате id документа в архивации', async () => {
    const handlers = buildHandlers();
    const r = res();
    await handlers.archiveDocument(
      { user: { id: 'u1', role: 'USER' }, params: { id: INVALID_ID } } as never,
      r,
    );
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('разрешает сотруднику архивировать свой документ', async () => {
    const archiveDocument = jest.fn().mockResolvedValue({ _id: DOC_ID, status: 'archived' });
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'u1' }),
      archiveDocument,
    });
    const r = res();
    await handlers.archiveDocument(
      { user: { id: 'u1', role: 'USER' }, params: { id: DOC_ID } } as never,
      r,
    );
    expect(archiveDocument).toHaveBeenCalledWith(DOC_ID);
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it('отказывает сотруднику в архивации чужого документа', async () => {
    const archiveDocument = jest.fn();
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'someone-else' }),
      archiveDocument,
    });
    const r = res();
    await handlers.archiveDocument(
      { user: { id: 'u1', role: 'USER' }, params: { id: DOC_ID } } as never,
      r,
    );
    expect(archiveDocument).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('удаляет временный файл, если пространство недоступно на запись', async () => {
    const removeOriginal = jest.fn().mockResolvedValue(undefined);
    const handlers = buildHandlers({ removeOriginal });
    const r = res();
    await handlers.uploadDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: SPACE_SALES_ID },
        body: { title: 'Регламент' },
        file: { path: '/tmp/x', originalname: 'x.pdf', mimetype: 'application/pdf', size: 10 },
      } as never,
      r,
    );
    expect(removeOriginal).toHaveBeenCalledWith('/tmp/x');
  });

  it('удаляет временный файл, если название документа пустое', async () => {
    const removeOriginal = jest.fn().mockResolvedValue(undefined);
    const handlers = buildHandlers({
      resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      removeOriginal,
    });
    const r = res();
    await handlers.uploadDocument(
      {
        user: { id: 'u1', role: 'USER' },
        params: { id: SPACE_SALES_ID },
        body: { title: '' },
        file: { path: '/tmp/x', originalname: 'x.pdf', mimetype: 'application/pdf', size: 10 },
      } as never,
      r,
    );
    expect(removeOriginal).toHaveBeenCalledWith('/tmp/x');
  });

  describe('загрузка новой версии (supersedesId)', () => {
    function uploadWithSupersedes(supersedesId: string, overrides = {}) {
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        ...overrides,
      });
      const r = res();
      return handlers
        .uploadDocument(
          {
            user: { id: 'u1', role: 'USER' },
            params: { id: SPACE_SALES_ID },
            body: { title: 'Регламент', supersedesId },
            file: { path: '/tmp/x', originalname: 'x.pdf', mimetype: 'application/pdf', size: 10 },
          } as never,
          r,
        )
        .then(() => r);
    }

    it('отказывает при некорректном формате supersedesId', async () => {
      const r = await uploadWithSupersedes(INVALID_ID);
      expect(r.status).toHaveBeenCalledWith(400);
    });

    it('отказывает, если заменяемый документ не найден', async () => {
      const r = await uploadWithSupersedes(DOC_ID, {
        getDocumentById: jest.fn().mockResolvedValue(null),
      });
      expect(r.status).toHaveBeenCalledWith(404);
    });

    it('отказывает при замене документа из другого пространства', async () => {
      const r = await uploadWithSupersedes(DOC_ID, {
        getDocumentById: jest
          .fn()
          .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_HR_ID, uploadedBy: 'u1' }),
      });
      expect(r.status).toHaveBeenCalledWith(400);
    });

    it('отказывает сотруднику в замене чужого документа новой версией', async () => {
      const r = await uploadWithSupersedes(DOC_ID, {
        getDocumentById: jest
          .fn()
          .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'someone-else' }),
      });
      expect(r.status).toHaveBeenCalledWith(403);
    });

    it('разрешает главе заменить чужой документ новой версией', async () => {
      const ingest = jest.fn().mockResolvedValue({
        ok: true,
        document: { _id: 'new-doc', spaceId: SPACE_SALES_ID, file_id: 'f1', uploadedBy: 'u1' },
      });
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getDocumentById: jest
          .fn()
          .mockResolvedValue({ _id: DOC_ID, spaceId: SPACE_SALES_ID, uploadedBy: 'someone-else' }),
        ingest,
      });
      const r = res();
      await handlers.uploadDocument(
        {
          user: { id: 'u1', role: 'HEAD' },
          params: { id: SPACE_SALES_ID },
          body: { title: 'Регламент', supersedesId: DOC_ID },
          file: { path: '/tmp/x', originalname: 'x.pdf', mimetype: 'application/pdf', size: 10 },
        } as never,
        r,
      );
      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.objectContaining({ supersedesId: DOC_ID }),
        }),
      );
      expect(r.status).toHaveBeenCalledWith(201);
    });

    it('передаёт supersedesId=null в конвейер, если поле не пришло', async () => {
      const ingest = jest.fn().mockResolvedValue({
        ok: true,
        document: { _id: 'new-doc', spaceId: SPACE_SALES_ID, file_id: 'f1', uploadedBy: 'u1' },
      });
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        ingest,
      });
      const r = res();
      await handlers.uploadDocument(
        {
          user: { id: 'u1', role: 'USER' },
          params: { id: SPACE_SALES_ID },
          body: { title: 'Регламент' },
          file: { path: '/tmp/x', originalname: 'x.pdf', mimetype: 'application/pdf', size: 10 },
        } as never,
        r,
      );
      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.objectContaining({ supersedesId: null }),
        }),
      );
    });
  });

  describe('управление пространствами (создание/переименование/удаление)', () => {
    it('в списке помечает управляемыми только пространства главы, доступные на запись', async () => {
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      });
      const r = res();
      await handlers.listSpaces({ user: { id: 'u1', role: 'HEAD' } } as never, r);
      expect(r.json).toHaveBeenCalledWith({
        spaces: [expect.objectContaining({ id: SPACE_SALES_ID, canWrite: true, canManage: true })],
      });
    });

    it('не помечает пространство управляемым для обычного сотрудника с правом записи', async () => {
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
      });
      const r = res();
      await handlers.listSpaces({ user: { id: 'u1', role: 'USER' } } as never, r);
      expect(r.json).toHaveBeenCalledWith({
        spaces: [expect.objectContaining({ canWrite: true, canManage: false })],
      });
    });

    it('глава создаёт пространство в свой отдел, даже если прислала другой allowedDepartments', async () => {
      const createSpace = jest.fn().mockResolvedValue({
        _id: SPACE_SALES_ID,
        name: 'Продажи',
        allowedDepartments: [DEPARTMENT_ID],
        enabled: true,
      });
      const handlers = buildHandlers({ createSpace });
      const r = res();
      await handlers.createSpace(
        {
          user: { id: 'u1', role: 'HEAD' },
          body: { name: 'Продажи', allowedDepartments: ['другой-отдел'] },
        } as never,
        r,
      );
      expect(createSpace).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Продажи', allowedDepartments: [DEPARTMENT_ID] }),
      );
      expect(r.status).toHaveBeenCalledWith(201);
    });

    it('отказывает обычному сотруднику в создании пространства', async () => {
      const createSpace = jest.fn();
      const handlers = buildHandlers({ createSpace });
      const r = res();
      await handlers.createSpace(
        { user: { id: 'u1', role: 'USER' }, body: { name: 'Продажи' } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(403);
      expect(createSpace).not.toHaveBeenCalled();
    });

    it('отказывает главе без отдела в создании пространства', async () => {
      const createSpace = jest.fn();
      const handlers = buildHandlers({
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: null }),
        createSpace,
      });
      const r = res();
      await handlers.createSpace(
        { user: { id: 'u1', role: 'HEAD' }, body: { name: 'Продажи' } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(403);
      expect(createSpace).not.toHaveBeenCalled();
    });

    it('отказывает админ-уровневой роли без отдела в создании пространства', async () => {
      const createSpace = jest.fn();
      const handlers = buildHandlers({
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: null }),
        createSpace,
      });
      const r = res();
      await handlers.createSpace(
        { user: { id: 'u1', role: 'ADMIN' }, body: { name: 'Продажи' } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(403);
      expect(createSpace).not.toHaveBeenCalled();
    });

    it('отклоняет создание пространства с пустым названием', async () => {
      const createSpace = jest.fn();
      const handlers = buildHandlers({ createSpace });
      const r = res();
      await handlers.createSpace(
        { user: { id: 'u1', role: 'HEAD' }, body: { name: '   ' } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(400);
      expect(createSpace).not.toHaveBeenCalled();
    });

    it('глава переименовывает пространство своего отдела', async () => {
      const updateSpace = jest.fn().mockResolvedValue({
        _id: SPACE_SALES_ID,
        name: 'Новое имя',
        allowedDepartments: [DEPARTMENT_ID],
        enabled: true,
      });
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getSpaceById: jest.fn().mockResolvedValue({
          _id: SPACE_SALES_ID,
          allowedDepartments: [DEPARTMENT_ID],
        }),
        updateSpace,
      });
      const r = res();
      await handlers.updateSpace(
        {
          user: { id: 'u1', role: 'HEAD' },
          params: { id: SPACE_SALES_ID },
          body: { name: 'Новое имя' },
        } as never,
        r,
      );
      expect(updateSpace).toHaveBeenCalledWith(SPACE_SALES_ID, { name: 'Новое имя' });
      expect(r.status).toHaveBeenCalledWith(200);
    });

    it('отказывает главе в правке чужого пространства', async () => {
      const updateSpace = jest.fn();
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getSpaceById: jest.fn().mockResolvedValue({
          _id: SPACE_HR_ID,
          allowedDepartments: ['другой-отдел'],
        }),
        updateSpace,
      });
      const r = res();
      await handlers.updateSpace(
        {
          user: { id: 'u1', role: 'HEAD' },
          params: { id: SPACE_HR_ID },
          body: { name: 'Новое имя' },
        } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(403);
      expect(updateSpace).not.toHaveBeenCalled();
    });

    it('отказывает обычному сотруднику в правке пространства, даже если оно доступно ему на запись', async () => {
      const updateSpace = jest.fn();
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getSpaceById: jest.fn().mockResolvedValue({
          _id: SPACE_SALES_ID,
          allowedDepartments: [DEPARTMENT_ID],
        }),
        updateSpace,
      });
      const r = res();
      await handlers.updateSpace(
        {
          user: { id: 'u1', role: 'USER' },
          params: { id: SPACE_SALES_ID },
          body: { name: 'Новое имя' },
        } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(403);
      expect(updateSpace).not.toHaveBeenCalled();
    });

    it('возвращает 404 при правке несуществующего пространства', async () => {
      const handlers = buildHandlers({ getSpaceById: jest.fn().mockResolvedValue(null) });
      const r = res();
      await handlers.updateSpace(
        {
          user: { id: 'u1', role: 'HEAD' },
          params: { id: SPACE_SALES_ID },
          body: { name: 'Новое имя' },
        } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(404);
    });

    it('удаляет пустое пространство своего отдела', async () => {
      const deleteSpace = jest.fn().mockResolvedValue(true);
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getSpaceById: jest.fn().mockResolvedValue({
          _id: SPACE_SALES_ID,
          allowedDepartments: [DEPARTMENT_ID],
        }),
        deleteSpace,
      });
      const r = res();
      await handlers.deleteSpace(
        { user: { id: 'u1', role: 'HEAD' }, params: { id: SPACE_SALES_ID } } as never,
        r,
      );
      expect(deleteSpace).toHaveBeenCalledWith(SPACE_SALES_ID);
      expect(r.status).toHaveBeenCalledWith(200);
    });

    it('отвечает 409, если в пространстве остались документы', async () => {
      const deleteSpace = jest
        .fn()
        .mockRejectedValue(new KnowledgeSpaceNotEmptyError(2));
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getSpaceById: jest.fn().mockResolvedValue({
          _id: SPACE_SALES_ID,
          allowedDepartments: [DEPARTMENT_ID],
        }),
        deleteSpace,
      });
      const r = res();
      await handlers.deleteSpace(
        { user: { id: 'u1', role: 'HEAD' }, params: { id: SPACE_SALES_ID } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(409);
      expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ documentCount: 2 }));
    });

    it('отказывает в удалении при некорректном формате id пространства', async () => {
      const handlers = buildHandlers();
      const r = res();
      await handlers.deleteSpace(
        { user: { id: 'u1', role: 'HEAD' }, params: { id: INVALID_ID } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(400);
    });
  });

  describe('безвозвратное удаление документа', () => {
    it('глава удаляет документ в своём пространстве: снимает векторы раньше записи в MongoDB', async () => {
      const order: string[] = [];
      const deleteVectors = jest.fn(async () => {
        order.push('vectors');
      });
      const deleteDocument = jest.fn(async () => {
        order.push('mongo');
        return true;
      });
      const removeOriginal = jest.fn().mockResolvedValue(undefined);
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getDocumentById: jest.fn().mockResolvedValue({
          _id: DOC_ID,
          spaceId: SPACE_SALES_ID,
          file_id: 'f1',
          uploadedBy: 'someone-else',
          storagePath: '/app/uploads/f1.pdf',
        }),
        deleteVectors,
        deleteDocument,
        removeOriginal,
      });
      const r = res();
      await handlers.deleteDocument(
        { user: { id: 'u1', role: 'HEAD' }, params: { id: DOC_ID } } as never,
        r,
      );
      expect(order).toEqual(['vectors', 'mongo']);
      expect(deleteVectors).toHaveBeenCalledWith(
        expect.objectContaining({ fileIds: ['f1'], entityId: SPACE_SALES_ID }),
      );
      expect(removeOriginal).toHaveBeenCalledWith('/app/uploads/f1.pdf');
      expect(r.status).toHaveBeenCalledWith(200);
    });

    it('отказывает обычному сотруднику в безвозвратном удалении даже своего документа', async () => {
      const deleteDocument = jest.fn();
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getDocumentById: jest.fn().mockResolvedValue({
          _id: DOC_ID,
          spaceId: SPACE_SALES_ID,
          file_id: 'f1',
          uploadedBy: 'u1',
        }),
        deleteDocument,
      });
      const r = res();
      await handlers.deleteDocument(
        { user: { id: 'u1', role: 'USER' }, params: { id: DOC_ID } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(403);
      expect(deleteDocument).not.toHaveBeenCalled();
    });

    it('отказывает главе в удалении документа чужого пространства', async () => {
      const deleteDocument = jest.fn();
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue([]),
        getDocumentById: jest.fn().mockResolvedValue({
          _id: DOC_ID,
          spaceId: SPACE_HR_ID,
          file_id: 'f1',
          uploadedBy: 'someone-else',
        }),
        deleteDocument,
      });
      const r = res();
      await handlers.deleteDocument(
        { user: { id: 'u1', role: 'HEAD' }, params: { id: DOC_ID } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(403);
      expect(deleteDocument).not.toHaveBeenCalled();
    });

    it('отвечает 502 и не трогает MongoDB, если снять векторы не удалось', async () => {
      const deleteDocument = jest.fn();
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getDocumentById: jest.fn().mockResolvedValue({
          _id: DOC_ID,
          spaceId: SPACE_SALES_ID,
          file_id: 'f1',
          uploadedBy: 'u1',
        }),
        deleteVectors: jest.fn().mockRejectedValue(new Error('rag down')),
        deleteDocument,
      });
      const r = res();
      await handlers.deleteDocument(
        { user: { id: 'u1', role: 'HEAD' }, params: { id: DOC_ID } } as never,
        r,
      );
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(r.status).toHaveBeenCalledWith(502);
    });

    it('отвечает 404 на несуществующем документе', async () => {
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        getDocumentById: jest.fn().mockResolvedValue(null),
      });
      const r = res();
      await handlers.deleteDocument(
        { user: { id: 'u1', role: 'HEAD' }, params: { id: DOC_ID } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(404);
    });

    it('отвечает 400 при некорректном формате id документа', async () => {
      const handlers = buildHandlers();
      const r = res();
      await handlers.deleteDocument(
        { user: { id: 'u1', role: 'HEAD' }, params: { id: INVALID_ID } } as never,
        r,
      );
      expect(r.status).toHaveBeenCalledWith(400);
    });
  });

  describe('архивные документы в списке (includeArchived)', () => {
    it('без includeArchived отдаёт только активные', async () => {
      const listDocuments = jest.fn().mockResolvedValue([]);
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        listDocuments,
      });
      const r = res();
      await handlers.listDocuments(
        {
          user: { id: 'u1', role: 'HEAD' },
          params: { id: SPACE_SALES_ID },
          query: {},
        } as never,
        r,
      );
      expect(listDocuments).toHaveBeenCalledWith({ spaceId: SPACE_SALES_ID, status: 'active' });
    });

    it('с includeArchived глава пространства получает все статусы', async () => {
      const listDocuments = jest.fn().mockResolvedValue([]);
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        listDocuments,
      });
      const r = res();
      await handlers.listDocuments(
        {
          user: { id: 'u1', role: 'HEAD' },
          params: { id: SPACE_SALES_ID },
          query: { includeArchived: 'true' },
        } as never,
        r,
      );
      expect(listDocuments).toHaveBeenCalledWith({ spaceId: SPACE_SALES_ID });
    });

    it('includeArchived не действует для обычного сотрудника без права управления', async () => {
      const listDocuments = jest.fn().mockResolvedValue([]);
      const handlers = buildHandlers({
        resolveWritableSpaces: jest.fn().mockResolvedValue(readable),
        listDocuments,
      });
      const r = res();
      await handlers.listDocuments(
        {
          user: { id: 'u1', role: 'USER' },
          params: { id: SPACE_SALES_ID },
          query: { includeArchived: 'true' },
        } as never,
        r,
      );
      expect(listDocuments).toHaveBeenCalledWith({ spaceId: SPACE_SALES_ID, status: 'active' });
    });
  });
});
