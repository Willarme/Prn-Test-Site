import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, JetBrains_Mono, Public_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

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
        <header className="site-header no-print">
          <div className="bar">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden />
              <span className="brand-text">
                Property Response
                <small>Network · Trial</small>
              </span>
            </Link>
            <nav>
              <Link className="btn btn-pink btn-sm" href="/start">
                Start with what happened
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer no-print">
          <div className="wrap mono">
            Property Response Network — trial build. Nothing on this preview is public or indexed.
          </div>
        </footer>
      </body>
    </html>
  );
}
