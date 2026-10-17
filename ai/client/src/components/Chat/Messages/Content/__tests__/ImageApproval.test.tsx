import React from 'react';
import { RecoilRoot } from 'recoil';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MutableSnapshot } from 'recoil';
import type { Agents } from 'librechat-data-provider';
import ApprovalProvider from '../ApprovalContext';
import { ChatContext } from '~/Providers/ChatContext';
import ImageApproval from '../ImageApproval';
import store from '~/store';

const mockApprovalMutate = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string | number, string | number>) => {
    const map: Record<string, string> = {
      com_ui_image_approval_title: 'Создать картинку?',
      com_ui_image_approval_format: 'Формат',
      com_ui_image_approval_generate: 'Создать',
      com_ui_image_ratio_square: 'Квадрат',
      com_ui_image_ratio_landscape: 'Горизонтальный',
      com_ui_image_ratio_portrait: 'Вертикальный',
      com_ui_cancel: 'Отмена',
    };
    if (key === 'com_ui_image_approval_sources') {
      return `Исходных картинок: ${values?.[0]}`;
    }
    return map[key] ?? key;
  },
}));

jest.mock('~/data-provider', () => ({
  useSubmitToolApprovalMutation: () => ({ mutate: mockApprovalMutate }),
  useSubmitAskAnswerMutation: () => ({ mutate: jest.fn() }),
}));

jest.mock('~/store/agents', () => ({
  useGetEphemeralAgent: () => () => undefined,
}));

const chatContextValue = {
  conversation: { conversationId: 'conversation-1', endpoint: 'agents' },
} as unknown as React.ContextType<typeof ChatContext>;

const approval: NonNullable<Agents.ToolCall['approval']> = {
  actionId: 'action-1',
  allowed_decisions: ['approve', 'edit', 'reject'],
};

function renderCard(args: Record<string, unknown>) {
  const initializeState = (snapshot: MutableSnapshot) => {
    snapshot.set(store.activeGenerationCreatedAtByConvoId('conversation-1'), 1000);
  };
  return render(
    <RecoilRoot initializeState={initializeState}>
      <ChatContext.Provider value={chatContextValue}>
        <ApprovalProvider>
          <ImageApproval
            approval={approval}
            toolCallId="call-1"
            args={JSON.stringify(args)}
            fallback={<span data-testid="image-progress" />}
          />
        </ApprovalProvider>
      </ChatContext.Provider>
    </RecoilRoot>,
  );
}

function submittedDecision(): Agents.ToolApprovalResolution {
  return mockApprovalMutate.mock.calls[0][0].decisions[0];
}

describe('ImageApproval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('не показывает текст запроса и подтверждает одним нажатием', () => {
    renderCard({ prompt: 'Рыжий кот', aspect_ratio: '16:9' });

    expect(screen.queryByText('Рыжий кот')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Горизонтальный 16:9' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(mockApprovalMutate).toHaveBeenCalledTimes(1);
    expect(submittedDecision()).toEqual({ tool_call_id: 'call-1', decision: 'approve' });
  });

  test('смена формата уходит решением edit с исходным запросом', () => {
    renderCard({ prompt: 'Рыжий кот', image_ids: ['img-1'] });

    expect(screen.getByText('Исходных картинок: 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Вертикальный 9:16' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(submittedDecision()).toEqual({
      tool_call_id: 'call-1',
      decision: 'edit',
      editedArguments: { prompt: 'Рыжий кот', aspect_ratio: '9:16', image_ids: ['img-1'] },
    });
  });

  test('неизвестный формат от модели заменяется квадратом и уходит правкой', () => {
    renderCard({ prompt: 'Рыжий кот', aspect_ratio: '5:1' });

    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(submittedDecision()).toEqual({
      tool_call_id: 'call-1',
      decision: 'edit',
      editedArguments: { prompt: 'Рыжий кот', aspect_ratio: '1:1' },
    });
  });

  test('отмена уходит отказом', () => {
    renderCard({ prompt: 'Рыжий кот' });

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(submittedDecision()).toMatchObject({ tool_call_id: 'call-1', decision: 'reject' });
  });
});
