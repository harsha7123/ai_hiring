import { Logo } from "@/components/brand";
import { ButtonLink } from "@/components/ui";

const STEPS = [
  { n: "01", title: "Every CV, same rubric", body: "Each CV is parsed, structured and scored against your confirmed requirements. Every sub-score links to the line in the CV that justifies it." },
  { n: "02", title: "Consent-first voice interviews", body: "Candidates choose a time, then take a structured 8–12 minute AI interview built from the gap between their CV and your JD." },
  { n: "03", title: "Re-ranked on evidence", body: "Interview answers are scored on a fixed rubric and combined with CV scores using weights you control." },
  { n: "04", title: "A shortlist you can audit", body: "Your panel gets exactly the number requested, each with a report that quotes what the candidate actually wrote or said." },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost">
            Sign in
          </ButtonLink>
          <ButtonLink href="/signup">Get started</ButtonLink>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 sm:pt-28">
          <p className="text-sm font-medium text-ink-3">AI recruitment screening</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-6xl">
            From a thousand CVs to twenty finalists in two days.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-2">
            Shortlist ranks every CV against your job description, conducts structured voice interviews at scale, and hands
            your panel a ranked shortlist where every score is traceable to a source.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <ButtonLink href="/signup">Create your workspace</ButtonLink>
            <ButtonLink href="/login" variant="secondary">
              Sign in
            </ButtonLink>
          </div>

          <dl className="mt-20 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
            {[
              ["1,000+", "CVs screened per role"],
              ["200", "AI voice interviews"],
              ["Top 20", "shortlist delivered"],
              ["48 hrs", "typical turnaround"],
            ].map(([v, l]) => (
              <div key={l} className="bg-surface px-6 py-6">
                <dt className="tabular text-2xl font-semibold text-ink">{v}</dt>
                <dd className="mt-1 text-sm text-ink-3">{l}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n}>
                <div className="tabular text-sm text-ink-3">{s.n}</div>
                <h3 className="mt-3 font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-10 lg:grid-cols-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Decision support, not decision making.</h2>
            </div>
            <div className="grid gap-6 text-sm leading-relaxed text-ink-2 sm:grid-cols-2 lg:col-span-2">
              <p><span className="font-medium text-ink">Explicit consent.</span> No candidate is called without timestamped consent, and every call opens by disclosing the AI and the recording.</p>
              <p><span className="font-medium text-ink">Bias controls.</span> Name, gender, age, religion, caste, marital status and photographs are removed before any scoring.</p>
              <p><span className="font-medium text-ink">Tenant isolation.</span> Every organisation&apos;s roles, candidates and recordings are scoped and access-logged.</p>
              <p><span className="font-medium text-ink">Human override.</span> The platform ranks and recommends. Your team decides, and can promote any candidate at any stage.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-ink-3">
          <span>© {new Date().getFullYear()} Shortlist</span>
          <span>Data encrypted in transit and at rest</span>
        </div>
      </footer>
    </div>
  );
}
