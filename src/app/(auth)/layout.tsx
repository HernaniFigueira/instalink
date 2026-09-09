import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center font-black text-zinc-950">IL</div>
          <span className="font-bold text-lg">InstaLink<span className="text-emerald-400">.app</span></span>
        </Link>
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">{children}</div>
      </div>
    </main>
  );
}
