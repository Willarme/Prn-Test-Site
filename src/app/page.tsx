import { NativeIntakeForm, rootIntakeEnabled } from "@/components/intake/NativeIntakeForm";
import { readFeatureSnapshot } from "@/platform/features/state";

export default async function Home({ searchParams }: {
  searchParams?: Promise<{ error?: string | string[] }>;
}) {
  const enabled = rootIntakeEnabled(await readFeatureSnapshot());
  const query = await searchParams;
  return (
    <main>
      <section className="section">
        <div className="wrap">
          <div className="eyebrow">One clear next step</div>
          <h1 className="d1">
            Something happened in your home.
            <br />
            <em>Start with what happened.</em>
          </h1>
          <p className="lede" style={{ margin: "22px 0 34px" }}>
            You don&apos;t have to know what broke, what it&apos;s called, or who fixes it.
            Describe it the way you&apos;d tell a neighbor — we turn it into an organized,
            provider-ready Job Packet.
          </p>
          {enabled && <NativeIntakeForm error={query?.error} />}
        </div>
      </section>
      <section className="section section-light">
        <div className="wrap">
          <div className="grid3">
            <div className="cell">
              <span className="tag">01 · Tell us</span>
              <h2 className="d3">Plain words are enough</h2>
              <p>&quot;Water drips through the kitchen ceiling when someone showers.&quot; That&apos;s a perfect start.</p>
            </div>
            <div className="cell">
              <span className="tag">02 · We organize</span>
              <h2 className="d3">One Job Packet</h2>
              <p>Symptoms, timing, photos, context and the questions that matter — organized once, ready for any provider.</p>
            </div>
            <div className="cell">
              <span className="tag">03 · You choose</span>
              <h2 className="d3">Your record to keep</h2>
              <p>Open, download and print your Job Packet. Keep the details ready for your next conversation.</p>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}
