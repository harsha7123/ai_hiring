import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt } from "@/lib/crypto";

/**
 * OmniDimension REST client (https://docs.omnidim.io/docs/api-reference).
 * Auth: Authorization: Bearer <api key>. Same base URL as the official Python SDK.
 */
const BASE = (process.env.OMNIDIM_BASE_URL || "https://backend.omnidim.io/api/v1").replace(/\/$/, "");

export class OmnidimError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** Per-tenant key wins; otherwise the platform key from the environment. */
export function resolveOmnidimKey(org: { omnidimApiKeyEnc: string | null }): string | null {
  if (org.omnidimApiKeyEnc) return decrypt(org.omnidimApiKeyEnc);
  return process.env.OMNIDIM_API_KEY || null;
}

async function request<T>(apiKey: string, method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new OmnidimError(`OmniDimension ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`, res.status);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function createInterviewAgent(apiKey: string, opts: { orgName: string; webhookUrl: string }): Promise<number> {
  const org = opts.orgName;
  const res = await request<{ id?: number; agent_id?: number; data?: { id?: number } }>(apiKey, "POST", "agents/create", {
    name: `${org} - Screening Interviewer`.slice(0, 80),
    welcome_message: `Hello, I'm an AI interview assistant for ${org}. Before we start: I am an AI, not a person, and this conversation is recorded for the hiring team. Ready to begin?`,
    context_breakdown: [
      {
        title: "Identity and disclosure",
        body: `You are an AI screening interviewer acting for ${org}. You are always honest that you are an AI assistant and that the conversation is recorded. This session's details are in the session context: candidate_name, company_name, role_title, role_summary and questions. Address the candidate by candidate_name.`,
      },
      {
        title: "Interview flow",
        body: "Ask the numbered questions in the session context field 'questions' one at a time, in order. Let the candidate finish. If an answer is vague, generic, or a claim is not backed up, ask exactly one specific follow-up asking for a concrete example of what they personally did. Do not evaluate, praise or criticise answers. Keep the whole interview under twelve minutes; if time runs short, skip to the last (logistics) question.",
      },
      {
        title: "Candidate questions",
        body: "If the candidate asks about the role, answer only using role_summary. If the answer is not there, say the hiring team will follow up on that. Never promise an outcome, salary, offer or timeline.",
      },
      {
        title: "Opting out",
        body: "If the candidate does not want to be interviewed by an AI, or asks to speak to a person, respect that immediately: thank them, confirm the recruiting team will contact them personally, and end the conversation politely.",
      },
      {
        title: "Language",
        body: "Speak clear, friendly, simple English. If the candidate replies in Hinglish, you may reply in simple Hinglish.",
      },
      {
        title: "Closing",
        body: "After the last question, thank the candidate, tell them the hiring team will review the conversation and get back to them, then end the conversation.",
      },
    ],
    post_call_actions: {
      webhook: {
        enabled: true,
        url: opts.webhookUrl,
        include: ["summary", "fullConversation", "sentiment", "extracted_variables"],
        extracted_variables: [
          { key: "notice_period", prompt: "The candidate's stated notice period or joining availability, verbatim if possible." },
          { key: "expected_compensation", prompt: "The candidate's stated compensation expectation, verbatim if possible." },
          { key: "wants_human", prompt: "true if the candidate declined the AI interview or asked for a human, otherwise false." },
        ],
      },
    },
  });
  const id = res.id ?? res.agent_id ?? res.data?.id;
  if (!id) throw new OmnidimError("OmniDimension did not return an agent id");
  return Number(id);
}

/**
 * Called once right after a new organisation is created. With a platform-wide
 * OMNIDIM_API_KEY set (so every company doesn't have to find, paste and verify
 * its own OmniDimension key just to get started), this creates and saves the
 * interview agent automatically — the workspace shows up in Settings already
 * "Connected". Best-effort and silent: a missing key, an unreachable API, or no
 * public APP_URL yet just leaves the workspace "Not configured", same as
 * before this existed, and an admin can still set it up (or override with
 * their own key) from Settings at any time. Must never fail signup.
 */
export async function autoProvisionVoiceAgent(org: { id: string; name: string; webhookSecret: string }): Promise<void> {
  const apiKey = process.env.OMNIDIM_API_KEY;
  if (!apiKey) return;
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const webhookUrl = `${appUrl}/api/webhooks/omnidim/${org.webhookSecret}`;
  if (process.env.NODE_ENV === "production" && !webhookUrl.startsWith("https://")) return;
  try {
    const agentId = await createInterviewAgent(apiKey, { orgName: org.name, webhookUrl });
    await db.update(schema.organizations).set({ omnidimAgentId: agentId }).where(eq(schema.organizations.id, org.id));
  } catch (err) {
    console.error(`auto-provisioning OmniDimension agent for org ${org.id} failed:`, err);
  }
}

/**
 * Creates a browser voice session: the candidate talks to the agent through
 * their own microphone on our page, never a phone call. The client connects
 * to `wsUrl` with the `@omnidim-ai/client` SDK.
 */
export async function createWebSession(
  apiKey: string,
  opts: { agentId: number; customVariables: Record<string, string>; metadata: Record<string, string> },
): Promise<{ sessionId: string; wsUrl: string; expiresAt: string | null }> {
  const res = await request<{ session_id?: number; token?: string; ws_url?: string; expires_at?: string }>(apiKey, "POST", "sessions/create", {
    agent_id: opts.agentId,
    type: "voice",
    custom_variables: opts.customVariables,
    metadata: opts.metadata,
  });
  if (!res.ws_url || res.session_id == null) throw new OmnidimError("OmniDimension did not return a session");
  return { sessionId: String(res.session_id), wsUrl: res.ws_url, expiresAt: res.expires_at ?? null };
}

export type CallLog = Record<string, unknown>;

export async function listCallLogs(apiKey: string, agentId: number, pagesize = 100): Promise<CallLog[]> {
  const res = await request<{ call_log_data?: CallLog[] }>(apiKey, "GET", "calls/logs", undefined, { agentid: agentId, pageno: 1, pagesize });
  return res.call_log_data ?? [];
}

export async function testKey(apiKey: string): Promise<void> {
  await request(apiKey, "GET", "agents", undefined, { pageno: 1, pagesize: 1 });
}

// ---------- Tolerant result parsing (webhook payloads and call logs) ----------

/** Depth-first search for the first non-empty value under any of the given keys. */
export function findKey(obj: unknown, keys: string[], depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 5) return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) if (rec[k] !== undefined && rec[k] !== null && rec[k] !== "") return rec[k];
  for (const v of Object.values(rec)) {
    const found = findKey(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export type CallResult = {
  interviewId: string | null;
  callLogId: string | null;
  status: "completed" | "no_answer" | "failed" | "in_progress";
  transcript: string | null;
  recordingUrl: string | null;
  durationSec: number | null;
  summary: string | null;
  toNumber: string | null;
  timeOfCall: Date | null;
  wantsHuman: boolean;
};

function transcriptToText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) {
    const out = v
      .map((t) => {
        if (typeof t === "string") return t;
        const r = t as Record<string, unknown>;
        const who = String(r.role ?? r.speaker ?? r.from ?? "").toLowerCase();
        const text = r.content ?? r.text ?? r.message ?? r.user_query ?? "";
        const label = /bot|assistant|agent|ai/.test(who) ? "Interviewer" : who ? "Candidate" : "";
        const pair = r.user_query || r.bot_response ? `Candidate: ${r.user_query ?? ""}\nInterviewer: ${r.bot_response ?? ""}` : null;
        return pair ?? (label ? `${label}: ${text}` : String(text));
      })
      .join("\n")
      .trim();
    return out || null;
  }
  return null;
}

export function parseCallResult(payload: unknown): CallResult {
  const rawStatus = String(findKey(payload, ["call_status", "status", "callStatus"]) ?? "").toLowerCase();
  const transcript = transcriptToText(findKey(payload, ["call_conversation", "fullConversation", "full_conversation", "transcript", "conversation", "interactions"]));
  const recording = findKey(payload, ["recording_url", "recordingUrl", "recording"]);
  const duration = Number(findKey(payload, ["call_duration_in_seconds", "duration_seconds", "duration"]));
  const wantsHuman = String(findKey(payload, ["wants_human"]) ?? "").toLowerCase() === "true";
  const time = findKey(payload, ["time_of_call", "call_time", "created_at"]);
  const parsedTime = typeof time === "string" ? new Date(time) : null;

  let status: CallResult["status"];
  if (/no.?answer|busy|voicemail|not.?answered|missed|unreachable/.test(rawStatus)) status = "no_answer";
  else if (/fail|error|cancel|reject/.test(rawStatus)) status = "failed";
  else if (/complete|ended|finished|success|done/.test(rawStatus) || (transcript && transcript.length > 0)) status = "completed";
  else status = "in_progress";

  const summary = findKey(payload, ["summary", "call_summary"]);
  return {
    interviewId: (findKey(payload, ["interview_id"]) as string | undefined) ?? null,
    callLogId: ((): string | null => {
      const v = findKey(payload, ["call_log_id", "callLogId", "call_id", "id"]);
      return v == null ? null : String(v);
    })(),
    status,
    transcript,
    recordingUrl: typeof recording === "string" && recording.startsWith("http") ? recording : null,
    durationSec: Number.isFinite(duration) ? Math.round(duration) : null,
    summary: typeof summary === "string" ? summary : null,
    toNumber: (findKey(payload, ["to_number", "phone_number", "toNumber"]) as string | undefined) ?? null,
    timeOfCall: parsedTime && !Number.isNaN(parsedTime.getTime()) ? parsedTime : null,
    wantsHuman,
  };
}

export const phoneKey = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "").slice(-10);
