import { act, renderHook } from '@testing-library/react';
import useSpeechToText from './useSpeechToText';

let mockSpeechToTextEndpoint = 'external';
let mockBrowserIsListening = false;
let mockExternalIsListening = false;
let mockExternalIsTranscribing = false;
let mockExternalStream: MediaStream | null = null;

const mockStartSpeechRecordingBrowser = jest.fn();
const mockStopSpeechRecordingBrowser = jest.fn();
const mockCancelSpeechRecordingBrowser = jest.fn();
const mockStartSpeechRecordingExternal = jest.fn();
const mockStopSpeechRecordingExternal = jest.fn();
const mockCancelSpeechRecordingExternal = jest.fn();

jest.mock('./useGetAudioSettings', () => ({
  __esModule: true,
  default: () => ({ speechToTextEndpoint: mockSpeechToTextEndpoint }),
}));

jest.mock('./useSpeechToTextBrowser', () => ({
  __esModule: true,
  default: () => ({
    isListening: mockBrowserIsListening,
    isLoading: false,
    startRecording: mockStartSpeechRecordingBrowser,
    stopRecording: mockStopSpeechRecordingBrowser,
    cancelRecording: mockCancelSpeechRecordingBrowser,
  }),
}));

jest.mock('./useSpeechToTextExternal', () => ({
  __esModule: true,
  default: () => ({
    isListening: mockExternalIsListening,
    isLoading: false,
    isTranscribing: mockExternalIsTranscribing,
    stream: mockExternalStream,
    externalStartRecording: mockStartSpeechRecordingExternal,
    externalStopRecording: mockStopSpeechRecordingExternal,
    externalCancelRecording: mockCancelSpeechRecordingExternal,
  }),
}));

describe('useSpeechToText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeechToTextEndpoint = 'external';
    mockBrowserIsListening = false;
    mockExternalIsListening = false;
    mockExternalIsTranscribing = false;
    mockExternalStream = null;
  });

  it('selects the externally seeded engine after settings change', () => {
    mockSpeechToTextEndpoint = 'browser';
    const { result, rerender } = renderHook(() => useSpeechToText(jest.fn(), jest.fn()));

    mockSpeechToTextEndpoint = 'external';
    rerender();

    act(() => result.current.startRecording());

    expect(mockStartSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStartSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('selects the browser engine', () => {
    mockSpeechToTextEndpoint = 'browser';
    const { result } = renderHook(() => useSpeechToText(jest.fn(), jest.fn()));

    act(() => result.current.startRecording());

    expect(mockStartSpeechRecordingBrowser).toHaveBeenCalledTimes(1);
    expect(mockStartSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('selects the active engine stop handler', () => {
    mockExternalIsListening = true;
    const { result } = renderHook(() => useSpeechToText(jest.fn(), jest.fn()));

    act(() => result.current.stopRecording());

    expect(mockStopSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStartSpeechRecordingExternal).not.toHaveBeenCalled();
    expect(mockStopSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('отменяет запись внешнего движка', () => {
    mockSpeechToTextEndpoint = 'external';
    const { result } = renderHook(() => useSpeechToText(jest.fn(), jest.fn()));

    act(() => result.current.cancelRecording());

    expect(mockCancelSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockCancelSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('отменяет распознавание браузерного движка', () => {
    mockSpeechToTextEndpoint = 'browser';
    const { result } = renderHook(() => useSpeechToText(jest.fn(), jest.fn()));

    act(() => result.current.cancelRecording());

    expect(mockCancelSpeechRecordingBrowser).toHaveBeenCalledTimes(1);
    expect(mockCancelSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('isTranscribing есть только у внешнего движка', () => {
    mockSpeechToTextEndpoint = 'browser';
    mockExternalIsTranscribing = true;
    const { result, rerender } = renderHook(() => useSpeechToText(jest.fn(), jest.fn()));

    expect(result.current.isTranscribing).toBe(false);

    mockSpeechToTextEndpoint = 'external';
    rerender();

    expect(result.current.isTranscribing).toBe(true);
  });

  it('stream есть только у внешнего движка', () => {
    const fakeStream = {} as MediaStream;
    mockSpeechToTextEndpoint = 'browser';
    mockExternalStream = fakeStream;
    const { result, rerender } = renderHook(() => useSpeechToText(jest.fn(), jest.fn()));

    expect(result.current.stream).toBeNull();

    mockSpeechToTextEndpoint = 'external';
    rerender();

    expect(result.current.stream).toBe(fakeStream);
  });
});
