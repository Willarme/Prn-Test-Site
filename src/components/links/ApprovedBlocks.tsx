/**
 * THE TWO APPROVED MARKETING BLOCKS, reused verbatim (track P3).
 *
 * Markup and copy are lifted from the approved assets in the vault:
 *   05 Visuals/Marketing assets 2026-09-04/Home Memory floor plan block.html
 *   05 Visuals/Marketing assets 2026-09-04/Trust Network map block.html
 * Melissa's instruction on both (2026-09-04): "it belongs on that page or
 * another page, store it with current marketing approved assets and pages,
 * but not for the pdf packet". /keep is that page for the floor plan;
 * the /ask thank-you state is that page for the map.
 *
 * The assets say "the markup and the tokens travel together", so the handful
 * of rules each block needs come along, scoped under .approved-block so
 * nothing leaks into the app shell and nothing of the shell restyles them.
 * Headline and sub-line strings are the approved ones, byte for byte.
 */
const BLOCK_CSS = `
.approved-block{--text:#12161A;--muted:#5A6462;--dim:#6B7472;--paper:#F7F7F5;--white:#FFFFFF;--pinkd:#C1004F;
  --line:rgba(18,22,26,.13);--r6:6px;--plane:0 3px 0 rgba(18,22,26,.09);
  --bevel:inset 0 1px 0 rgba(255,255,255,.75), inset 0 -1px 0 rgba(18,22,26,.06);
  --mono:var(--font-mono),'JetBrains Mono',ui-monospace,monospace;--disp:var(--font-display),'Archivo',system-ui,sans-serif;
  color:var(--text);margin:34px 0;border:1px solid var(--line);border-radius:var(--r6);overflow:hidden;box-shadow:var(--plane)}
.approved-block .fig{padding:30px 40px;background:var(--white)}
.approved-block .fig.alt{background:var(--paper)}
.approved-block .fig h2{font-family:var(--disp);font-size:1.5rem;font-weight:800;letter-spacing:-.032em;margin:0 0 8px;line-height:1.14;max-width:24ch}
.approved-block .fig .fsub{font-size:.9rem;color:var(--muted);margin:0 0 20px;max-width:52ch;line-height:1.55}
.approved-block .figbox{border:1px solid var(--line);border-radius:var(--r6);padding:16px;background:var(--paper);box-shadow:var(--plane)}
.approved-block .fig.alt .figbox{background:var(--white)}
.approved-block .figbox svg{width:100%;height:auto;display:block}
.approved-block .figcap{font:500 .64rem/1.5 var(--mono);letter-spacing:.05em;color:var(--dim);text-align:center;margin-top:11px}
.approved-block .keyrow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:18px}
.approved-block .key{text-align:center;padding:16px 8px;background:var(--white);border:1px solid var(--line);border-radius:var(--r6);box-shadow:var(--plane)}
.approved-block .fig.alt .key{background:var(--paper)}
.approved-block .ic{border-radius:var(--r6);display:grid;place-items:center;box-shadow:var(--bevel);flex:none;margin:0 auto 10px;width:44px;height:44px}
.approved-block .ic svg{display:block;width:23px;height:23px}
.approved-block .ic-ink{background:rgba(18,22,26,.07);color:var(--text)}
.approved-block .ic-pink{background:rgba(255,46,126,.14);color:var(--pinkd)}
.approved-block .key b{display:block;font:500 .61rem/1.3 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
@media (max-width:760px){.approved-block .fig{padding:22px 18px}.approved-block .keyrow{grid-template-columns:1fr 1fr}}
`;

export function HomeMemoryBlock() {
  return (
    <section className="approved-block" aria-label="Home Memory">
      <style dangerouslySetInnerHTML={{ __html: BLOCK_CSS }} />
      <div className="fig alt">
        <h2>Your most expensive asset has amnesia.</h2>
        <p className="fsub">
          Every repair creates two things: a fix and a lesson. Home Memory keeps both, pinned to the
          spot in your house they belong to.
        </p>
        <div className="figbox">
          <svg
            viewBox="-40 0 1020 630"
            role="img"
            aria-label="A floor plan of the house with pins on the dishwasher, furnace, water heater, water main, electrical panel and the front oak tree."
          >
            <g stroke="#2A2622" fill="none">
              <rect x="60" y="60" width="780" height="450" strokeWidth="4" />
              <path d="M430 60 V300" strokeWidth="4" />
              <path d="M60 300 H430" strokeWidth="4" />
              <path d="M600 300 V510" strokeWidth="4" />
              <path d="M430 300 H840" strokeWidth="4" />
            </g>
            <g stroke="#F7F7F5" strokeWidth="7">
              <path d="M430 165 V215" />
              <path d="M290 300 H350" />
              <path d="M600 430 V480" />
            </g>
            <g stroke="rgba(42,38,34,.26)" strokeWidth="1" strokeDasharray="5 5">
              <path d="M60 250 H430" />
              <path d="M600 60 V300" />
            </g>
            <g fontFamily="JetBrains Mono, monospace" fontSize="27" letterSpacing="2" fill="#8C8073">
              <text x="88" y="100">KITCHEN</text>
              <text x="458" y="100">LIVING</text>
              <text x="88" y="340">UTILITY</text>
              <text x="628" y="340">GARAGE</text>
              <text x="458" y="340">HALL</text>
            </g>
            {(
              [
                [200, 170, "DISHWASHER"],
                [130, 390, "FURNACE"],
                [300, 390, "WATER HEATER"],
                [515, 390, "WATER MAIN"],
                [700, 390, "PANEL"],
                [450, 556, "FRONT OAK"],
              ] as const
            ).map(([cx, cy, label]) => (
              <g key={label}>
                <circle cx={cx} cy={cy} r="38" fill="rgba(255,46,126,.14)" />
                <circle cx={cx} cy={cy} r="22" fill="#fff" stroke="#C1004F" strokeWidth="2.8" />
                <circle cx={cx} cy={cy} r="7" fill="#C1004F" />
                <text
                  x={cx}
                  y={cy + 62}
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="24"
                  letterSpacing="1.2"
                  fill="#5A6462"
                  textAnchor="middle"
                >
                  {label}
                </text>
              </g>
            ))}
            <text
              x="450"
              y="38"
              fontFamily="JetBrains Mono, monospace"
              fontSize="25"
              letterSpacing="2"
              fill="#5A6462"
              textAnchor="middle"
            >
              1114 OAKHURST DR · BUILT 1994 · 2,180 SQ FT
            </text>
          </svg>
        </div>
        <div className="keyrow">
          <div className="key">
            <div className="ic ic-ink">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="6" width="18" height="12" rx="1.8" stroke="currentColor" strokeWidth="1.75" />
                <path d="M6.5 11h7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </div>
            <b>Model #</b>
          </div>
          <div className="key">
            <div className="ic ic-ink">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 2.8h9l5 5v13.4H5z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                <path d="M8.5 12.5h7M8.5 16h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </div>
            <b>Receipt</b>
          </div>
          <div className="key">
            <div className="ic ic-ink">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2.8l7.6 3.4v6c0 4.8-3.4 7.6-7.6 8.8-4.2-1.2-7.6-4-7.6-8.8v-6z"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <b>Warranty</b>
          </div>
          <div className="key">
            <div className="ic ic-ink">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8.8" r="3.9" stroke="currentColor" strokeWidth="1.75" />
                <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </div>
            <b>Who fixed it</b>
          </div>
          <div className="key">
            <div className="ic ic-pink">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="6.4" width="18" height="13.2" rx="1.8" stroke="currentColor" strokeWidth="1.75" />
                <circle cx="12" cy="13" r="3.6" stroke="currentColor" strokeWidth="1.75" />
                <path d="M8.6 6.4l1.3-2.1h4.2l1.3 2.1" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
              </svg>
            </div>
            <b>Photos</b>
          </div>
        </div>
      </div>
    </section>
  );
}

export function TrustMapBlock() {
  return (
    <section className="approved-block" aria-label="Trust Network">
      <style dangerouslySetInnerHTML={{ __html: BLOCK_CSS }} />
      <div className="fig">
        <h2>Your neighbourhood already did the research.</h2>
        <p className="fsub">
          It just needs somewhere to keep the answer. Two hops from your front door to a name somebody
          you trust would call again.
        </p>
        <div className="figbox">
          <svg
            viewBox="0 0 900 470"
            role="img"
            aria-label="Two hops: your house, three people you already trust, and the providers they have actually used, one path highlighted through your neighbor to the provider she used twice."
          >
            <g fontFamily="JetBrains Mono, monospace" fontSize="11" letterSpacing="1.6" fill="#5A6462">
              <text x="60" y="40">YOU</text>
              <text x="330" y="40">PEOPLE YOU ALREADY TRUST</text>
              <text x="690" y="40">WHO THEY ACTUALLY USED</text>
            </g>
            <g stroke="rgba(18,22,26,.18)" strokeWidth="1.4" fill="none" strokeDasharray="4 5">
              <path d="M170 235 C 250 235 260 120 340 120" />
              <path d="M170 235 C 250 235 260 350 340 350" />
              <path d="M470 120 C 560 120 570 90 660 90" />
              <path d="M470 120 C 560 120 570 175 660 175" />
              <path d="M470 350 C 560 350 570 320 660 320" />
              <path d="M470 350 C 560 350 570 400 660 400" />
            </g>
            <g stroke="#FF2E7E" fill="none">
              <path d="M170 235 C 250 235 260 235 340 235" strokeWidth="9" opacity=".22" />
              <path d="M470 235 C 560 235 570 235 660 235" strokeWidth="9" opacity=".22" />
            </g>
            <g stroke="#FF2E7E" strokeWidth="2.4" fill="none" strokeDasharray="8 6">
              <path d="M170 235 C 250 235 260 235 340 235" />
              <path d="M470 235 C 560 235 570 235 660 235" />
            </g>
            <g>
              <rect x="60" y="196" width="110" height="78" rx="8" fill="#12161A" />
              <path d="M97 250 L115 232 L133 250 V266 H97 Z" fill="none" stroke="#F7F7F5" strokeWidth="2.2" />
              <text
                x="115"
                y="296"
                fontFamily="JetBrains Mono, monospace"
                fontSize="10.5"
                letterSpacing="1.3"
                fill="#12161A"
                textAnchor="middle"
              >
                1114 OAKHURST
              </text>
            </g>
            <g fontFamily="Public Sans, sans-serif" fontSize="14" fill="#12161A">
              <rect x="340" y="88" width="130" height="64" rx="8" fill="#fff" stroke="rgba(18,22,26,.2)" />
              <text x="358" y="115">Dad</text>
              <text x="358" y="135" fontSize="11.5" fill="#5A6462">two houses, 30 yrs</text>
              <rect x="340" y="203" width="130" height="64" rx="8" fill="#fff" stroke="#FF2E7E" strokeWidth="2.2" />
              <text x="358" y="230">Renee, next door</text>
              <text x="358" y="250" fontSize="11.5" fill="#5A6462">used him twice</text>
              <rect x="340" y="318" width="130" height="64" rx="8" fill="#fff" stroke="rgba(18,22,26,.2)" />
              <text x="358" y="345">Coach Tim</text>
              <text x="358" y="365" fontSize="11.5" fill="#5A6462">knows every roofer</text>
            </g>
            <g fontFamily="Public Sans, sans-serif" fontSize="13.5">
              <rect x="660" y="62" width="180" height="56" rx="8" fill="#F4F5F2" stroke="rgba(18,22,26,.16)" />
              <text x="678" y="88" fill="#5A6462">Bell Plumbing</text>
              <text x="678" y="106" fontSize="11" fill="#8A9290">one job, fine</text>
              <rect x="660" y="147" width="180" height="56" rx="8" fill="#F4F5F2" stroke="rgba(18,22,26,.16)" />
              <text x="678" y="173" fill="#5A6462">Kirk &amp; Sons</text>
              <text x="678" y="191" fontSize="11" fill="#8A9290">no answer at night</text>
              <rect x="660" y="205" width="180" height="60" rx="8" fill="#12161A" />
              <text x="678" y="232" fill="#F7F7F5" fontSize="14">Vance Water Heater</text>
              <text x="678" y="252" fontSize="11" fill="#98A4A3">the one she&apos;d call again</text>
              <rect x="660" y="292" width="180" height="56" rx="8" fill="#F4F5F2" stroke="rgba(18,22,26,.16)" />
              <text x="678" y="318" fill="#5A6462">Ross Mechanical</text>
              <text x="678" y="336" fontSize="11" fill="#8A9290">furnace only</text>
              <rect x="660" y="372" width="180" height="56" rx="8" fill="#F4F5F2" stroke="rgba(18,22,26,.16)" />
              <text x="678" y="398" fill="#5A6462">Third Street HVAC</text>
              <text x="678" y="416" fontSize="11" fill="#8A9290">busy season</text>
            </g>
            <text
              x="750"
              y="286"
              fontFamily="JetBrains Mono, monospace"
              fontSize="10.5"
              letterSpacing="1.3"
              fill="#C1004F"
              textAnchor="middle"
            >
              A GUY THEY TRUST
            </text>
          </svg>
        </div>
        <p className="figcap">TRUST NETWORK · TWO HOPS FROM YOUR HOUSE TO A GUY THEY TRUST</p>
      </div>
    </section>
  );
}
