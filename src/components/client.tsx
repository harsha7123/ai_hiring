"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { buttonClass, cx } from "./ui";

export type FormState = { error?: string; ok?: string } | undefined;

/** Pending flag for ActionForm, which submits via a transition (so useFormStatus stays false). */
const PendingContext = createContext(false);
type Action = (prev: FormState, data: FormData) => Promise<FormState>;

export function SubmitButton({
  children,
  variant,
  size,
  className,
  pendingText,
  confirm,
  name,
  value,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  pendingText?: string;
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const status = useFormStatus();
  const inTransition = useContext(PendingContext);
  const pending = status.pending || inTransition;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cx(buttonClass({ variant, size }), className)}
    >
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}

/**
 * Form bound to a server action that returns { error } or { ok }.
 * Submits through a transition instead of the action prop, because React resets
 * uncontrolled fields after a form action, which would wipe input on validation errors.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  ...rest
}: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean } & Omit<ComponentProps<"form">, "action" | "onSubmit">) {
  const [state, formAction] = useActionState(action, undefined);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(data));
      }}
      {...rest}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state?.error && (
        <p role="alert" className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state?.ok && <p className="mt-3 break-all rounded-lg bg-good-bg px-3 py-2 text-sm text-good">{state.ok}</p>}
    </form>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass({ variant: "secondary", size: "sm" })}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** Re-renders server data while background work is in flight. */
export function AutoRefresh({ active, intervalMs = 8000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass({ variant: "secondary" })}>
      Export PDF
    </button>
  );
}

const ACCEPT = ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp";

/** Uploads files one per request (4 in parallel) so thousands of CVs never hit body limits. */
export function Uploader({ positionId }: { positionId: string }) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: File[]) {
    if (!files.length) return;
    const state = { done: 0, total: files.length, failed: [] as string[] };
    setProgress({ ...state });
    const queue = [...files];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const body = new FormData();
        body.append("file", f);
        try {
          const res = await fetch(`/api/positions/${positionId}/upload`, { method: "POST", body });
          if (!res.ok) state.failed.push(`${f.name}: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
        } catch {
          state.failed.push(`${f.name}: network error`);
        }
        state.done++;
        setProgress({ ...state, failed: [...state.failed] });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    router.refresh();
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload([...e.dataTransfer.files]);
        }}
        onClick={() => input.current?.click()}
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          over ? "border-ink bg-sunken" : "border-line-2 bg-surface hover:bg-sunken/60",
        )}
      >
        <p className="text-sm font-medium text-ink">Drop CVs here, or click to choose files</p>
        <p className="mt-1 text-xs text-ink-3">PDF, DOCX, TXT or scanned images · up to 10 MB each · select hundreds at once</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {progress && (
        <div className="mt-3 text-sm text-ink-2">
          <div className="flex items-center justify-between">
            <span>
              Uploaded {progress.done} of {progress.total}
            </span>
            {progress.done === progress.total && <span className="text-good">Done — processing in background</span>}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="h-full bg-ink transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          {progress.failed.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-bad">
              {progress.failed.slice(0, 10).map((f) => (
                <li key={f}>{f}</li>
              ))}
              {progress.failed.length > 10 && <li>…and {progress.failed.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
