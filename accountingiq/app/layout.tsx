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
  title: "WorkFlowIQ — Your AI-Powered Workspace",
  description: "AI-powered workspace with AccountingIQ and ResearchIQ.",
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
