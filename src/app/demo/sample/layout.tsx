import type { Metadata } from "next";
// Native same-origin POST forms need their Origin header. These public sample
// pages carry no private records or capabilities; external referrers stay absent.
export const metadata: Metadata = { title: "Explore the prepared AC example", robots: { index: false, follow: false }, referrer: "same-origin" };
export default function SampleLayout({ children }: { children: React.ReactNode }) { return children; }
