interface AdminPageHeaderProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export default function AdminPageHeader({
  title,
  description,
  action,
}: AdminPageHeaderProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-light px-6 py-5">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
        {description != null && (
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
