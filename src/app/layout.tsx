import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, JetBrains_Mono, Public_Sans } from "next/font/google";
import { CustomerHeader, CustomerFooter } from "@/components/CustomerShell";
import { readFeatureSnapshot } from "@/platform/features/state";
import "./globals.css";
import "./ecosystem.css";

// Navigation uses the current persisted feature snapshot, never a build-time copy.
export const dynamic = "force-dynamic";

// Fonts are self-hosted at build time (next/font) — no runtime CDN dependency.
const display = Archivo({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["wdth"],
});
const body = Public_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: {
    default: "Property Response Network",
    template: "%s · Property Response Network",
  },
  description:
    "Something happened in your home? Start with what happened — we organize the rest into a provider-ready Job Packet.",
  // Trial not launched: nothing indexes until the owner-approved launch wave.
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const snapshot = await readFeatureSnapshot();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <CustomerHeader snapshot={snapshot} />
        {children}
        <CustomerFooter snapshot={snapshot} />
      </body>
    </html>
  );
}
