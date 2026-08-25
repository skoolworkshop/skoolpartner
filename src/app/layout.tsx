import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Mijn Skool",
    template: "%s · Mijn Skool",
  },
  description:
    "De klantomgeving van Skool Workshop. Bekijk uw boekingen, facturen, berichten en SkoolPoints op één plek.",
  robots: { index: false, follow: false },
  applicationName: "Mijn Skool",
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className="min-h-dvh antialiased">
        <a href="#hoofdinhoud" className="skip-link">
          Naar de hoofdinhoud
        </a>
        {children}
      </body>
    </html>
  );
}
