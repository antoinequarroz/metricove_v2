import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Inter, Instrument_Serif, Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400" });

// Fonts of the visuals made in the Studio (style profiles). Only fetched when a visual uses them.
const grotesque = Bricolage_Grotesque({ variable: "--font-grotesque", subsets: ["latin"], axes: ["wdth"], preload: false });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], preload: false });
const spaceGrotesk = Space_Grotesk({ variable: "--font-space", subsets: ["latin"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  title: "Metricove",
  description: "Calendrier éditorial et publication multi-comptes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${grotesque.variable} ${manrope.variable} ${spaceGrotesk.variable} ${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
