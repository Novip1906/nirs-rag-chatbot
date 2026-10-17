import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import SpendView from '../SpendView';

const mockUseAdminSpendLogQuery = jest.fn();
const mockUseAdminDepartmentsQuery = jest.fn();
const mockUseAdminUsersQuery = jest.fn();
const mockUseGetModelsQuery = jest.fn();
const mockUseAdminSpendTranscriptQuery = jest.fn();
const mockUseAdminSpendImageQuery = jest.fn();
const mockUseCapabilities = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminSpendLogQuery: (...args: unknown[]) => mockUseAdminSpendLogQuery(...args),
  useAdminDepartmentsQuery: (...args: unknown[]) => mockUseAdminDepartmentsQuery(...args),
  useAdminUsersQuery: (...args: unknown[]) => mockUseAdminUsersQuery(...args),
  useAdminSpendTranscriptQuery: (...args: unknown[]) => mockUseAdminSpendTranscriptQuery(...args),
  useAdminSpendImageQuery: (...args: unknown[]) => mockUseAdminSpendImageQuery(...args),
  useAdminProviderBalanceQuery: () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
}));

jest.mock('~/data-provider/models', () => ({
  useModelsQuery: (...args: unknown[]) => mockUseGetModelsQuery(...args),
}));

/**
 * Только `useCapabilities` подменяется — остальные хуки (`useLocalize`, `useDebounce`
 * и т.д.) остаются настоящими, тест не про них.
 */
jest.mock('~/hooks', () => ({
  ...jest.requireActual('~/hooks'),
  useCapabilities: () => mockUseCapabilities(),
}));

function makeUser(id: string, name: string) {
  return {
    id,
    isInvite: false,
    name,
    email: `${id}@example.com`,
    role: 'USER',
    departmentId: null,
    departmentName: null,
    limits: { dailyCostUsd: null },
    limitsOverride: null,
    allowedModels: [],
    allowedModelsOverride: null,
    defaultModel: null,
    defaultModelOverride: null,
    blocked: false,
    canUploadKnowledge: false,
    spendToday: { costUsd: 0, requests: 0 },
    spendMonth: { costUsd: 0, requests: 0 },
    invitedAt: null,
    allowedSpaces: [],
    deniedSpaces: [],
  };
}

function makeCall(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    model: 'gpt-4o',
    scenario: 'message',
    promptTokens: 1,
    completionTokens: 1,
    costUsd: 1,
    costSource: 'provider',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  const calls = (overrides.calls as ReturnType<typeof makeCall>[]) ?? [makeCall()];
  return {
    id: 'row-1',
    userId: 'u1',
    userName: 'Ivan',
    userEmail: 'ivan@example.com',
    departmentId: null,
    departmentName: null,
    model: 'gpt-4o',
    models: ['gpt-4o'],
    messageId: 'answer-1',
    conversationId: 'conv-1',
    callCount: calls.length,
    promptTokens: 1,
    completionTokens: 1,
    costUsd: 1,
    unknownCostCalls: 0,
    scenario: 'title',
    createdAt: new Date().toISOString(),
    ...overrides,
    calls,
  };
}

beforeEach(() => {
  mockUseCapabilities.mockReturnValue({ capabilities: new Set(['manage:configs']) });
});

describe('SpendView — scenario column', () => {
  beforeEach(() => {
    mockUseAdminDepartmentsQuery.mockReturnValue({ data: [] });
    mockUseAdminUsersQuery.mockReturnValue({
      data: { users: [], total: 0, limit: 200, offset: 0 },
    });
    mockUseGetModelsQuery.mockReturnValue({ data: {} });
    mockUseAdminSpendTranscriptQuery.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });
  });

  it('shows a human-readable scenario label for a known scenario code', () => {
    mockUseAdminSpendLogQuery.mockReturnValue({
      data: { rows: [makeRow({ id: 'row-1', scenario: 'title' })], total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<SpendView />);

    expect(screen.getByText('Title generation')).toBeInTheDocument();
  });

  /**
   * Records written before `scenario` existed carry `''`. Regression guard for the
   * scenario this whole feature exists to fix: the admin must be able to tell an
   * automatic title-generation spend from a genuine user request, and an old record
   * must never render as a blank cell.
   */
  it('treats an empty scenario as an ordinary user request, not a blank cell', () => {
    mockUseAdminSpendLogQuery.mockReturnValue({
      data: { rows: [makeRow({ id: 'row-1', scenario: '' })], total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<SpendView />);

    expect(screen.getByText('User request')).toBeInTheDocument();
  });

  it('labels each scenario row independently in a mixed log', () => {
    mockUseAdminSpendLogQuery.mockReturnValue({
      data: {
        rows: [
          makeRow({ id: 'row-1', scenario: 'message' }),
          makeRow({ id: 'row-2', scenario: 'title' }),
          makeRow({ id: 'row-3', scenario: 'subagent' }),
        ],
        total: 3,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<SpendView />);

    expect(screen.getByText('User request')).toBeInTheDocument();
    expect(screen.getByText('Title generation')).toBeInTheDocument();
    expect(screen.getByText('Subagent work')).toBeInTheDocument();
  });
});

describe('SpendView — filters', () => {
  beforeEach(() => {
    mockUseAdminDepartmentsQuery.mockReturnValue({ data: [] });
    mockUseAdminUsersQuery.mockReturnValue({
      data: { users: [makeUser('u1', 'Ivan Ivanov')], total: 1, limit: 50, offset: 0 },
    });
    mockUseGetModelsQuery.mockReturnValue({ data: {} });
    mockUseAdminSpendTranscriptQuery.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });
    mockUseAdminSpendLogQuery.mockReturnValue({
      data: { rows: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('names each filter so three "All" dropdowns are tellable apart', () => {
    const { container } = render(<SpendView />);

    const labels = Array.from(container.querySelectorAll('label')).map((label) => ({
      text: label.textContent,
      target: label.getAttribute('for'),
    }));

    expect(labels).toEqual(
      expect.arrayContaining([
        { text: 'Department', target: 'admin-spend-filter-department' },
        { text: 'User', target: 'admin-spend-filter-user' },
        { text: 'Model', target: 'admin-spend-filter-model' },
      ]),
    );
  });

  it('starts with an unfiltered roster request', () => {
    render(<SpendView />);

    expect(mockUseAdminUsersQuery).toHaveBeenCalledWith({
      limit: 50,
      offset: 0,
      search: '',
    });
  });

  it('sends what the admin typed to the server so the search covers name and email', async () => {
    render(<SpendView />);

    await userEvent.click(screen.getByRole('combobox', { name: 'User' }));
    await userEvent.type(screen.getByPlaceholderText('Name or email'), 'ivan@');

    await waitFor(() => {
      expect(mockUseAdminUsersQuery).toHaveBeenCalledWith({
        limit: 50,
        offset: 0,
        search: 'ivan@',
      });
    });
  });
});

/**
 * За один ответ модель вызывается несколько раз, и раньше каждый вызов приезжал
 * отдельной строкой журнала. Строка теперь равна одному обращению сотрудника, а
 * вызовы и сама переписка раскрываются внутри неё.
 */
describe('SpendView — запрос целиком', () => {
  beforeEach(() => {
    mockUseAdminDepartmentsQuery.mockReturnValue({ data: [] });
    mockUseAdminUsersQuery.mockReturnValue({
      data: { users: [], total: 0, limit: 200, offset: 0 },
    });
    mockUseGetModelsQuery.mockReturnValue({ data: {} });
    mockUseAdminSpendTranscriptQuery.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });
  });

  function showRow(overrides: Partial<Record<string, unknown>> = {}) {
    mockUseAdminSpendLogQuery.mockReturnValue({
      data: { rows: [makeRow(overrides)], total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    return render(<SpendView />);
  }

  it('показывает число вызовов внутри запроса', () => {
    showRow({
      callCount: 3,
      calls: [makeCall(), makeCall(), makeCall({ scenario: 'title' })],
    });

    expect(screen.getByRole('columnheader', { name: 'Calls' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument();
  });

  it('не грузит переписку, пока строку не раскрыли', () => {
    showRow();

    expect(mockUseAdminSpendTranscriptQuery).not.toHaveBeenCalled();
  });

  it('по раскрытию показывает вопрос сотрудника и ответ модели', async () => {
    mockUseAdminSpendTranscriptQuery.mockReturnValue({
      data: {
        messageId: 'answer-1',
        conversationId: 'conv-1',
        conversationTitle: 'Тарифы',
        question: 'Какая ставка для маркетплейсов?',
        answer: 'Ставка 2,9 %.',
      },
      isLoading: false,
      isError: false,
    });
    showRow();

    await userEvent.click(screen.getByRole('button', { name: 'Show the exchange' }));

    expect(screen.getByText('Какая ставка для маркетплейсов?')).toBeInTheDocument();
    expect(screen.getByText('Ставка 2,9 %.')).toBeInTheDocument();
    expect(mockUseAdminSpendTranscriptQuery).toHaveBeenCalledWith('answer-1');
  });

  it('по раскрытию показывает запрос к картинке и саму картинку', async () => {
    const createObjectURL = jest.fn(() => 'blob:image-1');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    mockUseAdminSpendImageQuery.mockReturnValue({
      data: new Blob(['img'], { type: 'image/jpeg' }),
      isLoading: false,
      isError: false,
    });
    mockUseAdminSpendTranscriptQuery.mockReturnValue({
      data: {
        messageId: 'answer-1',
        question: 'Нарисуй кота',
        answer: 'Готово.',
        images: [
          {
            fileId: 'file-1',
            prompt: 'Рыжий кот на подоконнике',
            model: 'openai/gpt-5.4-image-2',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    showRow({ calls: [makeCall(), makeCall({ scenario: 'image_gen', costSource: 'estimate' })] });

    await userEvent.click(screen.getByRole('button', { name: 'Show the exchange' }));

    expect(screen.getByText('Рыжий кот на подоконнике')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Рыжий кот на подоконнике' })).toHaveAttribute(
      'src',
      'blob:image-1',
    );
    expect(mockUseAdminSpendImageQuery).toHaveBeenCalledWith('answer-1', 'file-1');
    expect(screen.getByText('Image generation')).toBeInTheDocument();
  });

  it('по раскрытию показывает разбивку по вызовам', async () => {
    showRow({
      model: 'anthropic/claude-haiku-4.5',
      models: ['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash-lite'],
      callCount: 2,
      calls: [
        makeCall({ model: 'anthropic/claude-haiku-4.5', scenario: 'message' }),
        makeCall({ model: 'google/gemini-3.5-flash-lite', scenario: 'title' }),
      ],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Show the exchange' }));

    expect(screen.getByText('Model calls inside this request')).toBeInTheDocument();
    expect(screen.getByText('google/gemini-3.5-flash-lite')).toBeInTheDocument();
  });

  /** Служебные записи вроде индексации базы знаний переписки не имеют. */
  it('объясняет отсутствие переписки у служебной записи вместо пустого блока', async () => {
    showRow({ messageId: undefined, scenario: 'kb_index' });

    await userEvent.click(screen.getByRole('button', { name: 'Show the exchange' }));

    expect(
      screen.getByText(
        'A service record with no exchange — knowledge-base indexing, for instance.',
      ),
    ).toBeInTheDocument();
    expect(mockUseAdminSpendTranscriptQuery).not.toHaveBeenCalled();
  });
});

/**
 * Отделы требуют `manage:configs` — сервер отвечает 403 главе отдела. Без гейта фильтр
 * «Отдел» рисовался бы с единственным пунктом «Все», и запрос всё равно уходил бы.
 */
describe('SpendView — глава отдела без manage:configs', () => {
  beforeEach(() => {
    mockUseCapabilities.mockReturnValue({ capabilities: new Set(['read:usage']) });
    mockUseAdminDepartmentsQuery.mockReturnValue({ data: undefined });
    mockUseAdminUsersQuery.mockReturnValue({
      data: { users: [], total: 0, limit: 50, offset: 0 },
    });
    mockUseGetModelsQuery.mockReturnValue({ data: {} });
    mockUseAdminSpendLogQuery.mockReturnValue({
      data: { rows: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('не запускает запрос отделов и прячет фильтр «Отдел»', () => {
    const { container } = render(<SpendView />);

    expect(mockUseAdminDepartmentsQuery).toHaveBeenCalledWith({ enabled: false });

    const labels = Array.from(container.querySelectorAll('label')).map(
      (label) => label.textContent,
    );
    expect(labels).not.toContain('Department');
    expect(labels).toContain('Model');
  });
});
