import Link from "next/link";

export function LegalLinks({ className = "mt-10" }: { className?: string }) {
  return (
    <p className={`${className} flex gap-4 text-xs text-ink-3`}>
      <Link href="/privacy" className="hover:text-ink">
        Privacy notice
      </Link>
      <Link href="/terms" className="hover:text-ink">
        Terms
      </Link>
    </p>
  );
}
