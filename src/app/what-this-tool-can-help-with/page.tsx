import type { Metadata } from "next";
import Link from "next/link";

/**
 * /what-this-tool-can-help-with — the public capability map (PRN AI SEO Live
 * Release Final Spec §8). Five task groups, each a question-shaped H2 answered
 * in the very next sentence (WORDING 35), each with its limit stated as a
 * fact. Nothing here is a keyword dump: the machine registry holds the
 * patterns; this page holds the families a person can use.
 */
export const metadata: Metadata = {
  title: "What this tool can help with",
  robots: { index: false, follow: false },
};

const GROUPS: Array<{
  eyebrow: string;
  items: Array<{ q: string; a: string }>;
  limit: string;
}> = [
  {
    eyebrow: "Understand what is happening",
    items: [
      {
        q: "What does warm air from your AC make more or less likely?",
        a: "Each look you take, at the filter, the outdoor unit, the fan and the fins, moves one cause up or down the list, and the packet shows the list with the reason beside each row.",
      },
      {
        q: "What is still missing after you have looked?",
        a: "The packet lists every unknown with why it is unknown, so a technician can tell the difference between a thing you could not reach and a thing nobody asked.",
      },
    ],
    limit: "The list ranks possibilities. Naming the cause takes a technician with gauges and a meter on site.",
  },
  {
    eyebrow: "Use photos and equipment information",
    items: [
      {
        q: "Can one photo of the label fill in the brand, model, serial and age?",
        a: "A readable rating plate can fill all four from one photo, and you tap once to confirm what was read before it goes on the packet.",
      },
      {
        q: "What should you photograph?",
        a: "The label on the outdoor unit, the thermostat as it is right now, the outdoor unit from the side and from above, and the disconnect box with its cover open.",
      },
    ],
    limit: "A blurry or worn label reads as unknown, and you can type it or say you cannot get to it.",
  },
  {
    eyebrow: "Separate reported from observed from confirmed",
    items: [
      {
        q: "How does the packet tell what you said from what a photo shows?",
        a: "Every fact carries a label: reported, seen in a photo, read from the label, confirmed by you, an inference to verify, unknown, or a technician-only test.",
      },
      {
        q: "What still needs professional measurement?",
        a: "Refrigerant charge, the indoor coil, the capacitor and the compressor need tools and training, and the packet lists them as technician-only rather than guessing.",
      },
    ],
    limit: "Confirmed means you confirmed it. Verified by a provider arrives when providers can sign a packet.",
  },
  {
    eyebrow: "Decide what is safe to inspect",
    items: [
      {
        q: "What can you look at without opening anything?",
        a: "The filter, the thermostat screen, the outdoor unit from outside its grille, and the disconnect box with its cover open and your hands out of it.",
      },
      {
        q: "When should you stop and call instead?",
        a: "A smell of gas, burning from the breaker box, or standing water around the outdoor unit and the panel stops the walkthrough at once and shows the safety guidance first.",
      },
    ],
    limit: "Nothing here asks you to remove a panel, touch wiring, test with a meter or get on a ladder.",
  },
  {
    eyebrow: "Prepare for a provider",
    items: [
      {
        q: "What should a technician know before arriving?",
        a: "The equipment, the symptom, when it started, what you checked and what it changed, the photos, and the list of what is still unknown, all on a 3-page Job Packet you can send ahead.",
      },
      {
        q: "What can you say on the phone?",
        a: "Page 1 carries a call script in your own facts, ending with the offer to send the photos and the packet before they come out.",
      },
    ],
    limit: "The packet states no price. Scope factors are listed and the provider prices them.",
  },
];

export default function CapabilityMapPage() {
  return (
    <main>
      <section className="section">
        <div className="wrap-narrow">
          <div className="eyebrow">The map</div>
          <h1 className="d1">What this tool can help with.</h1>
          <p className="lede" style={{ margin: "18px 0 0" }}>
            One trade in this trial: your AC running but blowing warm air, in Allen County, Indiana.
            Here is what a walkthrough can settle, and the limit on each.
          </p>
        </div>
      </section>
      {GROUPS.map((g) => (
        <section className="section section-light" key={g.eyebrow} style={{ paddingTop: 36, paddingBottom: 36 }}>
          <div className="wrap-narrow">
            <div className="eyebrow">{g.eyebrow}</div>
            {g.items.map((item) => (
              <div key={item.q} style={{ margin: "14px 0 0" }}>
                <h2 className="d3" style={{ margin: "0 0 6px" }}>
                  {item.q}
                </h2>
                <p>{item.a}</p>
              </div>
            ))}
            <p className="hint" style={{ marginTop: 14 }}>
              <strong>The limit:</strong> {g.limit}
            </p>
          </div>
        </section>
      ))}
      <section className="section">
        <div className="wrap-narrow">
          <Link href="/problems/ac-blowing-warm-air" className="btn btn-pink">
            Start with what your AC is doing
          </Link>
        </div>
      </section>
    </main>
  );
}
