import { LoginForm } from "@/components/LoginForm";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
      {/* Brand / hero */}
      <header className="flex flex-1 flex-col items-center justify-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-2xl font-black shadow-xl shadow-indigo-500/30">
          N
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Nicotine Mobile</h1>
        <p className="text-sm text-zinc-400">Your Soulseek network, in the browser.</p>
      </header>

      <LoginForm />
    </main>
  );
}
