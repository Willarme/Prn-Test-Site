import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, JetBrains_Mono, Public_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import "./ecosystem.css";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="site-header ecosystem-header no-print">
          <div className="bar">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden />
              <span className="brand-text">
                Property Response
                <small>Network · Trial</small>
              </span>
            </Link>
            <nav className="ecosystem-navigation" aria-label="Preview navigation">
              <Link className="ecosystem-nav-link" href="/demo">
                Explore the demo
              </Link>
              <Link className="ecosystem-header-cta" href={process.env.VERCEL === "1" ? "/demo/sample/walkthrough" : "/start"}>
                {process.env.VERCEL === "1" ? "Try the sample" : "Start with what happened"}
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer ecosystem-footer no-print">
          <div className="wrap ecosystem-footer-inner">
            <div>
              <p className="ecosystem-footer-brand">Property Response Network</p>
              <p>Demonstration · use example details. This preview is not indexed.</p>
            </div>
            <Link className="ecosystem-nav-link" href="/demo">Explore the demo</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
