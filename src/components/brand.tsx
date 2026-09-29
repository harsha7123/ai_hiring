import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
      <span className="grid size-6 place-items-center rounded-md bg-ink text-[11px] font-bold text-white">S</span>
      <span className="hidden sm:inline">Shortlist</span>
    </Link>
  );
}
