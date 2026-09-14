"use client";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="adm-error" role="alert"><p className="adm-kicker">Reading unavailable</p><h1 className="adm-title">This view could not be loaded.</h1><p>The records could not be read. A missing reading does not mean there is no activity.</p><button className="btn" onClick={reset}>Try loading the view again</button><p className="adm-small">Reloading this view does not repeat an action.</p></div>;
}
