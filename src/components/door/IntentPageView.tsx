import type { PageSpec } from "@/domain/search/pages";
import { StartRequestForm } from "@/components/intake/StartRequestForm";

/**
 * The one shared door template (Door Wave 2). Renders any PageSpec — never
 * bespoke page code, never analysis logic. The only action is the shared
 * intake component, fed by the page's attribution context (prior, not truth).
 */
function Markdownish({ text }: { text: string }) {
  // Content blocks are constrained markdown-lite: paragraphs, "- " bullets,
  // and **bold** lead-ins. Deliberately tiny — no raw HTML ever renders.
  const paragraphs = text.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n").filter((l) => l.trim().length > 0);
        if (lines.length === 0) return null;
        // Group consecutive bullet lines into lists, prose lines into
        // paragraphs — mixed intro-plus-bullets blocks render correctly
        // (the normal shape of future model-written content).
        const groups: Array<{ list: boolean; lines: string[] }> = [];
        for (const line of lines) {
          const isBullet = /^-\s+/.test(line.trim());
          const last = groups[groups.length - 1];
          if (last && last.list === isBullet) last.lines.push(line);
          else groups.push({ list: isBullet, lines: [line] });
        }
        return groups.map((group, gi) =>
          group.list ? (
            <ul key={`${pi}-${gi}`}>
              {group.lines.map((l, li) => (
                <li key={li}>{l.trim().replace(/^-\s+/, "")}</li>
              ))}
            </ul>
          ) : (
            <p key={`${pi}-${gi}`}>
              {group.lines.join(" ").split(/(\*\*[^*]+\*\*)/g).map((seg, si) =>
                seg.startsWith("**") && seg.endsWith("**") ? (
                  <strong key={si}>{seg.slice(2, -2)}</strong>
                ) : (
                  seg
                )
              )}
            </p>
          )
        );
      })}
    </>
  );
}

export function IntentPageView({ spec, staged }: { spec: PageSpec; staged: boolean }) {
  return (
    <main>
      {staged && (
        <div style={{ background: "var(--amber)", color: "#1a1408", padding: "10px 0" }}>
          <div className="wrap mono">Staged preview — not published, not indexed, pending QA + owner approval</div>
        </div>
      )}
      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="wrap-narrow">
          <div className="eyebrow">{spec.problem_family ?? "Home problem"}</div>
          <h1 className="d1" style={{ fontSize: "clamp(2.1rem, 4.6vw, 3.6rem)" }}>
            {spec.hero.headline}
          </h1>
          {spec.hero.subheadline && (
            <p className="lede" style={{ marginTop: 18 }}>
              {spec.hero.subheadline}
            </p>
          )}
        </div>
      </section>
      <section className="section section-light" style={{ paddingTop: 60 }}>
        <div className="wrap-narrow prose">
          {spec.content_blocks.map((block) => (
            <div key={block.block_id}>
              {block.heading && <h2>{block.heading}</h2>}
              {block.kind === "when_urgency_changes" ? (
                <div className="safety-note">
                  <Markdownish text={block.body_md} />
                </div>
              ) : (
                <Markdownish text={block.body_md} />
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="section section-lighter" id="start">
        <div className="wrap-narrow">
          <div className="eyebrow">One next step</div>
          <h2 className="d2" style={{ marginBottom: 8 }}>
            Start with what happened.
          </h2>
          <p className="lede" style={{ marginBottom: 26 }}>
            Describe it the way you&apos;d tell a neighbor. We&apos;ll organize it into a Job
            Packet any provider can use — whoever you end up calling.
          </p>
          <StartRequestForm
            attribution={{
              page_id: spec.intake_context.page_id,
              intent_cluster_id: spec.intake_context.intent_cluster_id,
              search_opportunity_id: spec.intake_context.search_opportunity_id,
              problem_family_hint: spec.intake_context.problem_family_hint,
              landing_path: spec.canonical_path,
            }}
          />
        </div>
      </section>
      {spec.internal_links.length > 0 && (
        <section className="section">
          <div className="wrap-narrow">
            <div className="eyebrow">Related</div>
            <ul>
              {spec.internal_links.map((link) => (
                <li key={link.path}>
                  <a href={link.path}>{link.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
