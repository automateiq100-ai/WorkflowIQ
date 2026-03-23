import type { Metadata } from "next";
import { DM_Serif_Display, Outfit, DM_Mono } from "next/font/google";
import "./globals.css";

const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "AccountingIQ — Accounting Health Analysis",
  description: "Tally XML analysis engine. 59 checks across 8 dimensions. Score 0–100.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${dmSerif.variable} ${outfit.variable} ${dmMono.variable} h-full`}
    >
      <body className="h-full" style={{ fontFamily: "var(--font-outfit, Outfit, sans-serif)" }}>
        {children}
      </body>
    </html>
  );
}
