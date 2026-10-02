import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  /** Say what to do next. */
  body: string;
  action?: ReactNode;
}

/** What a list shows when it has nothing in it yet. */
export default function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
