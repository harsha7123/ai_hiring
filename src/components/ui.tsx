import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const BTN = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
  size: { sm: "h-8 px-3", md: "h-10 px-4" },
  variant: {
    primary: "bg-ink text-white hover:bg-ink/85",
    secondary: "bg-surface text-ink border border-line-2 hover:bg-sunken",
    ghost: "text-ink-2 hover:text-ink hover:bg-sunken",
    danger: "bg-surface text-bad border border-line-2 hover:bg-bad-bg",
  },
};

type BtnOpts = { variant?: keyof typeof BTN.variant; size?: keyof typeof BTN.size };

export const buttonClass = ({ variant = "primary", size = "md" }: BtnOpts = {}) =>
  cx(BTN.base, BTN.size[size], BTN.variant[variant]);

export function Button({ variant, size, className, ...rest }: ComponentProps<"button"> & BtnOpts) {
  return <button className={cx(buttonClass({ variant, size }), className)} {...rest} />;
}

export function ButtonLink({ variant, size, className, ...rest }: ComponentProps<typeof Link> & BtnOpts) {
  return <Link className={cx(buttonClass({ variant, size }), className)} {...rest} />;
}

const FIELD =
  "w-full rounded-lg border border-line-2 bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx(FIELD, "h-10", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx(FIELD, "py-2.5 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select className={cx(FIELD, "h-10 pr-8", className)} {...rest} />;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  neutral: "bg-sunken text-ink-2",
  good: "bg-good-bg text-good",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  info: "bg-info-bg text-info",
  ink: "bg-ink text-white",
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-2 text-sm text-ink-3">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-sm text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx("rounded-lg px-4 py-3 text-sm", TONES[tone])}>{children}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function ScoreBar({ value, max = 100 }: { value: number | null; max?: number }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular w-8 text-right text-sm text-ink">{value == null ? "—" : Math.round(value)}</span>
    </div>
  );
}

export const th = "px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-ink-3";
export const td = "px-4 py-3 text-sm text-ink";
