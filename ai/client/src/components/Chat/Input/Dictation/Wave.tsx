import { memo, useEffect, useRef } from 'react';
import { useMediaQuery } from '@librechat/client';
import { WAVE_DOTS, computeLevel, dotScales } from '~/utils/audio/level';
import { cn } from '~/utils';

type WaveProps = {
  stream: MediaStream | null;
};

const resetDots = (dots: Array<HTMLSpanElement | null>) => {
  dots.forEach((dot) => {
    if (dot != null) {
      dot.style.transform = 'scaleY(1)';
    }
  });
};

export default memo(function Wave({ stream }: WaveProps) {
  const dotRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    if (reducedMotion || stream == null) {
      resetDots(dotRefs.current);
      return;
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);

    let rafId = 0;
    let tick = 0;

    const draw = () => {
      analyser.getByteTimeDomainData(samples);
      const level = computeLevel(samples);
      const scales = dotScales(level, WAVE_DOTS, tick);
      dotRefs.current.forEach((dot, index) => {
        if (dot != null) {
          dot.style.transform = `scaleY(${scales[index]})`;
        }
      });
      tick += 1;
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
      audioContext.close();
    };
  }, [stream, reducedMotion]);

  return (
    <div className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {Array.from({ length: WAVE_DOTS }, (_, index) => (
        <span
          key={index}
          ref={(node) => {
            dotRefs.current[index] = node;
          }}
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-text-secondary',
            !reducedMotion && stream == null && 'animate-pulse',
          )}
        />
      ))}
    </div>
  );
});
