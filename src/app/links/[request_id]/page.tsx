import type { Metadata } from "next";
import Link from "next/link";
import { listIssuedLinks, type IssuedLink } from "@/platform/links/ledger";
import { ownerAllowed } from "@/platform/links/owner";
import { formatWhen } from "@/platform/links/views";
import { runtimeStore } from "@/platform/stores/runtime";
import type { LinkScope } from "@/platform/links/tokens";

/**
 * /links/<request_id> — LINKS YOU SHARED, WITH A SWITCH ON EACH (track P3;
 * decision 8, recommendation A, said plainly in one sentence).
 *
 * Lists every link this request's ledger issued (keep / ask / media /
 * packet) with its state and a "Switch off" button that posts to
 * /api/links/revoke. Gated by src/platform/links/owner.ts: the journey
 * cookie, or `?k=<keep token>` for this request. Anyone else sees the
 * "open this from your results page" state and no links.
 */
export const metadata: Metadata = {
  title: "Links you shared",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<LinkScope, string> = {
  keep: "Home Memory claim link",
  ask: "Ask my people link",
  media: "Provider photo link",
  packet: "Job Packet share link",
  magic: "Sign-in link",
};

function pathFor(link: IssuedLink): string {
  const t = encodeURIComponent(link.token);
  switch (link.scope) {
    case "keep":
      return `/keep/${t}`;
    case "ask":
      return `/ask/${t}`;
    case "media":
      return `/media/${t}`;
    case "packet":
      return `/p/${t}`;
    default:
      return `/claim/${t}`;
  }
}

export default async function LinksPage({
  params,
  searchParams,
}: {
  params: Promise<{ request_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { request_id } = await params;
  const query = await searchParams;
  const k = typeof query.k === "string" ? query.k : undefined;
  const justOff = typeof query.off === "string" ? query.off : null;

  if (!(await ownerAllowed(request_id, k))) {
    return (
      <main className="section section-light">
        <div className="wrap-narrow">
          <p className="eyebrow">Home Memory</p>
          <h1 className="d2">Open this from your results page.</h1>
          <p className="lede">
            The links page opens from the browser you used for this request, or from your Home
            Memory link.
          </p>
          <p>
            <Link className="btn btn-ghost" href={`/results/${request_id}`}>
              Open my results
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const store = runtimeStore();
  const issued = (await listIssuedLinks(request_id)).filter((l) => l.scope !== "magic");
  const now = Date.now();
  const rows = await Promise.all(
    issued.map(async (l) => {
      const revoked = await store.isLinkRevoked(l.link_id);
      const expired = l.exp !== null && Date.parse(l.exp) <= now;
      return { link: l, state: revoked ? "off" : expired ? "expired" : "open" } as const;
    })
  );

  return (
    <main className="section section-light">
      <div className="wrap-narrow">
        <p className="eyebrow">Home Memory</p>
        <h1 className="d2">Links you shared</h1>
        <p className="lede">
          Each link opens one thing. Switching one off stops it opening; anything already opened or
          downloaded stays where it went.
        </p>

        {rows.length === 0 ? (
          <p className="hint">No links shared from this request yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
            {rows.map(({ link, state }) => (
              <div key={link.link_id} className="card-light" style={{ padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <strong>{SCOPE_LABEL[link.scope]}</strong>
                    <p className="hint">
                      Made {formatWhen(link.created_at)}
                      {link.exp ? ` · runs until ${formatWhen(link.exp)}` : ""}
                    </p>
                    {state === "open" && (
                      <p className="hint">
                        <a href={pathFor(link)} style={{ wordBreak: "break-all" }}>
                          {pathFor(link)}
                        </a>
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {state === "open" ? (
                      <form method="post" action="/api/links/revoke">
                        <input type="hidden" name="link_id" value={link.link_id} />
                        <input type="hidden" name="request_id" value={request_id} />
                        {k && <input type="hidden" name="k" value={k} />}
                        <button className="btn btn-ghost btn-sm" type="submit">
                          Switch off
                        </button>
                      </form>
                    ) : (
                      <span className={`pill ${state === "off" ? "pill-pink" : "pill-amber"}`}>
                        {state === "off" ? "Switched off" : "Expired"}
                      </span>
                    )}
                    {justOff === link.link_id && <p className="hint">Switched off just now.</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p style={{ marginTop: 28 }}>
          <Link className="btn btn-ghost btn-sm" href={`/results/${request_id}`}>
            Open my results
          </Link>
        </p>
      </div>
    </main>
  );
}
