import { encodeWav } from './wav';

export const SPEECH_SAMPLE_RATE = 16000;

export async function toWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, length, SPEECH_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new Blob([encodeWav(rendered.getChannelData(0), SPEECH_SAMPLE_RATE)], {
      type: 'audio/wav',
    });
  } finally {
    await context.close();
  }
}
