import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SessionProvider } from "@/lib/session";
import { ConfigProvider } from "@/lib/config/provider";
import { TransfersProvider } from "@/lib/transfers";
import { DemoBanner } from "@/components/DemoBanner";
import { ConfigBridgeSync } from "@/lib/config/sync";
import { WishlistProvider } from "@/lib/wishlist";
import { StatisticsProvider } from "@/lib/statistics";
import { ToastHost } from "@/components/ToastHost";
import { NowPlayingSync } from "@/components/NowPlayingSync";
import { WebVitals } from "@/components/WebVitals";
import { Footer } from "@/components/Footer";
import { GlobalContextMenu } from "@/components/ui/GlobalContextMenu";

export const metadata: Metadata = {
  title: "Nicotine Hub",
  description: "A mobile-first, browser-first Soulseek client.",
  manifest: "/manifest.webmanifest",
  applicationName: "Nicotine Hub",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Nicotine Hub",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#faf9fa",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Serif:ital,wght@0,400;0,600;0,700;1,400&family=Public+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('nicotine.theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-dvh max-w-[100vw] overflow-x-hidden bg-surface-container-low font-body text-on-surface antialiased selection:bg-primary/30 dark:bg-inverse-surface dark:text-inverse-on-surface">
        <DemoBanner />
        <ThemeProvider>
          <ConfigProvider>
            <SessionProvider>
              <WishlistProvider>
                <StatisticsProvider>
                  <TransfersProvider>
                    <ConfigBridgeSync />
                    <NowPlayingSync />
                    {children}
                    <Footer />
                    <ToastHost />
                    <GlobalContextMenu />
                  </TransfersProvider>
                </StatisticsProvider>
              </WishlistProvider>
            </SessionProvider>
          </ConfigProvider>
        </ThemeProvider>
        <WebVitals />
      </body>
    </html>
  );
}
