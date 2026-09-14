import type { ReactNode } from "react";

export function AdminPageHeader({ eyebrow, title, description, actions, meta }: {
  eyebrow: string; title: string; description?: ReactNode; actions?: ReactNode; meta?: ReactNode;
}) {
  return <header className="adm-page-header"><div><p className="adm-kicker">{eyebrow}</p><h1 className="adm-title">{title}</h1>{description && <p className="adm-description">{description}</p>}{meta && <div className="adm-page-meta">{meta}</div>}</div>{actions && <div className="adm-page-actions">{actions}</div>}</header>;
}

export function AdminStatus({ tone = "neutral", children }: {
  tone?: "neutral" | "good" | "warning" | "danger"; children: ReactNode;
}) {
  return <span className={`adm-status adm-status--${tone}`}>{children}</span>;
}

export function AdminEmptyState({ title, children, action }: {
  title: string; children?: ReactNode; action?: ReactNode;
}) {
  return <div className="adm-empty"><span className="adm-empty-mark" aria-hidden>—</span><h2>{title}</h2>{children && <div className="adm-empty-description">{children}</div>}{action && <div className="adm-empty-action">{action}</div>}</div>;
}
