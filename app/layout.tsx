import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { earlyThemeScript } from "./map/theme";

// Archivo for the text and JetBrains Mono for names, paths and code, the Workbench mockups' fonts and the owner's pick of
// 2026-10-27 (ADR-070). next/font serves them from the Map's own server, so they work offline and inside VS Code's panel
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
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
      className={`${archivo.variable} ${jetbrainsMono.variable} h-full antialiased`}
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
