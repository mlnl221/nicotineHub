import { HomeRedirect } from "./home-redirect";
import { LoginForm } from "@/components/LoginForm";
import { isDemo } from "@/lib/demo";

export const metadata = {
  title: "Soulseek Web Client in Your Browser",
  description:
    "Nicotine Hub is a mobile-first, browser-first Soulseek web client with Nicotine+ parity. Search, download, chat and manage shares from any browser — self-host with Docker.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <div suppressHydrationWarning className="relative flex min-h-dvh items-center justify-center overflow-x-hidden bg-surface font-body text-on-surface dark:bg-inverse-surface dark:text-inverse-on-surface px-6 py-12">
      {/* Ambient background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% -20%, rgba(51,102,204,0.15) 0%, transparent 60%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 opacity-30 dark:opacity-10" style={{ backgroundImage: "radial-gradient(circle at 50% 120%, rgba(9,76,178,0.08) 0%, transparent 50%)" }} />

      <HomeRedirect />

      <main className="relative z-10 flex w-full max-w-md flex-col items-center">
        {/* SSR marketing copy */}
        <section aria-label="About Nicotine Hub" className="mb-8 w-full text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface dark:text-inverse-on-surface">
            Soulseek web client in your browser
          </h1>
          <p className="mt-3 font-body text-sm leading-relaxed text-on-surface-variant dark:text-outline-variant">
            Nicotine Hub is a mobile-first, browser-first Soulseek-compatible web client
            with Nicotine+ parity. Search, download, chat and manage shares from any
            browser — self-host with Docker. Unofficial community project.
          </p>
          <ul className="mt-5 space-y-2 text-left font-body text-sm text-on-surface-variant dark:text-outline-variant">
            <li className="glass-panel rounded-xl px-4 py-3">Search &amp; downloads — multi-mode search, queue and transfer management.</li>
            <li className="glass-panel rounded-xl px-4 py-3">Mobile PWA — Add to Home Screen on Android and iPhone for an app-like experience.</li>
            <li className="glass-panel rounded-xl px-4 py-3">Self-host with Docker — run the web UI on port 3000 on your homelab or NAS.</li>
            <li className="glass-panel rounded-xl px-4 py-3">Spectrum lossless verify — inspect spectrograms to verify lossless quality.</li>
          </ul>
        </section>

        <section aria-label="Frequently asked questions" className="mb-8 w-full text-left">
          <h2 className="mb-3 text-center font-display text-lg font-semibold text-on-surface dark:text-inverse-on-surface">
            Frequently asked questions
          </h2>
          <div className="space-y-2">
            <details className="glass-panel rounded-xl px-4 py-3">
              <summary className="cursor-pointer font-body text-sm font-semibold text-on-surface dark:text-inverse-on-surface">
                Do I need a desktop app?
              </summary>
              <p className="mt-2 font-body text-sm leading-relaxed text-on-surface-variant dark:text-outline-variant">
                No. Nicotine Hub runs entirely in your browser — search, download, chat and
                manage shares with nothing to install beyond a self-hosted Docker container.
              </p>
            </details>
            <details className="glass-panel rounded-xl px-4 py-3">
              <summary className="cursor-pointer font-body text-sm font-semibold text-on-surface dark:text-inverse-on-surface">
                Is there a Soulseek app for mobile/iPhone?
              </summary>
              <p className="mt-2 font-body text-sm leading-relaxed text-on-surface-variant dark:text-outline-variant">
                Nicotine Hub is a mobile-first progressive web app (PWA). On Android and
                iPhone, open it in your browser and use Add to Home Screen for an app-like
                experience.
              </p>
            </details>
            <details className="glass-panel rounded-xl px-4 py-3">
              <summary className="cursor-pointer font-body text-sm font-semibold text-on-surface dark:text-inverse-on-surface">
                Is Nicotine Hub affiliated with Soulseek or Nicotine+?
              </summary>
              <p className="mt-2 font-body text-sm leading-relaxed text-on-surface-variant dark:text-outline-variant">
                No. Nicotine Hub is an unofficial, independent project and is not affiliated
                with or endorsed by Soulseek or Nicotine+. Names are used nominatively to
                describe compatibility. See{" "}
                <a className="underline" href="https://www.slsknet.org">slsknet.org</a> and{" "}
                <a className="underline" href="https://nicotine-plus.org">nicotine-plus.org</a>.
              </p>
            </details>
          </div>
        </section>

        {/* Logo and header */}
        <div suppressHydrationWarning className="mb-8 flex w-full flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="Nicotine Hub"
            width={220}
            height={120}
            className="mb-4 h-auto w-[220px] max-w-[70vw] object-contain drop-shadow-[0_4px_24px_rgba(9,76,178,0.12)]"
            suppressHydrationWarning
          />
          <p className="font-body text-sm text-on-surface-variant dark:text-outline-variant">
            {isDemo ? "Enter any username and password to try the demo." : "Enter any username and password to sign in."}
          </p>
        </div>

        <div className="w-full glass-panel p-6 md:p-8 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-surface-container-high dark:border-white/10">
          <LoginForm />
        </div>

        <p className="mt-8 font-body text-[11px] leading-relaxed text-center text-on-surface-variant/60">
          Unofficial project. Soulseek and Nicotine+ are third-party marks. Share only files
          you own or have rights to. Passwords never stored.
        </p>
      </main>
    </div>
  );
}
