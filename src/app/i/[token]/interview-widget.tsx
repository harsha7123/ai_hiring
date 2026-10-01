"use client";

import { useEffect, useRef, useState } from "react";
import { WebSession, type SessionStatus, type TranscriptEvent } from "@omnidim-ai/client";
import { Card, buttonClass, cx } from "@/components/ui";

type Phase = "connecting" | "active" | "saving" | "ended" | "error";

/**
 * Live in-browser voice interview. Connects to the OmniDimension session over
 * WebSocket, captures the candidate's own microphone, plays the agent's voice
 * back, and — the moment the conversation ends — posts the transcript it saw
 * to our server so scoring can run. No phone call, no OmniDimension SDK
 * knowledge needed outside this one component.
 */
export function InterviewWidget({ token, wsUrl }: { token: string; wsUrl: string }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<WebSession | null>(null);
  const startedAt = useRef(0);
  const endedOnce = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<TranscriptEvent[]>([]);

  useEffect(() => {
    const session = new WebSession();
    sessionRef.current = session;
    startedAt.current = Date.now();

    const toLine = (t: TranscriptEvent) => `${t.role === "agent" ? "Interviewer" : "Candidate"}: ${t.text}`;
    const finish = async (reason: string) => {
      if (endedOnce.current) return;
      endedOnce.current = true;
      setPhase("saving");
      const text = transcriptRef.current.map(toLine).join("\n");
      try {
        await fetch(`/api/i/${token}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text, durationSec: Math.round((Date.now() - startedAt.current) / 1000) }),
        });
      } catch {
        // The interview still happened; the recruiter can follow up if this never lands.
      }
      setPhase(reason === "error" ? "error" : "ended");
    };

    session.on("status", (s: SessionStatus) => {
      if (s === "active") setPhase("active");
      else if (typeof s === "object" && s.state === "ended") void finish(s.reason);
    });
    session.on("transcript", (t: TranscriptEvent) => {
      setTranscript((prev) => {
        // Each new chunk for the same speaker as the last line is that line still
        // growing (streaming ASR/TTS text) — replace it in place rather than
        // appending, so one turn stays one line. A new speaker starts a new line.
        const last = prev[prev.length - 1];
        const next = last && last.role === t.role ? [...prev.slice(0, -1), t] : [...prev, t];
        transcriptRef.current = next;
        return next;
      });
    });
    session.on("error", (e: Error) => {
      setError(e.message || "Connection error");
      void finish("error");
    });

    session.start({ wsUrl }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Could not connect");
      setPhase("error");
    });

    return () => {
      session.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wsUrl/token are stable for this widget's lifetime
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [transcript]);

  if (phase === "ended") {
    return (
      <Card className="mt-8 p-6 text-center">
        <p className="font-medium">That&apos;s the interview — thank you.</p>
        <p className="mt-1 text-sm text-ink-2">The hiring team will review the conversation and get back to you.</p>
      </Card>
    );
  }

  if (phase === "error") {
    return (
      <Card className="mt-8 p-6 text-center">
        <p className="font-medium text-bad">{error ?? "Something went wrong."}</p>
        <p className="mt-1 text-sm text-ink-2">Your progress wasn&apos;t lost. Reload this page to try again.</p>
        <button onClick={() => location.reload()} className={cx(buttonClass({ variant: "secondary" }), "mt-4")}>
          Reload
        </button>
      </Card>
    );
  }

  return (
    <Card className="mt-8 overflow-hidden">
      <div className="border-b border-line px-5 py-3 text-sm text-ink-2">
        {phase === "connecting" && "Connecting — please allow microphone access when prompted…"}
        {phase === "active" && "Live — speak naturally, the agent is listening."}
        {phase === "saving" && "Saving your interview…"}
      </div>
      <div ref={listRef} className="h-72 space-y-3 overflow-y-auto p-5">
        {transcript.length === 0 && phase === "active" && <p className="text-sm text-ink-3">Waiting for the first question…</p>}
        {transcript.map((t, i) => (
          <p key={i} className="text-sm leading-relaxed">
            <span className="font-medium text-ink">{t.role === "agent" ? "Interviewer" : "You"}:</span>{" "}
            <span className="text-ink-2">{t.text}</span>
          </p>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <button
          onClick={() => {
            const next = !muted;
            setMuted(next);
            sessionRef.current?.mute(next);
          }}
          className={buttonClass({ variant: "secondary", size: "sm" })}
          disabled={phase !== "active"}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={() => sessionRef.current?.stop()}
          className={buttonClass({ variant: "danger", size: "sm" })}
          disabled={phase === "saving"}
        >
          End interview
        </button>
      </div>
    </Card>
  );
}
