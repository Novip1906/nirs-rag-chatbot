import React from 'react';
import { render, screen } from '@testing-library/react';
import PageColumns, { PageCard } from '../common/PageColumns';

describe('PageColumns', () => {
  it('lays cards out in two columns on wide screens inside a max-w-6xl container', () => {
    render(
      <PageColumns>
        <PageCard title="left">a</PageCard>
        <PageCard title="right">b</PageCard>
      </PageColumns>,
    );
    const grid = screen.getByText('left').closest('section')!.parentElement!;
    expect(grid).toHaveClass('grid', 'gap-6', 'lg:grid-cols-2', 'max-w-6xl');
    expect(screen.getByText('left').closest('section')).toHaveClass(
      'rounded-lg',
      'border',
      'border-border-light',
      'p-4',
    );
  });

  it('gives a single card the full width', () => {
    render(
      <PageColumns>
        {false}
        <PageCard title="only">a</PageCard>
        {null}
      </PageColumns>,
    );
    const grid = screen.getByText('only').closest('section')!.parentElement!;
    expect(grid).toHaveClass('grid', 'lg:grid-cols-1');
    expect(grid).not.toHaveClass('lg:grid-cols-2');
  });

  it('counts cards inside a fragment', () => {
    render(
      <PageColumns>
        <>
          <PageCard title="first">a</PageCard>
          <PageCard title="second">b</PageCard>
        </>
      </PageColumns>,
    );
    const grid = screen.getByText('first').closest('section')!.parentElement!;
    expect(grid).toHaveClass('lg:grid-cols-2');
    expect(grid).not.toHaveClass('lg:grid-cols-1');
  });
});
