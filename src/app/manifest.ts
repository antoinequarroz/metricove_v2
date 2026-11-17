import type { MetadataRoute } from "next";

// Lets Metricove be added to the Dock or the home screen. Installed icons use the dark variant, as the identity kit asks.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Metricove",
    short_name: "Metricove",
    description: "Calendrier éditorial et publication multi-comptes.",
    start_url: "/",
    display: "standalone",
    background_color: "#efede8",
    theme_color: "#efede8",
    icons: [
      { src: "/brand/metricove/app-dark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/metricove/app-dark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/metricove/maskable-dark-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/metricove/maskable-dark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
