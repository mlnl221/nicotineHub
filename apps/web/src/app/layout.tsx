import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nicotine Mobile",
  description: "A mobile-first, browser-first Soulseek client.",
  manifest: "/manifest.webmanifest",
  applicationName: "Nicotine Mobile",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nicotine Mobile",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0e13",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-[#0b0e13] text-white antialiased selection:bg-indigo-500/40">
        {children}
      </body>
    </html>
  );
}
