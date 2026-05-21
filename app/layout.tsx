import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Inter — the industry-standard UI font (Stripe, Brex, Linear, Vercel).
// Excellent legibility at small sizes, real tabular figures, no
// editorial flourish.  Used for both headings and body via weight.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

// JetBrains Mono — for code blocks and formula cells in Backup Working.
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AccountingIQ — Tally XML Accounting Health Analyser",
  description: "Parse Tally XML exports, run 60 compliance checks across 8 dimensions, and get a 0–100 quality score with AI-powered analysis.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full`}
    >
      <body className="h-full" style={{ fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
