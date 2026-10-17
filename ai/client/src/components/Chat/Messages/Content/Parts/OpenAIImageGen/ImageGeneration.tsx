import type { ComponentProps } from 'react';
import { ToolIcon } from '~/components/Chat/Messages/Content/ToolOutput';
import OpenAIImageGen from './OpenAIImageGen';
import { useLocalize } from '~/hooks';

type ImageGenerationProps = ComponentProps<typeof OpenAIImageGen>;

export default function ImageGeneration(props: ImageGenerationProps) {
  const localize = useLocalize();
  const output = typeof props.output === 'string' ? props.output : '';
  const blocked = output.startsWith('Blocked:');
  const failed = output.startsWith('Error:');

  if (!blocked && !failed) {
    return <OpenAIImageGen {...props} />;
  }

  return (
    <div className="relative my-1 flex h-5 shrink-0 items-center gap-2">
      <ToolIcon type="image_gen" isAnimating={false} />
      <span className="tool-status-text min-w-0 truncate font-medium text-text-secondary">
        {localize(blocked ? 'com_ui_image_not_created' : 'com_ui_image_gen_failed')}
      </span>
    </div>
  );
}
