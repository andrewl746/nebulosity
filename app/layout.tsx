import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { earlyThemeScript } from "./map/theme";

// IBM Plex, the owner's pick (2026-10-12): the two weights the type scale uses (VISUAL_REFRESH.md §7)
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Nebulosity",
  description: "The dependency-structure layer for Claude Code",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: browser extensions (QuillBot, say) add attributes to <html> before React loads, and inside
    // VS Code's panel the theme's kind and colors are set on it before the first paint; this ignores attribute
    // differences on this one tag only, never in the page below it
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* inside VS Code's panel, a light or high contrast theme's colors from the first paint (theme.ts); Next puts
            a beforeInteractive script in the head, ahead of the page's own */}
        <Script id="nebulosity-theme" strategy="beforeInteractive">{earlyThemeScript()}</Script>
        {children}
      </body>
    </html>
  );
}
