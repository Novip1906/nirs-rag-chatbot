import { Children, Fragment, isValidElement } from 'react';
import { cn } from '~/utils';

interface PageColumnsProps {
  children: React.ReactNode;
  className?: string;
}

function countCards(children: React.ReactNode): number {
  return Children.toArray(children).reduce<number>(
    (total, child) =>
      isValidElement<{ children?: React.ReactNode }>(child) && child.type === Fragment
        ? total + countCards(child.props.children)
        : total + 1,
    0,
  );
}

export default function PageColumns({ children, className }: PageColumnsProps): JSX.Element {
  const cards = countCards(children);
  return (
    <div
      className={cn(
        'grid max-w-6xl gap-6',
        cards === 1 ? 'lg:grid-cols-1' : 'lg:grid-cols-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface PageCardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function PageCard({ title, children, className }: PageCardProps): JSX.Element {
  return (
    <section
      className={cn('min-w-0 space-y-4 rounded-lg border border-border-light p-4', className)}
    >
      {title != null && <h2 className="text-sm font-medium text-text-primary">{title}</h2>}
      {children}
    </section>
  );
}
