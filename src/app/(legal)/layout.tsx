import { Logo } from "@/components/brand";
import { LegalLinks } from "@/components/legal-links";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="mx-auto max-w-2xl px-6 pb-20 pt-6">
        <article className="space-y-4 text-[15px] leading-relaxed text-ink-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-ink [&_h2]:pt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </article>
        <LegalLinks />
      </main>
    </div>
  );
}
