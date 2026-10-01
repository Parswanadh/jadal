import type { ReactNode, Ref } from 'react';
import DataBadge from './DataBadge';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  lead: string;
  /** Optional id for the title so a region can be labelled by it. */
  titleId?: string;
  /** Optional ref and focusable flag so a screen can move focus to its title. */
  titleRef?: Ref<HTMLHeadingElement>;
  focusable?: boolean;
  /** Extra items shown at the right of the header, next to the data badge. */
  actions?: ReactNode;
}

/** The header on every screen: eyebrow, serif title, one plain sentence, and the data badge. */
export default function PageHeader({ eyebrow, title, lead, titleId, titleRef, focusable, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title" id={titleId} ref={titleRef} tabIndex={focusable ? -1 : undefined}>
          {title}
        </h1>
        <p className="page-lead">{lead}</p>
      </div>
      <div className="page-actions">
        {actions}
        <DataBadge />
      </div>
    </header>
  );
}
