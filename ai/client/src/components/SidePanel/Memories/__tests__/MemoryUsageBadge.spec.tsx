import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { changeLanguageSafely, initializeI18n } from '~/locales/i18n';
import MemoryUsageBadge from '../MemoryUsageBadge';

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ description, render }: { description: string; render: ReactElement }) => (
    <>
      <span data-testid="tooltip-description">{description}</span>
      {render}
    </>
  ),
}));

describe('MemoryUsageBadge token count pluralization', () => {
  beforeAll(async () => {
    await initializeI18n();
  });

  afterEach(async () => {
    await changeLanguageSafely('en');
  });

  it('declines the Russian noun for a many-count max', async () => {
    await changeLanguageSafely('ru');
    render(<MemoryUsageBadge percentage={10} tokenLimit={100} tooltipCurrent={3} tooltipMax={7} />);
    expect(screen.getByTestId('tooltip-description')).toHaveTextContent('3 / 7 токенов');
  });

  it('declines the Russian noun for a few-count max', async () => {
    await changeLanguageSafely('ru');
    render(
      <MemoryUsageBadge percentage={10} tokenLimit={100} tooltipCurrent={1} tooltipMax={22} />,
    );
    expect(screen.getByTestId('tooltip-description')).toHaveTextContent('1 / 22 токена');
  });

  it('does not duplicate the max token count in the English tooltip', () => {
    render(<MemoryUsageBadge percentage={10} tokenLimit={100} tooltipCurrent={3} tooltipMax={7} />);
    expect(screen.getByTestId('tooltip-description')).toHaveTextContent('3 / 7 tokens');
  });
});
