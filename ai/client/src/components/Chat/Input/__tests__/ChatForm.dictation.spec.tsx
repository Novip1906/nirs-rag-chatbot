import React, { useMemo, useState } from 'react';
import '@testing-library/jest-dom';
import { DndProvider } from 'react-dnd';
import { useForm } from 'react-hook-form';
import { RecoilRoot, useRecoilState } from 'recoil';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { BrowserRouter as Router } from 'react-router-dom';
import { QueryKeys, EModelEndpoint } from 'librechat-data-provider';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TFile, TConversation } from 'librechat-data-provider';
import type { ChatFormValues } from '~/common';
import { startupConfigKey } from '~/data-provider/Endpoints/queries';
import { ChatContext, ChatFormProvider } from '~/Providers';
import { AuthContextProvider } from '~/hooks/AuthContext';
import ChatForm from '../ChatForm';
import store from '~/store';

type MockExternalEngineState = { isListening: boolean; isTranscribing: boolean };

let mockExternalEngineState: MockExternalEngineState = {
  isListening: false,
  isTranscribing: false,
};
const mockExternalEngineListeners = new Set<() => void>();

const mockSetExternalEngineState = (patch: Partial<MockExternalEngineState>) => {
  mockExternalEngineState = { ...mockExternalEngineState, ...patch };
  mockExternalEngineListeners.forEach((listener) => listener());
};

const mockSubscribeExternalEngine = (listener: () => void) => {
  mockExternalEngineListeners.add(listener);
  return () => mockExternalEngineListeners.delete(listener);
};

jest.mock('~/hooks/Input/useSpeechToTextExternal', () => ({
  __esModule: true,
  default: (setText: (text: string) => void) => {
    void setText;
    const { useSyncExternalStore: mockUseSyncExternalStore } = jest.requireActual(
      'react',
    ) as typeof import('react');
    const state = mockUseSyncExternalStore(
      mockSubscribeExternalEngine,
      () => mockExternalEngineState,
    );
    return {
      isListening: state.isListening,
      isLoading: false,
      isTranscribing: state.isTranscribing,
      stream: null,
      canRetry: false,
      retry: jest.fn(),
      externalStartRecording: jest.fn(),
      externalStopRecording: jest.fn(),
      externalCancelRecording: jest.fn(),
    };
  },
}));

jest.mock('~/hooks/Input/useSpeechToTextBrowser', () => ({
  __esModule: true,
  default: () => ({
    isListening: false,
    isLoading: false,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    cancelRecording: jest.fn(),
  }),
}));

jest.mock('~/hooks/Input/useGetAudioSettings', () => ({
  __esModule: true,
  default: () => ({ speechToTextEndpoint: 'external', textToSpeechEndpoint: 'browser' }),
}));

const conversation = {
  conversationId: 'new',
  endpoint: EModelEndpoint.openAI,
  model: 'gpt-4o',
  title: 'New Chat',
} as TConversation;

const mockAsk = jest.fn();

function Harness() {
  const [files, setFiles] = useRecoilState(store.filesByIndex(0));
  const [isSubmitting] = useRecoilState(store.isSubmittingFamily(0));
  const [, setFilesLoading] = useState(false);
  const methods = useForm<ChatFormValues>({ defaultValues: { text: '' } });

  const chatHelpers = useMemo(
    () =>
      ({
        index: 0,
        conversation,
        setConversation: () => undefined,
        files,
        setFiles,
        isSubmitting,
        setIsSubmitting: () => undefined,
        filesLoading: false,
        setFilesLoading,
        newConversation: () => undefined,
        handleStopGenerating: () => undefined,
        stopGenerating: () => undefined,
        getMessages: () => undefined,
        setMessages: () => undefined,
        ask: mockAsk,
        regenerate: () => undefined,
        setSiblingIdx: () => undefined,
        showPopover: false,
        setShowPopover: () => undefined,
        abortScroll: false,
        setAbortScroll: () => undefined,
        preset: null,
        setPreset: () => undefined,
        optionSettings: {},
        setOptionSettings: () => undefined,
        handleRegenerate: () => undefined,
        handleContinue: () => undefined,
      }) as unknown as React.ContextType<typeof ChatContext>,
    [files, setFiles, isSubmitting],
  );

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <ChatForm index={0} />
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

function renderComposer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData([QueryKeys.fileConfig], {});
  queryClient.setQueryData<TFile[]>([QueryKeys.files], []);
  queryClient.setQueryData([QueryKeys.endpoints], { [EModelEndpoint.openAI]: { order: 0 } });
  queryClient.setQueryData(startupConfigKey(false), { interface: {} });

  return render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <Router>
          <AuthContextProvider authConfig={{ loginRedirect: '', test: true }}>
            <DndProvider backend={HTML5Backend}>
              <Harness />
            </DndProvider>
          </AuthContextProvider>
        </Router>
      </RecoilRoot>
    </QueryClientProvider>,
  );
}

describe('ChatForm плейсхолдер и кнопка отправки во время диктовки', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.URL.createObjectURL = jest.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = jest.fn();
    mockExternalEngineState = { isListening: false, isTranscribing: false };
    mockAsk.mockClear();
  });

  test('во время записи в пустом поле «Слушаю…» показывается один раз через оверлей', async () => {
    mockExternalEngineState = { isListening: true, isTranscribing: false };
    renderComposer();
    const textarea = await screen.findByTestId('text-input');
    const overlay = await screen.findByTestId('dictation-overlay');

    expect(overlay).toHaveTextContent('Listening…');
    expect(textarea).not.toHaveAttribute('placeholder', 'Listening…');
    expect(screen.queryByTestId('send-button')).not.toBeInTheDocument();
    expect(textarea.className.split(/\s+/)).toContain('placeholder:text-transparent');
    expect(overlay.textContent?.match(/Listening…/g)).toHaveLength(1);
  });

  test('во время распознавания поле показывает «Распознаю…», кнопка отправки видна', async () => {
    mockExternalEngineState = { isListening: false, isTranscribing: true };
    renderComposer();
    const textarea = await screen.findByTestId('text-input');

    expect(textarea).toHaveAttribute('placeholder', 'Transcribing…');
    expect(screen.getByTestId('send-button')).toBeInTheDocument();
  });

  test('после записи оверлей исчезает и кнопка отправки восстанавливается', async () => {
    mockExternalEngineState = { isListening: true, isTranscribing: false };
    renderComposer();
    await screen.findByTestId('text-input');
    expect(await screen.findByTestId('dictation-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('send-button')).not.toBeInTheDocument();

    act(() => {
      mockSetExternalEngineState({ isListening: false });
    });

    const textarea = await screen.findByTestId('text-input');
    expect(textarea).not.toHaveAttribute('placeholder', 'Listening…');
    expect(screen.getByTestId('send-button')).toBeInTheDocument();
    expect(screen.queryByTestId('dictation-overlay')).not.toBeInTheDocument();
    expect(textarea.className.split(/\s+/)).not.toContain('placeholder:text-transparent');
  });

  test('черновик остаётся видимым во время записи, «Слушаю…» продолжает его строкой', async () => {
    renderComposer();
    const textarea = await screen.findByTestId('text-input');
    fireEvent.change(textarea, { target: { value: 'мой черновик' } });
    expect(textarea).toHaveValue('мой черновик');

    act(() => {
      mockSetExternalEngineState({ isListening: true });
    });

    const overlay = await screen.findByTestId('dictation-overlay');
    const mirror = await screen.findByTestId('dictation-draft-mirror');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(mirror).toHaveTextContent('мой черновик');
    expect(mirror.className).toMatch(/invisible/);
    expect(overlay).toHaveTextContent('мой черновик Listening…');
    expect(textarea).toHaveValue('мой черновик');
    const classNames = textarea.className.split(/\s+/);
    expect(classNames).not.toContain('text-transparent');
    expect(classNames).not.toContain('caret-transparent');
    expect(classNames).toContain('placeholder:text-transparent');
  });

  test('после отмены записи черновик снова виден и оверлей исчезает', async () => {
    mockExternalEngineState = { isListening: true, isTranscribing: false };
    renderComposer();
    const textarea = await screen.findByTestId('text-input');
    fireEvent.change(textarea, { target: { value: 'мой черновик' } });

    expect(await screen.findByTestId('dictation-overlay')).toHaveTextContent('Listening…');

    act(() => {
      mockSetExternalEngineState({ isListening: false, isTranscribing: false });
    });

    await screen.findByTestId('send-button');
    expect(screen.queryByTestId('dictation-overlay')).not.toBeInTheDocument();
    expect(textarea).toHaveValue('мой черновик');
    expect(textarea.className).not.toMatch(/text-transparent/);
  });

  test('во время распознавания кнопка отправки задизейблена и отправка не проходит', async () => {
    mockExternalEngineState = { isListening: false, isTranscribing: true };
    renderComposer();
    const textarea = await screen.findByTestId('text-input');
    fireEvent.change(textarea, { target: { value: 'черновик для отправки' } });

    const sendButton = await screen.findByTestId('send-button');
    expect(sendButton).toBeDisabled();

    const form = sendButton.closest('form');
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });

    expect(mockAsk).not.toHaveBeenCalled();
  });

  test('после распознавания отправка снова работает', async () => {
    mockExternalEngineState = { isListening: false, isTranscribing: true };
    renderComposer();
    const textarea = await screen.findByTestId('text-input');
    fireEvent.change(textarea, { target: { value: 'черновик для отправки' } });
    await screen.findByTestId('send-button');

    act(() => {
      mockSetExternalEngineState({ isTranscribing: false });
    });

    const sendButton = await screen.findByTestId('send-button');
    expect(sendButton).not.toBeDisabled();

    const form = sendButton.closest('form');
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });

    expect(mockAsk).toHaveBeenCalledTimes(1);
  });
});
