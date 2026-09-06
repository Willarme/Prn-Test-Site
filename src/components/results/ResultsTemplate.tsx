import type { AskAnswer } from "@/platform/stores/interfaces";
import { FeedbackPopup } from "@/components/results/FeedbackPopup";
import { ResultsShell } from "@/components/results/ResultsShell";

/**
 * THE RESULTS PAGE — MOCKUP-2-results-page.html, rebuilt with every button
 * live (campaign track P2, 2026-09-05).
 *
 * WORDING IS FROZEN. Every visible string below is the approved mockup's, byte
 * for byte, including the product cards (copied from the One Connected Home
 * hub page) and the legal line. tests/loop.p2.results-template.test.ts diffs
 * this component's rendered text nodes against the mockup file and fails on a
 * single changed character. Do not "fix" a spelling, a dash or a figure here;
 * the mockup is the authority and a change goes there first.
 *
 * TWO FROZEN STRINGS CARRY DOLLAR FIGURES ("$12,000 furnace", "$0/hr"). The
 * repo rule bans dollar figures homeowner-facing and the packet copy guard
 * enforces it on the PACKET; this page is Melissa's approved marketing copy
 * and her approval outranks the rule here. Flagged in the P2 report so she
 * can rule on it rather than us silently editing an approved page.
 *
 * IT IS A TEMPLATE (PRN Master Build Spec MERGED §6.4, BINDING; checklist D1):
 * no per-request value renders. The request id appears only inside hrefs,
 * never in text; the same component output serves every request. The one
 * conditional block — a friend's Trust Network answers — renders nothing at
 * all when there are none, so a thin request and a rich one are identical.
 *
 * Zero model calls, zero per-request assembly (§6.4): the page reads nothing
 * but the two signed links and the ask answers its caller hands it.
 *
 * Plain anchors rather than next/link: every target is a full page in another
 * track's ownership (/packet, /keep, /ask, /pages/*) or a document, and a
 * plain anchor renders identically in the test harness and the browser.
 *
 * `data-feedback-trigger` retains the approved action markers. They do not
 * arm feedback: only verified successful value receipts do that.
 */
export interface ResultsTemplateProps {
  requestId: string;
  /** /keep/<token> — a signed `keep` link minted by the page. */
  keepHref: string;
  /** /ask/<token> — a signed `ask` link minted by the page. */
  askHref: string;
  /** The friend's answers to the Trust Network ask, when any exist. */
  askAnswers?: AskAnswer[];
  ownerKey?: string;
  feedbackEligible?: boolean;
  /** Public synthetic tours can route actions to their isolated sample pages. */
  navigation?: Partial<Record<"packet" | "email" | "send" | "find", string>>;
}

export function ResultsTemplate({ requestId, keepHref, askHref, askAnswers = [], ownerKey, feedbackEligible = false, navigation }: ResultsTemplateProps) {
  const query = ownerKey ? `?k=${encodeURIComponent(ownerKey)}` : "";
  const packetHref = navigation?.packet ?? `/packet/${encodeURIComponent(requestId)}${query}`;
  const emailHref = navigation?.email ?? `/results/${encodeURIComponent(requestId)}/email${query}`;
  const sendHref = navigation?.send ?? `/results/${encodeURIComponent(requestId)}/send${query}`;
  const findHref = navigation?.find ?? `/results/${encodeURIComponent(requestId)}/find${query}`;

  return (
    <ResultsShell>
      {/* ============ HEADER ============ */}
      <div className="hero">
        <div className="seal">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12.5l5.2 5.2L20 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <h1>Your Job Packet is ready</h1>
      </div>

      {/* ==== WHAT YOU WALK AWAY WITH - wording approved on AC Problem Page LIVE v33 ==== */}
      <div className="packet">
        <p className="eyebrow"><i className="pennant" aria-hidden="true" />What you walk away with</p>
        <h2 className="ph2">A packet that can help the provider <span className="accent">start further ahead.</span></h2>
        <div className="bengrid">

          <div className="benefit ben-green">
            <span className="b-ico ic-green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>
            </span>
            <b className="b-h c-green">Shorter billable hour</b>
            <span className="b-p">Less diagnostic time on the clock may mean less money out of your pocket.</span>
          </div>

          <div className="benefit ben-blue">
            <span className="b-ico ic-blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M2 15h10"/><path d="m9 18 3-3-3-3"/></svg>
            </span>
            <b className="b-h c-blue">They arrive with more context</b>
            <span className="b-p">Your photos, your readings and what you already ruled out, before they load the van.</span>
          </div>

        </div>
      </div>

      {/* ============ PACKET CTA ============ */}
      <div className="cta-band">
        <p className="cta-eyebrow">Your Job Packet</p>
        {/* A new tab: the packet is a document, and the results page stays put
            underneath it — which is also what lets the feedback popup fire
            here 8 seconds later (checklist D4, D9). */}
        <a className="cta-btn" href={packetHref} target="_blank" rel="noopener" data-feedback-trigger="open_packet">Open my Job Packet</a>
        <p className="cta-alt"><a href={emailHref}>Email it to me instead</a></p>
      </div>

      {/* ============ HOME MEMORY ============ */}
      <div className="hm">
        <div className="hm-text">
          <p className="hm-eyebrow">Home Memory</p>
          <h2 className="hm-h">Your house is an asset with amnesia.</h2>
          <p className="hm-p">Your car remembers its oil changes better than your house remembers a $12,000 furnace. Save this, and next time your house does the remembering.</p>
          <ul className="saved">
            <li>Your unit — make, model, serial and age</li>
            <li>Where the shutoff, the panel and the filter live</li>
            <li>Your photos, on file and dated</li>
            <li>This repair, and what actually fixed it</li>
            <li>Warranty dates</li>
          </ul>
          <p className="kicker">So it isn&apos;t living inside your head. Wasting the energy you could be using to live.</p>
          <a className="btn fill" href={keepHref} data-feedback-trigger="save_home">Save this to my home</a>
          <div className="skip"><a href="#trust">Not now</a></div>
        </div>
        <figure className="hm-fig">
          <svg viewBox="-40 0 1020 630" className="fplan" role="img" aria-label="A floor plan of the house with pins on the dishwasher, furnace, water heater, water main, electrical panel and the front oak tree."><g stroke="#2A2622" fill="none"><rect x="60" y="60" width="780" height="450" strokeWidth="4" /><path d="M430 60 V300" strokeWidth="4" /><path d="M60 300 H430" strokeWidth="4" /><path d="M600 300 V510" strokeWidth="4" /><path d="M430 300 H840" strokeWidth="4" /></g><g stroke="#F7F7F5" strokeWidth="7"><path d="M430 165 V215" /><path d="M290 300 H350" /><path d="M600 430 V480" /></g><g stroke="rgba(42,38,34,.26)" strokeWidth="1" strokeDasharray="5 5"><path d="M60 250 H430" /><path d="M600 60 V300" /></g><g fontFamily="JetBrains Mono, monospace" fontSize="27" letterSpacing="2" fill="#8C8073"><text x="88" y="100">KITCHEN</text><text x="458" y="100">LIVING</text><text x="88" y="340">UTILITY</text><text x="628" y="340">GARAGE</text><text x="458" y="340">HALL</text></g><g><circle cx="200" cy="170" r="38" fill="rgba(255,46,126,.14)" /><circle cx="200" cy="170" r="22" fill="#fff" stroke="#C1004F" strokeWidth="2.8" /><circle cx="200" cy="170" r="7" fill="#C1004F" /><text x="200" y="232" fontFamily="JetBrains Mono, monospace" fontSize="24" letterSpacing="1.2" fill="#5A6462" textAnchor="middle">DISHWASHER</text></g><g><circle cx="130" cy="390" r="38" fill="rgba(255,46,126,.14)" /><circle cx="130" cy="390" r="22" fill="#fff" stroke="#C1004F" strokeWidth="2.8" /><circle cx="130" cy="390" r="7" fill="#C1004F" /><text x="130" y="452" fontFamily="JetBrains Mono, monospace" fontSize="24" letterSpacing="1.2" fill="#5A6462" textAnchor="middle">FURNACE</text></g><g><circle cx="300" cy="390" r="38" fill="rgba(255,46,126,.14)" /><circle cx="300" cy="390" r="22" fill="#fff" stroke="#C1004F" strokeWidth="2.8" /><circle cx="300" cy="390" r="7" fill="#C1004F" /><text x="300" y="452" fontFamily="JetBrains Mono, monospace" fontSize="24" letterSpacing="1.2" fill="#5A6462" textAnchor="middle">WATER HEATER</text></g><g><circle cx="515" cy="390" r="38" fill="rgba(255,46,126,.14)" /><circle cx="515" cy="390" r="22" fill="#fff" stroke="#C1004F" strokeWidth="2.8" /><circle cx="515" cy="390" r="7" fill="#C1004F" /><text x="515" y="452" fontFamily="JetBrains Mono, monospace" fontSize="24" letterSpacing="1.2" fill="#5A6462" textAnchor="middle">WATER MAIN</text></g><g><circle cx="700" cy="390" r="38" fill="rgba(255,46,126,.14)" /><circle cx="700" cy="390" r="22" fill="#fff" stroke="#C1004F" strokeWidth="2.8" /><circle cx="700" cy="390" r="7" fill="#C1004F" /><text x="700" y="452" fontFamily="JetBrains Mono, monospace" fontSize="24" letterSpacing="1.2" fill="#5A6462" textAnchor="middle">PANEL</text></g><g><circle cx="450" cy="556" r="38" fill="rgba(255,46,126,.14)" /><circle cx="450" cy="556" r="22" fill="#fff" stroke="#C1004F" strokeWidth="2.8" /><circle cx="450" cy="556" r="7" fill="#C1004F" /><text x="450" y="618" fontFamily="JetBrains Mono, monospace" fontSize="24" letterSpacing="1.2" fill="#5A6462" textAnchor="middle">FRONT OAK</text></g><text x="450" y="38" fontFamily="JetBrains Mono, monospace" fontSize="25" letterSpacing="2" fill="#5A6462" textAnchor="middle">1114 OAKHURST DR · BUILT 1994 · 2,180 SQ FT</text></svg>
          <figcaption>Every repair pinned to the spot in your house it belongs to</figcaption>
        </figure>
      </div>

      {/* ============ SEND BLOCK ============ */}
      <div className="trust" id="trust">
        <div className="trusttop">
          <div>
            <p className="trust-eyebrow">Trust Network</p>
            <h2>You already know someone who knows someone.</h2>
            <p className="sub">Your neighbourhood already did the research — it just needs somewhere to keep the answer. Let the trust travel, and send the same clear picture to someone worth calling.</p>
          </div>
          <figure className="trustfig">
            <svg viewBox="0 0 900 520" className="tmap" role="img" aria-label="A constellation of the people around your home — friends, neighbors, family, coworkers, community — each connected to providers they trust. One path from your house through a neighbor to a nearby proven provider is highlighted.">
            <g stroke="rgba(18,22,26,.16)" strokeWidth="1" strokeDasharray="3 5" fill="none">
              <path d="M450 260 L190 110" /><path d="M450 260 L700 110" /><path d="M450 260 L790 285" /><path d="M450 260 L660 445" /><path d="M450 260 L400 470" /><path d="M450 260 L155 400" />
              <path d="M190 110 L110 200" /><path d="M190 110 L300 60" /><path d="M700 110 L800 175" /><path d="M700 110 L620 45" /><path d="M790 285 L850 370" /><path d="M660 445 L555 490" /><path d="M400 470 L270 500" /><path d="M155 400 L80 320" /><path d="M155 400 L215 490" />
            </g>

            <g stroke="#FF2E7E" strokeWidth="2.6" fill="none" opacity="0.25"><path d="M450 260 L700 110 L800 175" strokeWidth="9" /></g>
            <g stroke="#FF2E7E" strokeWidth="2.6" fill="none"><path d="M450 260 L700 110 L800 175" strokeDasharray="8 6"  /></g>

            <g fontFamily="JetBrains Mono, monospace" fontSize="22" letterSpacing="2.2" fill="#5A6462" textAnchor="middle">
              <text x="190" y="66">FRIENDS</text>
              <text x="700" y="66">NEIGHBORS</text>
              <text x="790" y="335">FAMILY</text>
              <text x="660" y="495">COMMUNITY</text>
              <text x="400" y="500">SCHOOL PARENTS</text>
              <text x="155" y="356">COWORKERS</text>
            </g>

            <g fill="#12161A" opacity=".55">
              <circle cx="110" cy="200" r="7" /><circle cx="300" cy="60" r="7" /><circle cx="620" cy="45" r="7" /><circle cx="850" cy="370" r="7" /><circle cx="555" cy="490" r="7" /><circle cx="270" cy="500" r="7" /><circle cx="80" cy="320" r="7" /><circle cx="215" cy="490" r="7" />
            </g>

            <circle cx="190" cy="110" r="26" fill="#fff" stroke="#12161A" strokeWidth="1.6" />
            <circle cx="190" cy="110" r="9" fill="#3E6E7A" />
            <circle cx="700" cy="110" r="30" fill="#fff" stroke="#FF2E7E" strokeWidth="2.4" />
            <circle cx="700" cy="110" r="10" fill="#FF2E7E" />
            <circle cx="790" cy="285" r="26" fill="#fff" stroke="#12161A" strokeWidth="1.6" />
            <circle cx="790" cy="285" r="9" fill="#7A5C2E" />
            <circle cx="660" cy="445" r="26" fill="#fff" stroke="#12161A" strokeWidth="1.6" />
            <circle cx="660" cy="445" r="9" fill="#3E6E7A" />
            <circle cx="400" cy="470" r="26" fill="#fff" stroke="#12161A" strokeWidth="1.6" />
            <circle cx="400" cy="470" r="9" fill="#7A5C2E" />
            <circle cx="155" cy="400" r="26" fill="#fff" stroke="#12161A" strokeWidth="1.6" />
            <circle cx="155" cy="400" r="9" fill="#3E6E7A" />

            <g>
              <circle cx="800" cy="175" r="34" fill="#FF2E7E" opacity=".14" style={{animation:"prnglow 2.4s ease-in-out infinite"}} />
              <circle cx="800" cy="175" r="22" fill="#12161A" />
              <path d="M793 168 h14 M800 168 v14" stroke="#F7F7F5" strokeWidth="2.4" />
              <text x="800" y="222" fontFamily="JetBrains Mono, monospace" fontSize="22" letterSpacing="2.2" fill="#C1004F" textAnchor="middle">A GUY THEY TRUST</text>
            </g>

            <g>
              <circle cx="450" cy="260" r="46" fill="#12161A" />
              <path d="M430 265 L450 246 L470 265 V284 H430 Z" fill="none" stroke="#F7F7F5" strokeWidth="2.2" />
              <text x="450" y="330" fontFamily="JetBrains Mono, monospace" fontSize="22" letterSpacing="2.2" fill="#12161A" textAnchor="middle">YOUR HOUSE</text>
            </g>
          </svg>
            <figcaption>The people already around your home — and the one path that ends at a name they trust</figcaption>
          </figure>
        </div>

        {askAnswers.length > 0 && (
          // The friend's answers (P3's /ask writes them; store.listAskAnswers reads
          // them). WORDING 41: one name, the person it came from, the reason, one
          // next action. Renders nothing at all when there are none, so the
          // template stays identical across requests (checklist D1).
          <div className="answers">
            <p className="eyebrow"><i className="pennant" aria-hidden="true" />Your people answered</p>
            <ul>
              {askAnswers.map((a) => (
                <li key={a.ask_id}>
                  <b>{a.provider_name}</b>
                  <span className="from">From {a.friend_name}</span>
                  {a.reason ? <span className="why">{a.reason}</span> : null}
                </li>
              ))}
            </ul>
            <a className="next" href={sendHref}>SEND THEM MY JOB PACKET →</a>
          </div>
        )}

        <div className="paths">

          <a className="path" href={sendHref} data-feedback-trigger="have_someone">
            <div className="ic52 icq"><svg viewBox="0 0 52 52" fill="none" aria-hidden="true"><circle cx="26" cy="26" r="25" stroke="rgba(18,22,26,.15)" /><circle cx="20" cy="22" r="5" stroke="#12161A" strokeWidth="1.6" /><circle cx="33" cy="24" r="4" stroke="#3E6E7A" strokeWidth="1.6" /><path d="M12 37c0-5 4-7 8-7s8 2 8 7M28 37c0-3.5 2.5-5 5-5s5 1.5 5 5" stroke="#12161A" strokeWidth="1.6" /><path d="M40 16l3 3-3 3" stroke="#FF2E7E" strokeWidth="1.8" /></svg></div>
            <b>I already have someone</b>
            <span>Save them to your people, and send this over in one tap.</span>
          </a>

          <a className="path lead" href={askHref} data-feedback-trigger="ask_people">
            <div className="ic52 icg">
              <svg viewBox="0 0 52 52" fill="none" aria-hidden="true"><circle cx="26" cy="26" r="25" stroke="rgba(18,22,26,.15)" /><path d="M40 27.4c0 5.6-5.7 10.1-12.8 10.1a16 16 0 01-4-.5L15 40l2-5.6a9.6 9.6 0 01-3.9-7.4c0-5.6 5.7-10.1 12.8-10.1S40 21.8 40 27.4z" stroke="#12161A" strokeWidth="1.6" strokeLinejoin="round" /><path d="M20.5 26.6h11" stroke="#12161A" strokeWidth="1.6" strokeLinecap="round" /><path d="M35 13.5l2.4 2.4 4.6-4.8" stroke="#FF2E7E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <b>Ask my people</b>
            <span>One private question to friends and neighbours. They answer in a tap.</span>
          </a>

          <a className="path" href={findHref}>
            <div className="ic52 icq">
              <svg viewBox="0 0 52 52" fill="none" aria-hidden="true"><circle cx="26" cy="26" r="25" stroke="rgba(18,22,26,.15)" /><path d="M24 40.5s10-8 10-15.7A10 10 0 1014 24.8C14 32.5 24 40.5 24 40.5z" stroke="#12161A" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="24" cy="24.4" r="3.8" stroke="#12161A" strokeWidth="1.6" /><path d="M37 14.5h6M40 11.5v6" stroke="#FF2E7E" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </div>
            <b>Find someone for me</b>
            <span>A short, considered shortlist, matched to what is actually wrong.</span>
          </a>

        </div>
      </div>

      {/* ============ PRODUCT CARDS ============ */}
      <div className="prods">
        <h2>All four, free to you</h2>
        <p className="sub">Your home starts working like one connected asset instead of twenty unrelated problems.</p>
        <div className="pgrid">

          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /pages/* is a route handler serving one of Melissa's approved static documents (track F1), not a Next page; a plain anchor is the right element for a document. */}
          <a className="p" href="/pages/dashboard">
            <div className="ic52 icp" data-icon="dashboard"><svg viewBox="0 0 52 52" fill="none" aria-hidden="true"><circle cx="26" cy="26" r="25" stroke="rgba(18,22,26,.15)" /><path d="M14 16h20a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V18a2 2 0 0 1 2-2z" stroke="#12161A" strokeWidth="1.6" /><path d="M12 22h24M15 19h7" stroke="#12161A" strokeWidth="1.6" /><circle cx="17.5" cy="27" r="2.5" stroke="#12161A" strokeWidth="1.6" /><path d="M13.5 32.5c0-2 1.8-3.2 4-3.2s4 1.2 4 3.2" stroke="#12161A" strokeWidth="1.6" /><circle cx="29.5" cy="28" r="4.5" stroke="#3E6E7A" strokeWidth="1.6" /><path d="M29.5 25.2V28l2 1.5" stroke="#12161A" strokeWidth="1.6" /><path d="M39 24l3 3-3 3" stroke="#FF2E7E" strokeWidth="1.8" /></svg></div>
            <div>
              <div className="num">01 · CUSTOMER DASHBOARD</div>
              <b>Every repair has two workers. Only one gets paid, and it isn&apos;t you.</b>
              <span className="d">Uncertainty removed: a named provider, a visible response deadline, the price approved from your desk, and nobody burning a vacation day to unlock a door.</span>
              <div className="arrow">SEE THE DASHBOARD →</div>
            </div>
          </a>

          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /pages/* is a route handler serving one of Melissa's approved static documents (track F1), not a Next page; a plain anchor is the right element for a document. */}
          <a className="p" href="/pages/trust-network">
            <div className="ic52 icp" data-icon="trust"><svg viewBox="0 0 52 52" fill="none" aria-hidden="true"><circle cx="26" cy="26" r="25" stroke="rgba(18,22,26,.15)" /><circle cx="13" cy="31" r="4" stroke="#12161A" strokeWidth="1.6" /><circle cx="26" cy="18" r="4" stroke="#12161A" strokeWidth="1.6" /><circle cx="37" cy="29" r="4" stroke="#3E6E7A" strokeWidth="1.6" /><circle cx="19" cy="41" r="3" stroke="#12161A" strokeWidth="1.6" /><circle cx="39" cy="17" r="3" stroke="#12161A" strokeWidth="1.6" /><path d="M16 28L23 21M29 21L34 26M15 35L17 38M30 18L36 17" stroke="#12161A" strokeWidth="1.6" /><path d="M42 31l3 3-3 3" stroke="#FF2E7E" strokeWidth="1.8" /></svg></div>
            <div>
              <div className="num">02 · TRUST NETWORK</div>
              <b>Five stars tell you what strangers think.</b>
              <span className="d">Your neighborhood already has a better network than any search engine. Use the people you already trust, trust — and hand the answer forward when it&apos;s your turn.</span>
              <div className="arrow">SEE THE TRUST MAP →</div>
            </div>
          </a>

          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /pages/* is a route handler serving one of Melissa's approved static documents (track F1), not a Next page; a plain anchor is the right element for a document. */}
          <a className="p" href="/pages/smartquote">
            <div className="ic52 icp" data-icon="smartquote"><svg viewBox="0 0 52 52" fill="none" aria-hidden="true"><circle cx="26" cy="26" r="25" stroke="rgba(18,22,26,.15)" /><path d="M14 14h12l5 5v19H14z" stroke="#12161A" strokeWidth="1.6" /><path d="M26 14v5h5" stroke="#12161A" strokeWidth="1.6" /><path d="M18 21h5M18 25h9M18 29h9M18 33h6" stroke="#12161A" strokeWidth="1.6" /><path d="M36 18v16M34 18h4M34 34h4M33 27h6" stroke="#3E6E7A" strokeWidth="1.6" /><path d="M35 12l3 3 5-6" stroke="#FF2E7E" strokeWidth="1.8" /></svg></div>
            <div>
              <div className="num">03 · SMARTQUOTE ANALYZER</div>
              <b>You shouldn&apos;t have to read it to know it&apos;s fair.</b>
              <span className="d">Any quote, from anyone — ours, yours, or your neighbor&apos;s guy. Plain English, local price context, and the questions written for you.</span>
              <div className="arrow">READ A QUOTE WITH US →</div>
            </div>
          </a>

          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- /pages/* is a route handler serving one of Melissa's approved static documents (track F1), not a Next page; a plain anchor is the right element for a document. */}
          <a className="p" href="/pages/home-memory">
            <div className="ic52 icp" data-icon="memory"><svg viewBox="0 0 52 52" fill="none" aria-hidden="true"><circle cx="26" cy="26" r="25" stroke="rgba(18,22,26,.15)" /><path d="M12 26L26 15l14 11" stroke="#12161A" strokeWidth="1.6" /><path d="M16 26h20M16 26v12h20V26" stroke="#12161A" strokeWidth="1.6" /><path d="M20 28h12v7.5H20zM23 31h6M23 33.5h3.5" stroke="#3E6E7A" strokeWidth="1.6" /><path d="M41 18s-3.2-3.4-3.2-5.6a3.2 3.2 0 1 1 6.4 0C44.2 14.6 41 18 41 18z" stroke="#FF2E7E" strokeWidth="1.8" /></svg></div>
            <div>
              <div className="num">04 · HOME MEMORY</div>
              <b>Your most expensive asset has amnesia.</b>
              <span className="d">Model numbers, warranties, who did it, what it cost, where the shutoff is. Stop renting your brain to your house for $0/hr and go live your life.</span>
              <div className="arrow">OPEN THE FLOOR PLAN →</div>
            </div>
          </a>

        </div>
        <div className="signoff">
          <p className="signoff-line">You stop carrying it in your head.<br /><span className="so-accent">You get your days back.</span></p>
        </div>
      </div>

      <p className="legal">This is a preparation record. A qualified technician does their own testing on site, and the price stays theirs to set. What you entered stays with you until you choose to send it.</p>

      <FeedbackPopup requestId={requestId} ownerKey={ownerKey} eligible={feedbackEligible} />
    </ResultsShell>
  );
}
