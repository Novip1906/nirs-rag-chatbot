import React from 'react';
import { RecoilRoot } from 'recoil';
import { act, render, screen } from '@testing-library/react';
import { WAVE_DOTS } from '~/utils/audio/level';
import AudioRecorder from '../AudioRecorder';
import { mainTextareaId } from '~/common';
import store from '~/store';

let mockSpeechToTextEndpoint = 'browser';
let mockBrowserIsListening = false;
let mockExternalIsListening = false;
let mockExternalIsTranscribing = false;
let mockExternalCanRetry = false;
let mockDraft = 'existing draft';
const mockRetryExternal = jest.fn();
let mockSetText: ((text: string) => void) | undefined;

const mockStartSpeechRecordingBrowser = jest.fn();
const mockStopSpeechRecordingBrowser = jest.fn();
const mockCancelSpeechRecordingBrowser = jest.fn();
const mockStartSpeechRecordingExternal = jest.fn();
const mockStopSpeechRecordingExternal = jest.fn();
const mockCancelSpeechRecordingExternal = jest.fn();
const mockSetValue = jest.fn();
const mockReset = jest.fn();
const mockGetValues = jest.fn(() => mockDraft);
const mockAsk = jest.fn(() => true);

type MockButtonProps = React.ComponentProps<'button'> & {
  label?: string;
  variant?: string;
  size?: string;
  shape?: string;
};

jest.mock('@librechat/client', () => ({
  IconButton: ({
    children,
    label,
    variant: _variant,
    size: _size,
    shape: _shape,
    ...props
  }: MockButtonProps) => (
    <button aria-label={label} {...props}>
      {children}
    </button>
  ),
  TooltipAnchor: ({ render }: { render: React.ReactElement }) => render,
  ListeningIcon: () => <span />,
  Spinner: () => <span />,
  useToastContext: () => ({ showToast: jest.fn() }),
  useMediaQuery: () => false,
}));

jest.mock('~/hooks/Input/useSpeechToTextBrowser', () => ({
  __esModule: true,
  default: (setText: (text: string) => void) => {
    mockSetText = setText;
    return {
      isListening: mockBrowserIsListening,
      isLoading: false,
      startRecording: mockStartSpeechRecordingBrowser,
      stopRecording: mockStopSpeechRecordingBrowser,
      cancelRecording: mockCancelSpeechRecordingBrowser,
    };
  },
}));

jest.mock('~/hooks/Input/useSpeechToTextExternal', () => ({
  __esModule: true,
  default: (setText: (text: string) => void) => {
    mockSetText = setText;
    return {
      isListening: mockExternalIsListening,
      isLoading: false,
      isTranscribing: mockExternalIsTranscribing,
      stream: null,
      canRetry: mockExternalCanRetry,
      retry: mockRetryExternal,
      externalStartRecording: mockStartSpeechRecordingExternal,
      externalStopRecording: mockStopSpeechRecordingExternal,
      externalCancelRecording: mockCancelSpeechRecordingExternal,
    };
  },
}));

jest.mock('~/hooks/Input/useGetAudioSettings', () => ({
  __esModule: true,
  default: () => ({ speechToTextEndpoint: mockSpeechToTextEndpoint }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useGetAudioSettings: () => ({ speechToTextEndpoint: mockSpeechToTextEndpoint }),
  useSpeechToText: jest.requireActual('~/hooks/Input/useSpeechToText').default,
}));

jest.mock('~/common', () => ({
  ...jest.requireActual('~/common'),
  globalAudioId: 'global-audio',
}));

const dispatchSpeechShortcut = () => {
  const event = new KeyboardEvent('keydown', {
    shiftKey: true,
    altKey: true,
    code: 'KeyL',
    bubbles: true,
    cancelable: true,
  });

  act(() => window.dispatchEvent(event));
  return event;
};

const recorderTree = ({
  disabled = false,
  initialized = true,
  conversationId = 'convo-1',
  onPhaseChange,
}: {
  disabled?: boolean;
  initialized?: boolean;
  conversationId?: string;
  onPhaseChange?: (phase: string) => void;
} = {}) => (
  <RecoilRoot initializeState={({ set }) => set(store.speechSettingsInitialized, initialized)}>
    <form>
      <AudioRecorder
        disabled={disabled}
        ask={mockAsk as never}
        methods={
          {
            setValue: mockSetValue,
            reset: mockReset,
            getValues: mockGetValues,
          } as never
        }
        isSubmitting={false}
        conversationId={conversationId}
        onPhaseChange={onPhaseChange as never}
      />
    </form>
  </RecoilRoot>
);

const renderRecorder = (options: Parameters<typeof recorderTree>[0] = {}) =>
  render(recorderTree(options));

const clickMicrophone = () =>
  act(() => screen.getByRole('button', { name: 'com_ui_use_micrphone' }).click());

const dispatchEscapeOn = (target: EventTarget, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => target.dispatchEvent(event));
  return event;
};

describe('AudioRecorder speech shortcut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeechToTextEndpoint = 'browser';
    mockBrowserIsListening = false;
    mockExternalIsListening = false;
    mockExternalIsTranscribing = false;
    mockExternalCanRetry = false;
    mockDraft = 'existing draft';
    mockSetText = undefined;
  });

  it('preserves the existing draft when browser recording starts from the shortcut', () => {
    renderRecorder();

    const event = dispatchSpeechShortcut();
    act(() => mockSetText?.('transcript'));

    expect(mockStartSpeechRecordingBrowser).toHaveBeenCalledTimes(1);
    expect(mockSetValue).toHaveBeenCalledWith('text', 'existing draft transcript', {
      shouldValidate: true,
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not invoke either recorder while the control is disabled', () => {
    renderRecorder({ disabled: true });

    dispatchSpeechShortcut();

    expect(mockStartSpeechRecordingBrowser).not.toHaveBeenCalled();
    expect(mockStopSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('does not start browser recording before speech settings initialization completes', () => {
    renderRecorder({ initialized: false });

    dispatchSpeechShortcut();

    expect(mockStartSpeechRecordingBrowser).not.toHaveBeenCalled();
    expect(mockStartSpeechRecordingExternal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'com_ui_use_micrphone' })).toBeDisabled();
  });

  it('stops the selected engine from the shortcut', () => {
    mockSpeechToTextEndpoint = 'external';
    mockExternalIsListening = true;
    renderRecorder();

    dispatchSpeechShortcut();

    expect(mockStopSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStopSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('does not stop a recorder while the control is disabled', () => {
    mockSpeechToTextEndpoint = 'external';
    mockExternalIsListening = true;
    renderRecorder({ disabled: true });

    dispatchSpeechShortcut();

    expect(mockStopSpeechRecordingExternal).not.toHaveBeenCalled();
  });
});

describe('AudioRecorder dictation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeechToTextEndpoint = 'external';
    mockBrowserIsListening = false;
    mockExternalIsListening = false;
    mockExternalIsTranscribing = false;
    mockExternalCanRetry = false;
    mockDraft = 'existing draft';
    mockSetText = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('скрывает отсчёт времени до 270-й секунды и показывает оставшееся время после', () => {
    jest.useFakeTimers();
    mockExternalIsListening = true;
    renderRecorder();

    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(269_000);
    });
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('00:30');
    expect(timer).toHaveAttribute('aria-label', 'com_ui_dictation_time_left');
  });

  it('не показывает время, когда запись не идёт', () => {
    renderRecorder();

    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('показывает волну, ✕ и ✓ во время записи и прячет микрофон', () => {
    mockExternalIsListening = true;
    renderRecorder();

    expect(screen.queryByRole('button', { name: 'com_ui_use_micrphone' })).not.toBeInTheDocument();

    const cancelButton = screen.getByRole('button', { name: 'com_ui_dictation_cancel' });
    expect(cancelButton).toHaveAttribute('id', 'audio-recorder-cancel');

    const finishButton = screen.getByRole('button', { name: 'com_ui_dictation_finish' });
    expect(finishButton).toHaveAttribute('id', 'audio-recorder');

    const wave = document.querySelector('[aria-hidden="true"]');
    expect(wave).toBeInTheDocument();
    expect(wave?.children).toHaveLength(WAVE_DOTS);
    expect(wave?.parentElement).toHaveClass('mr-2');
  });

  it('✓ заканчивает запись и отправляет её на распознавание', () => {
    mockExternalIsListening = true;
    renderRecorder();

    act(() => {
      screen.getByRole('button', { name: 'com_ui_dictation_finish' }).click();
    });

    expect(mockStopSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('✕ отменяет запись без распознавания и не трогает черновик', () => {
    mockExternalIsListening = true;
    renderRecorder();

    act(() => {
      screen.getByRole('button', { name: 'com_ui_dictation_cancel' }).click();
    });

    expect(mockCancelSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStopSpeechRecordingExternal).not.toHaveBeenCalled();
    expect(mockSetValue).not.toHaveBeenCalled();
  });

  it('✕ в браузерном движке возвращает черновик, бывший до записи', () => {
    mockSpeechToTextEndpoint = 'browser';
    mockDraft = 'до записи';
    const { rerender } = renderRecorder();

    clickMicrophone();

    mockBrowserIsListening = true;
    rerender(recorderTree());

    act(() => mockSetText?.('промежуточный текст'));

    act(() => {
      screen.getByRole('button', { name: 'com_ui_dictation_cancel' }).click();
    });

    expect(mockCancelSpeechRecordingBrowser).toHaveBeenCalledTimes(1);
    expect(mockSetValue).toHaveBeenLastCalledWith('text', 'до записи', {
      shouldValidate: true,
    });
  });

  it('объявляет запись через role="status"', () => {
    mockExternalIsListening = true;
    renderRecorder();

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_dictation_listening');
  });

  it('объявляет распознавание через role="status"', () => {
    mockExternalIsTranscribing = true;
    renderRecorder();

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_dictation_transcribing');
  });

  it('сообщает фазу форме и сбрасывает её в idle при размонтировании', () => {
    const handlePhaseChange = jest.fn();
    mockExternalIsListening = true;
    const { unmount } = renderRecorder({ onPhaseChange: handlePhaseChange });

    expect(handlePhaseChange).toHaveBeenLastCalledWith('listening');

    unmount();

    expect(handlePhaseChange).toHaveBeenLastCalledWith('idle');
  });

  it('повторяет распознавание сохранённой записи и дописывает её к текущему тексту', () => {
    mockExternalCanRetry = true;
    mockGetValues.mockReturnValueOnce('поправленный черновик');
    renderRecorder();

    act(() => {
      screen.getByRole('button', { name: 'com_ui_retry' }).click();
    });
    act(() => mockSetText?.('расшифровка'));

    expect(mockRetryExternal).toHaveBeenCalledTimes(1);
    expect(mockSetValue).toHaveBeenCalledWith('text', 'поправленный черновик расшифровка', {
      shouldValidate: true,
    });
  });

  it('дописывает расшифровку к тексту, набранному во время распознавания', () => {
    mockDraft = 'начало';
    renderRecorder();

    clickMicrophone();
    mockDraft = 'начало и продолжение';
    act(() => mockSetText?.('расшифровка'));

    expect(mockStartSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockSetValue).toHaveBeenLastCalledWith('text', 'начало и продолжение расшифровка', {
      shouldValidate: true,
    });
  });

  it('не возвращает черновик, отправленный до прихода расшифровки', () => {
    mockDraft = 'черновик';
    renderRecorder();

    clickMicrophone();
    mockDraft = '';
    act(() => mockSetText?.('расшифровка'));

    expect(mockSetValue).toHaveBeenLastCalledWith('text', 'расшифровка', {
      shouldValidate: true,
    });
  });

  it('не вставляет расшифровку в другую беседу', () => {
    const { rerender } = renderRecorder({ conversationId: 'convo-1' });

    clickMicrophone();
    rerender(recorderTree({ conversationId: 'convo-2' }));
    act(() => mockSetText?.('расшифровка'));

    expect(mockSetValue).not.toHaveBeenCalled();
  });

  it('не показывает «Повторить», пока повторять нечего', () => {
    renderRecorder();

    expect(screen.queryByRole('button', { name: 'com_ui_retry' })).not.toBeInTheDocument();
  });

  it('прячет «Повторить» во время новой записи', () => {
    mockExternalCanRetry = true;
    mockExternalIsListening = true;
    renderRecorder();

    expect(screen.queryByRole('button', { name: 'com_ui_retry' })).not.toBeInTheDocument();
  });
});

describe('AudioRecorder Escape во время записи', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeechToTextEndpoint = 'external';
    mockBrowserIsListening = false;
    mockExternalIsListening = false;
    mockExternalIsTranscribing = false;
    mockExternalCanRetry = false;
    mockDraft = 'existing draft';
    mockSetText = undefined;
  });

  it('на главном поле отменяет запись один раз, событие отменено, распознавание не вызвано', () => {
    mockExternalIsListening = true;
    const { container } = renderRecorder();

    const textarea = document.createElement('textarea');
    textarea.id = mainTextareaId;
    container.querySelector('form')?.appendChild(textarea);

    const event = dispatchEscapeOn(textarea);

    expect(mockCancelSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStopSpeechRecordingExternal).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('на кнопке ✓ отменяет запись', () => {
    mockExternalIsListening = true;
    renderRecorder();

    const finishButton = screen.getByRole('button', { name: 'com_ui_dictation_finish' });
    dispatchEscapeOn(finishButton);

    expect(mockCancelSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStopSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('на body отменяет запись', () => {
    mockExternalIsListening = true;
    renderRecorder();

    dispatchEscapeOn(document.body);

    expect(mockCancelSpeechRecordingExternal).toHaveBeenCalledTimes(1);
  });

  it('Shift+Esc не отменяет запись', () => {
    mockExternalIsListening = true;
    renderRecorder();

    dispatchEscapeOn(document.body, { shiftKey: true });

    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('повтор клавиши не отменяет запись', () => {
    mockExternalIsListening = true;
    renderRecorder();

    dispatchEscapeOn(document.body, { repeat: true });

    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('не отменяет запись при открытом диалоге', () => {
    mockExternalIsListening = true;
    renderRecorder();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    dispatchEscapeOn(document.body);

    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();

    dialog.remove();
  });

  it('не отменяет запись при фокусе в поле поиска поповера', () => {
    mockExternalIsListening = true;
    const { container } = renderRecorder();

    const input = document.createElement('input');
    container.querySelector('form')?.appendChild(input);

    dispatchEscapeOn(input);

    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('не отменяет запись, если событие уже обработано другим обработчиком', () => {
    mockExternalIsListening = true;
    renderRecorder();

    const preventer = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', preventer, { capture: true });

    dispatchEscapeOn(document.body);

    window.removeEventListener('keydown', preventer, { capture: true });

    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('не отменяет в фазе распознавания', () => {
    mockExternalIsTranscribing = true;
    renderRecorder();

    dispatchEscapeOn(document.body);

    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('снимает обработчик Escape после окончания записи', () => {
    mockExternalIsListening = true;
    const { rerender } = renderRecorder();
    mockExternalIsListening = false;
    rerender(recorderTree());

    dispatchEscapeOn(document.body);

    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();
  });
});
