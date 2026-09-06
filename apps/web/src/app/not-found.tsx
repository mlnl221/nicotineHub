export default function NotFound() {
  return (
    <main className="bg-surface text-on-surface flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p>The page you requested does not exist.</p>
      <a href="/" className="underline">
        Back to Nicotine Hub
      </a>
    </main>
  );
}
