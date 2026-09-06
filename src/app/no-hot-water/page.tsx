import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "No hot water | Property Response Network",
  robots: { index: false, follow: false },
};

export default function HotWaterPage() {
  return <main><section className="section"><div className="wrap-narrow">
    <div className="eyebrow">Hot water problems</div>
    <h1 className="d1">No hot water, or it runs out in one shower?</h1>
    <p className="lede" style={{ margin: "20px 0" }}>The guided trial currently covers AC cooling. You can describe a hot-water problem and keep it in a Job Packet to share with a provider.</p>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Link className="btn btn-pink" href="/start">Describe my problem</Link>
      <Link className="btn btn-ghost" href="/what-this-tool-can-help-with">What this tool can help with</Link>
    </div>
  </div></section></main>;
}
