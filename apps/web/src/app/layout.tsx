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
import { GlobalContextMenu } from "@/components/ui/GlobalContextMenu";
import { SidebarProvider } from "@/components/SidebarContext";
import { ExitDialogHandler } from "@/components/ExitDialogHandler";
import { WindowGeometrySync } from "@/components/WindowGeometrySync";
import { SpectrumProvider } from "@/lib/spectrum";
import { SearchProvider } from "@/lib/search";
import { BrowseProvider } from "@/lib/browse-tabs";
import { ProfileProvider } from "@/lib/profile-tabs";
import { RoomsProvider } from "@/lib/rooms";
import { PrivateChatProvider } from "@/lib/privateChat";
import { ReconnectBanner } from "@/components/ReconnectBanner";
import { PlayerProvider } from "@/lib/player/store";
import { MiniPlayer } from "@/components/player/MiniPlayer";

const SITE_URL = "https://nicotine-hub-web-phi.vercel.app/";
const SITE_NAME = "Nicotine Hub";
const SITE_DESCRIPTION =
  "Nicotine Hub is a mobile-first, browser-first Soulseek web client with Nicotine+ parity — search, downloads, uploads, chat and shares from any browser. Self-host with Docker.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Nicotine Hub — Soulseek Web Client in Your Browser",
    template: "%s | Nicotine Hub",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "Music",
  authors: [{ name: "Nicotine Hub contributors" }],
  creator: "Nicotine Hub contributors",
  publisher: "Nicotine Hub contributors",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: "Nicotine Hub — Soulseek Web Client in Your Browser",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Nicotine Hub — Soulseek web client",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nicotine Hub — Soulseek Web Client in Your Browser",
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image.png"],
  },
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

const isDemoBuild = process.env.NEXT_PUBLIC_DEMO === "true";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning data-demo={isDemoBuild ? "true" : undefined} style={isDemoBuild ? ({ ["--demo-banner-h" as string]: "0px" } as React.CSSProperties) : undefined}>
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
              "try{var t=localStorage.getItem('nicotineHub.theme')||localStorage.getItem('nicotine.theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}try{if(localStorage.getItem('nicotineHub.demoBannerDismissed')==='0'){document.documentElement.style.setProperty('--demo-banner-h','32px');}else{document.documentElement.style.setProperty('--demo-banner-h','0px');}}catch(e){document.documentElement.style.setProperty('--demo-banner-h','0px')}",
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: SITE_NAME,
              url: SITE_URL,
              applicationCategory: "MultimediaApplication",
              operatingSystem: "Web",
              offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
              isBasedOn: "https://nicotine-plus.org/",
            }),
          }}
        />
      </head>
      <body className="min-h-dvh max-w-full overflow-x-clip bg-surface-container-low font-body text-on-surface antialiased selection:bg-primary/30 dark:bg-inverse-surface dark:text-inverse-on-surface">
        <DemoBanner />
        <SidebarProvider>
        <ThemeProvider>
          <ConfigProvider>
            <SessionProvider>
              <ReconnectBanner />
              <RoomsProvider>
                <PrivateChatProvider>
                  <SearchProvider>
                    <BrowseProvider>
                      <ProfileProvider>
                        <WishlistProvider>
                          <StatisticsProvider>
                            <TransfersProvider>
                              <SpectrumProvider>
                                <ConfigBridgeSync />
                                <ExitDialogHandler />
                                <WindowGeometrySync />
                                <NowPlayingSync />
                                <PlayerProvider>
                                {children}
                                <MiniPlayer />
                                </PlayerProvider>
                                <ToastHost />
                                <GlobalContextMenu />
                              </SpectrumProvider>
                            </TransfersProvider>
                          </StatisticsProvider>
                        </WishlistProvider>
                      </ProfileProvider>
                    </BrowseProvider>
                  </SearchProvider>
                </PrivateChatProvider>
              </RoomsProvider>
            </SessionProvider>
          </ConfigProvider>
        </ThemeProvider>
        </SidebarProvider>
        <WebVitals />
      </body>
    </html>
  );
}
