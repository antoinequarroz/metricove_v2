import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Instrument_Serif, Inter, Manrope } from "next/font/google";
import "./globals.css";

// Interface font shared with Alfred (Inter). Geist Mono stays for times and codes.
const inter = Inter({ variable: "--font-ui", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400" });

// Fonts of the visuals made in the Studio (style profiles). Only fetched when a visual uses them.
const grotesque = Bricolage_Grotesque({ variable: "--font-grotesque", subsets: ["latin"], axes: ["wdth"], preload: false });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], preload: false });
// "Net" font of the visuals (was the interface font before Inter): kept so carousels look the same.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], preload: false });

const THEME_SCRIPT = `try{var t=localStorage.getItem("metricove-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "Metricove",
  description: "Calendrier éditorial et publication multi-comptes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* Applies the theme chosen in the sidebar (Clair / Sombre / Auto) before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${geistMono.variable} ${display.variable} ${grotesque.variable} ${manrope.variable} ${geistSans.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
