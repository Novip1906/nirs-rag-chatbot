import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KnowledgeDocumentItem, KnowledgeSpaceSummary } from 'librechat-data-provider';
import type { EmployeeDocumentUploadInput } from '~/data-provider/Knowledge';
import UploadDialog from '../UploadDialog';
import {
  useEmployeeDocumentsQuery,
  useUploadEmployeeKnowledgeDocumentMutation,
} from '~/data-provider/Knowledge';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) => {
    const translations = jest.requireActual('~/locales/ru/translation.json') as Record<
      string,
      string
    >;
    const template = translations[key] ?? key;
    if (values == null) {
      return template;
    }
    return template.replace(/{{\s*(\w+)\s*}}/g, (match: string, name: string) =>
      name in values ? String(values[name]) : match,
    );
  },
}));

jest.mock('~/data-provider/Knowledge', () => ({
  useUploadEmployeeKnowledgeDocumentMutation: jest.fn(),
  useEmployeeDocumentsQuery: jest.fn(),
}));

const mockShowToast = jest.fn();
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const mockUseUploadMutation = useUploadEmployeeKnowledgeDocumentMutation as jest.Mock;
const mockUseEmployeeDocumentsQuery = useEmployeeDocumentsQuery as jest.Mock;

function mockUpload() {
  const upload = jest.fn();
  mockUseUploadMutation.mockImplementation(
    (options?: { onSuccess?: () => void; onError?: () => void }) => ({
      mutate: (variables: { spaceId: string; payload: EmployeeDocumentUploadInput }) => {
        upload(variables.spaceId, variables.payload);
        options?.onSuccess?.();
      },
      isLoading: false,
    }),
  );
  return upload;
}

function mockUploadFailure(error: unknown) {
  mockUseUploadMutation.mockImplementation((options?: { onError?: (error: unknown) => void }) => ({
    mutate: () => options?.onError?.(error),
    isLoading: false,
  }));
}

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface RenderArgs {
  spaces: Array<Partial<KnowledgeSpaceSummary> & { id: string; name: string; canWrite: boolean }>;
  /** По умолчанию `spaceId` каждого документа — первое переданное пространство. */
  documents?: Array<Partial<KnowledgeDocumentItem> & { id: string; title: string }>;
  defaultSpaceId?: string;
  initialTitle?: string;
  initialSupersedesId?: string;
}

function renderUploadDialog({
  spaces,
  documents = [],
  defaultSpaceId,
  initialTitle,
  initialSupersedesId,
  onOpenChange = jest.fn(),
}: RenderArgs & { onOpenChange?: (open: boolean) => void }) {
  const fullSpaces: KnowledgeSpaceSummary[] = spaces.map((space) => ({
    allowedDepartments: [],
    enabled: true,
    canManage: false,
    ...space,
  }));
  const fullDocuments: KnowledgeDocumentItem[] = documents.map((doc) => ({
    spaceId: fullSpaces[0]?.id ?? '',
    fileId: '',
    description: '',
    filename: '',
    source: '',
    owner: '',
    uploadedBy: 'someone-else',
    version: '',
    effectiveDate: null,
    status: 'active',
    embeddingModel: '',
    bytes: 0,
    mimetype: '',
    embedded: false,
    createdAt: new Date(0).toISOString(),
    ...doc,
  }));

  // Тот же запрос, что использует список документов — параметризован пространством,
  // поэтому мок должен отвечать по конкретному переданному spaceId, а не глобально.
  mockUseEmployeeDocumentsQuery.mockImplementation((spaceId?: string | null) => ({
    data: fullDocuments.filter((doc) => doc.spaceId === spaceId),
    isLoading: false,
    isError: false,
  }));

  return render(
    <UploadDialog
      open
      onOpenChange={onOpenChange}
      spaces={fullSpaces}
      defaultSpaceId={defaultSpaceId ?? fullSpaces.find((space) => space.canWrite)?.id ?? ''}
      initialTitle={initialTitle}
      initialSupersedesId={initialSupersedesId}
    />,
  );
}

async function selectFile(filename: string) {
  const file = new File(['content'], filename, { type: 'application/pdf' });
  const input = screen.getByLabelText(/файл/i);
  await userEvent.upload(input, file);
}

describe('UploadDialog', () => {
  beforeEach(() => {
    mockUseUploadMutation.mockReset();
    mockUseUploadMutation.mockReturnValue({ mutate: jest.fn(), isLoading: false });
    mockUseEmployeeDocumentsQuery.mockReset();
    mockUseEmployeeDocumentsQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockShowToast.mockReset();
  });

  it('подставляет имя файла в название и сегодняшнюю дату', async () => {
    renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }] });
    await selectFile('Регламент эквайринга.pdf');

    expect(screen.getByLabelText(/название/i)).toHaveValue('Регламент эквайринга');
    expect(screen.getByLabelText(/актуален на/i)).toHaveValue(todayIso());
  });

  it('подставляет сегодняшнюю дату по местному времени, а не по UTC', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 29, 0, 30, 0));
    try {
      renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }] });
      expect(screen.getByLabelText(/актуален на/i)).toHaveValue('2026-08-29');
    } finally {
      jest.useRealTimers();
    }
  });

  it('при совпадении названия предлагает заменить существующий документ', async () => {
    renderUploadDialog({
      spaces: [{ id: 's1', name: 'Продажи', canWrite: true }],
      documents: [{ id: 'd1', title: 'Регламент эквайринга' }],
    });
    await selectFile('Регламент эквайринга.pdf');

    expect(
      await screen.findByText(/новая версия документа «Регламент эквайринга»/i),
    ).toBeInTheDocument();
  });

  it('при выборе «новая версия» отправляет supersedesId', async () => {
    const upload = mockUpload();
    renderUploadDialog({
      spaces: [{ id: 's1', name: 'Продажи', canWrite: true }],
      documents: [{ id: 'd1', title: 'Регламент эквайринга' }],
    });
    await selectFile('Регламент эквайринга.pdf');
    await userEvent.click(screen.getByRole('button', { name: /заменить/i }));
    await userEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    expect(upload).toHaveBeenCalledWith('s1', expect.objectContaining({ supersedesId: 'd1' }));
  });

  it('при выборе «сохранить отдельно» не подставляет supersedesId', async () => {
    const upload = mockUpload();
    renderUploadDialog({
      spaces: [{ id: 's1', name: 'Продажи', canWrite: true }],
      documents: [{ id: 'd1', title: 'Регламент эквайринга' }],
    });
    await selectFile('Регламент эквайринга.pdf');
    await userEvent.click(screen.getByRole('button', { name: /сохранить отдельно/i }));
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));

    expect(upload).toHaveBeenCalledWith('s1', expect.objectContaining({ supersedesId: undefined }));
  });

  it('не даёт выбрать пространство, недоступное на запись', async () => {
    renderUploadDialog({
      spaces: [
        { id: 's1', name: 'Продажи', canWrite: true },
        { id: 's2', name: 'HR', canWrite: true },
        { id: 's3', name: 'Общее', canWrite: false },
      ],
    });
    await userEvent.click(screen.getByLabelText(/пространство/i));
    expect(screen.queryByRole('option', { name: 'Общее' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Продажи' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'HR' })).toBeInTheDocument();
  });

  it('не показывает выбор пространства, если доступно на запись только одно', async () => {
    const upload = mockUpload();
    renderUploadDialog({
      spaces: [
        { id: 's1', name: 'Продажи', canWrite: true },
        { id: 's2', name: 'Общее', canWrite: false },
      ],
      defaultSpaceId: 's1',
    });
    expect(screen.queryByLabelText(/пространство/i)).not.toBeInTheDocument();

    await selectFile('x.pdf');
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));

    expect(upload).toHaveBeenCalledWith('s1', expect.any(Object));
  });

  it('обрезает пробелы у описания перед отправкой', async () => {
    const upload = mockUpload();
    renderUploadDialog({
      spaces: [{ id: 's1', name: 'Продажи', canWrite: true }],
      defaultSpaceId: 's1',
    });
    await selectFile('x.pdf');
    await userEvent.type(screen.getByLabelText(/описание/i), '  важные реквизиты  ');
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));

    expect(upload).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ description: 'важные реквизиты' }),
    );
  });

  it('совпадение названия ищется по документам выбранного, а не первоначального пространства', async () => {
    renderUploadDialog({
      spaces: [
        { id: 's1', name: 'Продажи', canWrite: true },
        { id: 's2', name: 'HR', canWrite: true },
      ],
      documents: [{ id: 'd2', title: 'Регламент HR', spaceId: 's2' }],
      defaultSpaceId: 's1',
    });

    await selectFile('Регламент HR.pdf');
    expect(screen.queryByText(/новая версия документа/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/пространство/i));
    await userEvent.click(screen.getByRole('option', { name: 'HR' }));

    expect(await screen.findByText(/новая версия документа «Регламент HR»/i)).toBeInTheDocument();
  });

  it('кнопка «новая версия» открывает диалог с подставленными названием и supersedesId', async () => {
    const upload = mockUpload();
    renderUploadDialog({
      spaces: [{ id: 's1', name: 'Продажи', canWrite: true }],
      documents: [{ id: 'd1', title: 'Регламент эквайринга' }],
      defaultSpaceId: 's1',
      initialTitle: 'Регламент эквайринга',
      initialSupersedesId: 'd1',
    });

    expect(screen.getByLabelText(/название/i)).toHaveValue('Регламент эквайринга');
    expect(screen.queryByText(/новая версия документа/i)).not.toBeInTheDocument();

    const file = new File(['content'], 'x.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/файл/i), file);
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));

    expect(upload).toHaveBeenCalledWith('s1', expect.objectContaining({ supersedesId: 'd1' }));
  });

  it('отклоняет файл больше 25 МБ до отправки', async () => {
    const upload = mockUpload();
    renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }] });
    const file = new File(['content'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 26 * 1024 * 1024 });

    await userEvent.upload(screen.getByLabelText(/файл/i), file);

    expect(screen.getByRole('alert')).toHaveTextContent('Файл превышает лимит в 25 МБ.');
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));
    expect(upload).not.toHaveBeenCalled();
  });

  it('отклоняет неподдерживаемое расширение файла до отправки', async () => {
    renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }] });
    const file = new File(['content'], 'вирус.exe', { type: 'application/octet-stream' });

    // `accept` на input сам отфильтровал бы это расширение в реальном браузере — здесь эта
    // фильтрация намеренно отключена, чтобы проверить клиентскую проверку, а не только
    // фильтр диалога выбора файла (сотрудник может выбрать «Все файлы»).
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(screen.getByLabelText(/файл/i), file);

    expect(screen.getByRole('alert')).toHaveTextContent('Такой тип файла не поддерживается.');
  });

  it('показывает содержательный текст ошибки, который прислал сервер', async () => {
    mockUploadFailure({
      response: {
        data: {
          error:
            'В документе почти нет текста. Возможно, это скан или файл с изображениями — распознайте текст и загрузите снова.',
        },
      },
    });
    renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }] });
    await selectFile('скан.pdf');
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        message:
          'В документе почти нет текста. Возможно, это скан или файл с изображениями — распознайте текст и загрузите снова.',
      }),
    );
  });

  it('переводит известный англоязычный ответ сервера вместо показа английской строки', async () => {
    mockUploadFailure({ response: { data: { error: 'File exceeds the 25 MB limit' } } });
    renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }] });
    await selectFile('x.pdf');
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', message: 'Файл превышает лимит в 25 МБ.' }),
    );
  });

  it('показывает общее сообщение, если сервер не прислал текст ошибки', async () => {
    mockUploadFailure(new Error('network down'));
    renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }] });
    await selectFile('x.pdf');
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', message: 'Не удалось загрузить документ' }),
    );
  });

  it('во время отправки блокирует кнопку сохранения, скрывает отмену и поясняет, что окно закрывать не нужно', () => {
    mockUseUploadMutation.mockReturnValue({ mutate: jest.fn(), isLoading: true });
    renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }] });

    expect(screen.getByRole('button', { name: /загружаем файл/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^отмена$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/может занять до минуты/i)).toBeInTheDocument();
  });

  it('не закрывает диалог по Escape, пока идёт отправка', async () => {
    const onOpenChange = jest.fn();
    mockUseUploadMutation.mockReturnValue({ mutate: jest.fn(), isLoading: true });
    renderUploadDialog({ spaces: [{ id: 's1', name: 'Продажи', canWrite: true }], onOpenChange });

    await userEvent.keyboard('{Escape}');

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('переключает подпись кнопки с «загружаем файл» на «обрабатываем документ», когда файл уже отправлен', async () => {
    const upload = jest.fn();
    // `isLoading` реального react-query становится `true` только после вызова `mutate` —
    // здесь это же поведение воспроизведено вручную, чтобы кнопку вообще можно было нажать.
    const mutationState = { isLoading: false };
    let capturedOnUploadProgress: ((event: { loaded: number; total: number }) => void) | undefined;
    mockUseUploadMutation.mockImplementation(() => ({
      mutate: (variables: {
        spaceId: string;
        payload: EmployeeDocumentUploadInput;
        onUploadProgress?: (event: { loaded: number; total: number }) => void;
      }) => {
        mutationState.isLoading = true;
        upload(variables.spaceId, variables.payload);
        capturedOnUploadProgress = variables.onUploadProgress;
      },
      isLoading: mutationState.isLoading,
    }));
    renderUploadDialog({
      spaces: [{ id: 's1', name: 'Продажи', canWrite: true }],
      defaultSpaceId: 's1',
    });
    await selectFile('x.pdf');
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));

    expect(upload).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /загружаем файл/i })).toBeInTheDocument();

    await act(async () => {
      capturedOnUploadProgress?.({ loaded: 1, total: 1 });
    });

    expect(screen.getByRole('button', { name: /обрабатываем документ/i })).toBeInTheDocument();
  });
});
