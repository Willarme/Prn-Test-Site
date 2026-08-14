/**
 * Future Feature Lab (#14A §16): honest concept pages for the four approved
 * test doors (SEO_DOORS Wave 6 set). Genuinely useful content, transparent
 * that the personalized runtime is not live, measured interest.
 */
export interface FeatureConcept {
  slug: string;
  name: string;
  card_hook: string;
  card_line: string;
  headline: string;
  pitch: string;
  what_it_will_do: string[];
  honest_status: string;
}

export const FEATURE_CONCEPTS: readonly FeatureConcept[] = [
  {
    slug: "diy-packet",
    name: "DIY Packet",
    card_hook: "Could you handle this yourself?",
    card_line: "Difficulty, tools, parts and step-by-step guidance — with clear stop points.",
    headline: "Know when DIY makes sense — and exactly when to stop.",
    pitch:
      "Some home problems are a genuinely reasonable Saturday project. Others look like one until step four. The DIY Packet will take the same organized problem record you already built and turn it into an honest difficulty rating, a tools-and-parts list, step-by-step guidance, and — most importantly — the specific signs that mean stop and call a professional.",
    what_it_will_do: [
      "Difficulty rating calibrated to your actual problem, not a generic article",
      "Tools and parts list with what each is for",
      "Step-by-step guidance with explicit stop/safety points",
      "A clean handoff: if you stop halfway, your packet already shows a pro what's done",
    ],
    honest_status:
      "This is a concept we're testing interest in. The personalized DIY runtime is not live yet — your click and thumbs help us decide what to build next.",
  },
  {
    slug: "smartquote",
    name: "SmartQuote Analyzer",
    card_hook: "Already have a quote?",
    card_line: "Understand what's included, what's missing, and what to ask before you approve.",
    headline: "Read a quote like someone who's seen a thousand of them.",
    pitch:
      "Quotes for the same job can differ wildly — not because someone is cheating, but because they include different things. SmartQuote will read a quote against your problem record and show what's covered, what's ambiguous, what's missing entirely, and the three questions worth asking before you sign anything.",
    what_it_will_do: [
      "Line-by-line breakdown in plain language",
      "What's included vs. missing vs. ambiguous for YOUR problem",
      "The questions to ask before approving",
      "Same-packet comparisons when you have more than one quote",
    ],
    honest_status:
      "Concept test — quote upload and analysis are not live yet. Interest here directly shapes whether this gets built.",
  },
  {
    slug: "provider-tracking",
    name: "Provider Tracking",
    card_hook: "Know what's happening without chasing anyone.",
    card_line: "Accepted, scheduled, on the way, complete — one place, no phone tag.",
    headline: "The end of “just checking in” texts.",
    pitch:
      "Once a provider takes your job, the questions start: did they get the details? When are they coming? Are they on the way? Provider Tracking will show the whole arc — accepted, scheduled, on the way, complete — in one quiet timeline, so nobody has to chase anybody.",
    what_it_will_do: [
      "One timeline from accepted to complete",
      "Notifications only on meaningful changes — no chatter",
      "Shared view: you and the provider see the same state",
    ],
    honest_status:
      "Concept test — live provider status requires the provider network layer, which comes after the trial proves the core. No fake statuses here, ever.",
  },
  {
    slug: "property-dashboard",
    name: "Your Property Dashboard",
    card_hook: "Your home's important history, finally in one place.",
    card_line: "Problems, repairs, providers, packets and the people you trust.",
    headline: "Every home has a story. Yours should be written down.",
    pitch:
      "Who fixed the water heater in 2024? What did the roof repair cover? Which breaker was flaky? The Property Dashboard will keep your home's problems, repairs, packets, providers and trusted people in one private place — so the next problem starts from memory instead of zero.",
    what_it_will_do: [
      "Every request and Job Packet, kept",
      "Your Home People — the providers you'd actually call again",
      "Equipment, warranties and maintenance reminders, eventually",
      "Private by default; yours to export",
    ],
    honest_status:
      "Concept test — the full dashboard runtime is deliberately later. Claiming your requests via magic link (the seed of this) arrives earlier.",
  },
] as const;

export function findConcept(slug: string): FeatureConcept | null {
  return FEATURE_CONCEPTS.find((c) => c.slug === slug) ?? null;
}
