import { act, render } from '@testing-library/react';
import { WAVE_DOTS } from '~/utils/audio/level';
import Wave from '../Wave';

class FakeAnalyserNode {
  fftSize = 2048;
  frequencyBinCount = 1024;
  connect = jest.fn();
  disconnect = jest.fn();
  getByteTimeDomainData = jest.fn((array: Uint8Array) => {
    array.fill(255);
  });
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  close = jest.fn();
  createAnalyser = jest.fn(() => new FakeAnalyserNode());
  createMediaStreamSource = jest.fn(() => ({ connect: jest.fn(), disconnect: jest.fn() }));

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

type ChangeListener = () => void;

const stubMatchMedia = (matches: boolean) => {
  const listeners = new Set<ChangeListener>();
  const media = {
    matches,
    media: '',
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: (_event: string, listener: ChangeListener) => listeners.add(listener),
    removeEventListener: (_event: string, listener: ChangeListener) => listeners.delete(listener),
    dispatchEvent: jest.fn(),
  };
  jest.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  return (next: boolean) => {
    media.matches = next;
    listeners.forEach((listener) => listener());
  };
};

const mockRaf = () => {
  const cancelSpy = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  let callCount = 0;
  const rafSpy = jest
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback: FrameRequestCallback) => {
      callCount += 1;
      if (callCount === 1) {
        callback(0);
      }
      return callCount;
    });
  return { rafSpy, cancelSpy };
};

const fakeStream = {} as MediaStream;

beforeEach(() => {
  FakeAudioContext.instances = [];
  (window as unknown as { AudioContext: typeof FakeAudioContext }).AudioContext = FakeAudioContext;
  stubMatchMedia(false);
});

describe('Wave', () => {
  it('renders WAVE_DOTS dots hidden from assistive tech', () => {
    const { container } = render(<Wave stream={null} />);
    const dots = container.querySelectorAll('span');
    expect(dots).toHaveLength(WAVE_DOTS);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('pulses without a stream', () => {
    const { container } = render(<Wave stream={null} />);
    const dot = container.querySelector('span');
    expect(dot).toHaveClass('animate-pulse');
  });

  it('is static at reduced motion, even without a stream', () => {
    stubMatchMedia(true);
    const { container } = render(<Wave stream={null} />);
    const dot = container.querySelector('span');
    expect(dot).not.toHaveClass('animate-pulse');
  });

  it('moves the dots by level and closes the AudioContext on unmount', () => {
    const { cancelSpy } = mockRaf();
    const { container, unmount } = render(<Wave stream={fakeStream} />);
    const dot = container.querySelector('span') as HTMLSpanElement;
    expect(dot.style.transform).toContain('scaleY');
    expect(dot.style.transform).not.toBe('scaleY(1)');

    const context = FakeAudioContext.instances[0];
    expect(context).toBeDefined();

    unmount();

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('does not open an AudioContext at reduced motion', () => {
    stubMatchMedia(true);
    render(<Wave stream={fakeStream} />);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('closes the AudioContext and goes static when reduced motion turns on mid-mount', () => {
    const { cancelSpy } = mockRaf();
    const changeReducedMotion = stubMatchMedia(false);
    const { container } = render(<Wave stream={fakeStream} />);
    const dot = container.querySelector('span') as HTMLSpanElement;
    expect(dot.style.transform).not.toBe('scaleY(1)');

    const context = FakeAudioContext.instances[0];
    expect(context).toBeDefined();

    act(() => changeReducedMotion(true));

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(dot.style.transform).toBe('scaleY(1)');
    expect(dot).not.toHaveClass('animate-pulse');
  });
});
