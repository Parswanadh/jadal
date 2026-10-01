import type { ReactNode, Ref } from 'react';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  lead: string;
  /** Optional id for the title so a region can be labelled by it. */
  titleId?: string;
  /** Optional ref and focusable flag so a screen can move focus to its title. */
  titleRef?: Ref<HTMLHeadingElement>;
  focusable?: boolean;
  /** Small status chips or buttons shown at the right of the header. */
  actions?: ReactNode;
}

/** The consistent header on every screen: eyebrow, serif title, one plain sentence. */
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
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
