import type { ExportFormatDescriptor } from './formats';
import { cn } from '~/utils';

export default function FormatIcon({ format }: { format: ExportFormatDescriptor }) {
  const { key, Icon, toneClassName } = format;

  return (
    <div
      aria-hidden="true"
      data-testid="export-format-icon"
      data-format={key}
      className={cn(
        'flex size-10 items-center justify-center rounded-xl text-text-on-status',
        toneClassName,
      )}
    >
      <Icon className="size-5" />
    </div>
  );
}
