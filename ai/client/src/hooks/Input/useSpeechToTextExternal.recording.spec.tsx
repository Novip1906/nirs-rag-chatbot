import React from 'react';
import { RecoilRoot } from 'recoil';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { act, renderHook, waitFor } from '@testing-library/react';
import useSpeechToTextExternal, { MAX_RECORDING_MS } from './useSpeechToTextExternal';

type MutationOptions = {
  onSuccess?: (data: { text: string }) => void;
  onError?: (error: unknown) => void;
};

const mockMutate = jest.fn();
const mockShowToast = jest.fn();
const mockToWav = jest.fn();
let mockMutationOptions: MutationOptions = {};

jest.mock('~/data-provider', () => ({
  useSpeechToTextMutation: (options: MutationOptions) => {
    mockMutationOptions = options;
    return { mutate: mockMutate, isLoading: false };
  },
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/utils/audio/convert', () => ({
  toWav: (recording: Blob) => mockToWav(recording),
}));

class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];
  static asyncStop = false;

  static isTypeSupported(type: string): boolean {
    return type === 'audio/webm';
  }

  state: RecordingState = 'inactive';

  constructor() {
    super();
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  private emitStopEvents(): void {
    this.dispatchEvent(
      Object.assign(new Event('dataavailable'), {
        data: new Blob(['chunk'], { type: 'audio/webm' }),
      }),
    );
    this.dispatchEvent(new Event('stop'));
  }

  stop(): void {
    this.state = 'inactive';
    if (FakeMediaRecorder.asyncStop) {
      setTimeout(() => this.emitStopEvents(), 0);
      return;
    }
    this.emitStopEvents();
  }
}

const track = { stop: jest.fn() };
const wavBlob = new Blob(['wav'], { type: 'audio/wav' });

type FakeStream = { getTracks: () => Array<typeof track> };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const renderRecorder = (setText: (text: string) => void = jest.fn()) => {
  const jotaiStore = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RecoilRoot>
      <JotaiProvider store={jotaiStore}>{children}</JotaiProvider>
    </RecoilRoot>
  );
  return renderHook(() => useSpeechToTextExternal(setText), { wrapper });
};

type Rendered = ReturnType<typeof renderRecorder>['result'];

const sentAudio = (call: number): File =>
  (mockMutate.mock.calls[call][0] as FormData).get('audio') as File;

const sentLanguage = (call: number): string | null =>
  (mockMutate.mock.calls[call][0] as FormData).get('language') as string | null;

const recordOnce = async (result: Rendered) => {
  const calls = mockMutate.mock.calls.length;
  await act(async () => {
    await result.current.externalStartRecording();
  });
  act(() => result.current.externalStopRecording());
  await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(calls + 1));
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.asyncStop = false;
  mockMutationOptions = {};
  mockToWav.mockResolvedValue(wavBlob);
  Object.defineProperty(window, 'MediaRecorder', {
    value: FakeMediaRecorder,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track] }) },
    configurable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useSpeechToTextExternal', () => {
  it('отправляет запись в WAV под именем audio.wav и отпускает микрофон', async () => {
    const { result } = renderRecorder();

    await act(async () => {
      await result.current.externalStartRecording();
    });
    expect(result.current.isListening).toBe(true);

    act(() => result.current.externalStopRecording());
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));

    expect(mockToWav).toHaveBeenCalledWith(expect.any(Blob));
    expect(sentAudio(0).name).toBe('audio.wav');
    expect(sentAudio(0).type).toBe('audio/wav');
    expect(result.current.isListening).toBe(false);
    expect(track.stop).toHaveBeenCalled();
  });

  it('отправляет язык ru по умолчанию, если в хранилище ничего не сохранено', async () => {
    const { result } = renderRecorder();
    await recordOnce(result);

    expect(sentLanguage(0)).toBe('ru');
  });

  it('отправляет язык en, когда в хранилище сохранён en', async () => {
    localStorage.setItem('dictationLanguage', JSON.stringify('en'));
    const { result } = renderRecorder();
    await recordOnce(result);

    expect(sentLanguage(0)).toBe('en');
  });

  it('нормализует неизвестный сохранённый язык de до ru', async () => {
    localStorage.setItem('dictationLanguage', JSON.stringify('de'));
    const { result } = renderRecorder();
    await recordOnce(result);

    expect(sentLanguage(0)).toBe('ru');
  });

  it('не учитывает старую настройку languageSTT', async () => {
    localStorage.setItem('languageSTT', JSON.stringify('en-US'));
    const { result } = renderRecorder();
    await recordOnce(result);

    expect(sentLanguage(0)).toBe('ru');
  });

  it('сама останавливает и отправляет запись через 5 минут', async () => {
    jest.useFakeTimers();
    const { result } = renderRecorder();

    await act(async () => {
      await result.current.externalStartRecording();
    });
    act(() => {
      jest.advanceTimersByTime(MAX_RECORDING_MS - 1);
    });
    expect(FakeMediaRecorder.instances[0].state).toBe('recording');

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(result.current.isListening).toBe(false);
  });

  it('не обрывает запись по тишине, даже если автораспознавание включено с прошлых сессий', async () => {
    jest.useFakeTimers();
    localStorage.setItem('autoTranscribeAudio', JSON.stringify(true));
    const { result } = renderRecorder();

    await act(async () => {
      await result.current.externalStartRecording();
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(result.current.isListening).toBe(true);
    expect(FakeMediaRecorder.instances[0].state).toBe('recording');
  });

  it('держит запись после сбоя и отправляет её повторно без перекодирования', async () => {
    const { result } = renderRecorder();
    await recordOnce(result);

    act(() =>
      mockMutationOptions.onError?.({
        response: { data: { message: 'Не удалось распознать речь, попробуйте ещё раз' } },
      }),
    );

    expect(result.current.canRetry).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Не удалось распознать речь, попробуйте ещё раз',
      status: 'error',
    });

    act(() => result.current.retry());

    expect(mockMutate).toHaveBeenCalledTimes(2);
    expect(sentAudio(1).name).toBe('audio.wav');
    expect(sentAudio(1).size).toBe(wavBlob.size);
    expect(sentLanguage(1)).toBe('ru');
    expect(mockToWav).toHaveBeenCalledTimes(1);
    expect(result.current.canRetry).toBe(false);
  });

  it('забывает запись после успешной расшифровки и отдаёт текст без пробелов по краям', async () => {
    const setText = jest.fn();
    const { result } = renderRecorder(setText);
    await recordOnce(result);

    act(() => mockMutationOptions.onError?.(new Error('network')));
    expect(mockShowToast).toHaveBeenLastCalledWith({
      message: 'com_ui_speech_failed',
      status: 'error',
    });

    act(() => result.current.retry());
    act(() => mockMutationOptions.onSuccess?.({ text: '  Добрый день  ' }));

    expect(setText).toHaveBeenCalledWith('Добрый день');
    expect(result.current.canRetry).toBe(false);

    act(() => result.current.retry());
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });

  it('сбрасывает сохранённую запись, когда начата новая', async () => {
    const { result } = renderRecorder();
    await recordOnce(result);
    act(() => mockMutationOptions.onError?.(new Error('network')));
    expect(result.current.canRetry).toBe(true);

    await act(async () => {
      await result.current.externalStartRecording();
    });

    expect(result.current.canRetry).toBe(false);
  });

  it('не дописывает пустую расшифровку', async () => {
    const setText = jest.fn();
    const { result } = renderRecorder(setText);
    await recordOnce(result);

    act(() => mockMutationOptions.onSuccess?.({ text: '   ' }));

    expect(setText).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_speech_empty',
      status: 'warning',
    });
  });

  it('при уходе со страницы останавливает запись, отпускает микрофон и ничего не отправляет', async () => {
    track.stop.mockClear();
    const { result, unmount } = renderRecorder();
    await act(async () => {
      await result.current.externalStartRecording();
    });

    unmount();
    await Promise.resolve();

    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
    expect(track.stop).toHaveBeenCalled();
    expect(mockToWav).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('не запускает вторую запись, пока ждёт доступа к микрофону, и показывает занятость', async () => {
    const access = deferred<FakeStream>();
    const getUserMedia = jest.fn(() => access.promise);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    const { result } = renderRecorder();
    const start = result.current.externalStartRecording;

    let pending: Promise<void>[] = [];
    act(() => {
      pending = [start(), start()];
    });
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      access.resolve({ getTracks: () => [track] });
      await Promise.all(pending);
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(result.current.isListening).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('не подмешивает в новую запись звук от прошлого рекордера', async () => {
    const { result } = renderRecorder();
    await recordOnce(result);
    await act(async () => {
      await result.current.externalStartRecording();
    });

    FakeMediaRecorder.instances[0].dispatchEvent(
      Object.assign(new Event('dataavailable'), {
        data: new Blob(['late'], { type: 'audio/webm' }),
      }),
    );
    act(() => result.current.externalStopRecording());
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(2));

    expect((mockToWav.mock.calls[1][0] as Blob).size).toBe('chunk'.length);
  });

  it('ничего не отправляет, если компонент ушёл во время перекодирования', async () => {
    const conversion = deferred<Blob>();
    mockToWav.mockReturnValueOnce(conversion.promise);
    const { result, unmount } = renderRecorder();
    await act(async () => {
      await result.current.externalStartRecording();
    });
    act(() => result.current.externalStopRecording());
    await waitFor(() => expect(mockToWav).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      conversion.resolve(wavBlob);
      await conversion.promise;
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('не пишет расшифровку и не показывает ошибку после ухода компонента', async () => {
    const setText = jest.fn();
    const { result, unmount } = renderRecorder(setText);
    await recordOnce(result);

    unmount();
    act(() => mockMutationOptions.onSuccess?.({ text: 'Поздно' }));
    act(() => mockMutationOptions.onError?.(new Error('network')));

    expect(setText).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('отменяет запись: останавливает рекордер, отпускает микрофон и ничего не отправляет', async () => {
    const { result } = renderRecorder();
    await act(async () => {
      await result.current.externalStartRecording();
    });
    expect(result.current.isListening).toBe(true);

    act(() => result.current.externalCancelRecording());

    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
    expect(result.current.canRetry).toBe(false);
    await Promise.resolve();
    expect(mockToWav).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('следующая запись после отмены отправляется как обычно', async () => {
    const { result } = renderRecorder();
    await act(async () => {
      await result.current.externalStartRecording();
    });
    act(() => result.current.externalCancelRecording());

    await recordOnce(result);

    expect(mockToWav).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('отложенный stop отменённого рекордера не отправляет звук новой записи, начатой сразу после отмены', async () => {
    jest.useFakeTimers();
    FakeMediaRecorder.asyncStop = true;
    const { result } = renderRecorder();

    await act(async () => {
      await result.current.externalStartRecording();
    });
    act(() => result.current.externalCancelRecording());

    await act(async () => {
      await result.current.externalStartRecording();
    });
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(result.current.isListening).toBe(true);

    act(() => {
      jest.advanceTimersByTime(0);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockToWav).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);

    act(() => result.current.externalStopRecording());
    act(() => {
      jest.advanceTimersByTime(0);
    });
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(sentAudio(0).name).toBe('audio.wav');
  });

  it('отдаёт поток микрофона только во время записи', async () => {
    const { result } = renderRecorder();
    expect(result.current.stream).toBeNull();

    await act(async () => {
      await result.current.externalStartRecording();
    });
    expect(result.current.stream).not.toBeNull();

    act(() => result.current.externalStopRecording());
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(result.current.stream).toBeNull();
  });

  it('отдаёт isTranscribing, пока запись перекодируется и отправляется', async () => {
    const conversion = deferred<Blob>();
    mockToWav.mockReturnValueOnce(conversion.promise);
    const { result } = renderRecorder();
    await act(async () => {
      await result.current.externalStartRecording();
    });
    expect(result.current.isTranscribing).toBe(false);

    act(() => result.current.externalStopRecording());
    await waitFor(() => expect(result.current.isTranscribing).toBe(true));

    await act(async () => {
      conversion.resolve(wavBlob);
      await conversion.promise;
    });
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(result.current.isTranscribing).toBe(false);
  });
});
