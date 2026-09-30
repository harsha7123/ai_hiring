import { z } from "zod";
import type {
  CvAssessment,
  CvProfile,
  InterviewAssessment,
  InterviewQuestion,
  ReportContent,
  RequirementSpec,
} from "@/db/schema";
import { quoteIsGrounded } from "@/lib/redact";
import { isDemoMode, plainText, structured, MODELS } from "./client";
import * as demo from "./demo";

const BIAS_RULE =
  "Never consider or infer name, gender, age, religion, caste, marital status, nationality, photograph or any other protected attribute. Judge only job-relevant evidence.";

// ---------- Requirement spec ----------

const SpecSchema = z.object({
  summary: z.string().describe("Two sentences describing the role"),
  mustHave: z.array(z.string()).describe("Required skills, short names, 3-10 items"),
  niceToHave: z.array(z.string()),
  minYears: z.number().nullable(),
  maxYears: z.number().nullable(),
  qualifications: z.array(z.string()),
  location: z.string().nullable(),
  shift: z.string().nullable(),
});

export async function extractSpec(jd: string): Promise<RequirementSpec> {
  if (isDemoMode()) return demo.extractSpec(jd);
  const { data } = await structured({
    tier: "smart",
    schema: SpecSchema,
    system:
      "You turn job descriptions into a structured requirement spec for CV screening. Use short canonical skill names (e.g. 'Kubernetes', 'SQL'). Only include what the JD actually states or clearly implies; do not invent requirements.",
    content: `<job_description>\n${jd}\n</job_description>`,
  });
  return data;
}

// ---------- OCR fallback for scanned CVs ----------

export async function ocrDocument(buf: Buffer, mime: string): Promise<string> {
  if (isDemoMode()) throw new Error("Scanned CVs need OCR, which requires a configured OPENAI_API_KEY");
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const block =
    mime === "application/pdf"
      ? ({ type: "input_file", filename: "cv.pdf", file_data: dataUrl } as const)
      : ({ type: "input_image", image_url: dataUrl, detail: "high" } as const);
  return plainText({
    tier: "fast",
    system: "You are an OCR engine. Transcribe every piece of text in the document verbatim, preserving line breaks. Output only the text.",
    content: [block, { type: "input_text", text: "Transcribe this CV." }],
  });
}

// ---------- CV profile ----------

const ProfileSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable().describe("With country code if present, e.g. +91..."),
  location: z.string().nullable(),
  totalYears: z.number().nullable().describe("Total years of professional experience"),
  currentTitle: z.string().nullable(),
  employment: z.array(
    z.object({ title: z.string(), company: z.string(), start: z.string().nullable(), end: z.string().nullable() }),
  ),
  skills: z.array(z.object({ name: z.string(), years: z.number().nullable() })),
  education: z.array(z.string()),
  gaps: z.array(z.string()).describe("Employment gaps longer than 6 months, e.g. 'Mar 2020 - Jan 2021'"),
});

export async function structureProfile(cvText: string): Promise<CvProfile> {
  if (isDemoMode()) return demo.structureProfile(cvText);
  const { data } = await structured({
    tier: "fast",
    schema: ProfileSchema,
    system: "Extract a structured, factual profile from a CV. Use null when a field is not stated. Do not guess.",
    content: `<cv>\n${cvText}\n</cv>`,
  });
  return data;
}

// ---------- CV rubric assessment ----------

export const CV_DIMENSIONS = [
  { name: "Must-have skills", weight: 0.4 },
  { name: "Relevant experience", weight: 0.25 },
  { name: "Stability & progression", weight: 0.15 },
  { name: "Nice-to-have skills", weight: 0.1 },
  { name: "Qualifications", weight: 0.1 },
] as const;

const CvAssessSchema = z.object({
  dimensions: z.array(
    z.object({
      name: z.string(),
      score: z.number().describe("0-10"),
      rationale: z.string().describe("One or two sentences"),
      evidence: z.array(z.string()).describe("Verbatim excerpts copied exactly from the CV"),
    }),
  ),
  mustHaveCoverage: z.array(
    z.object({ skill: z.string(), present: z.boolean(), evidence: z.string().nullable() }),
  ),
  summary: z.string(),
});

export async function assessCv(redactedCv: string, spec: RequirementSpec): Promise<{ assessment: CvAssessment; score: number }> {
  const raw = isDemoMode()
    ? demo.assessCv(redactedCv, spec)
    : (
        await structured({
          tier: "fast",
          schema: CvAssessSchema,
          system: `You score CVs against a requirement spec using a fixed rubric. Score each dimension 0-10: ${CV_DIMENSIONS.map((d) => d.name).join(", ")}. Every evidence item must be copied character-for-character from the CV; if there is no supporting text, give no evidence and a low score. For each must-have skill state whether the CV evidences it. ${BIAS_RULE}`,
          content: `<spec>\n${JSON.stringify(spec, null, 2)}\n</spec>\n<cv>\n${redactedCv}\n</cv>`,
        })
      ).data;
  return groundCvAssessment(raw, redactedCv);
}

/** Enforce the design principle: drop any evidence not found in the source text. */
function groundCvAssessment(raw: z.infer<typeof CvAssessSchema>, cv: string) {
  const dimensions = CV_DIMENSIONS.map((d) => {
    const found = raw.dimensions.find((x) => x.name.toLowerCase() === d.name.toLowerCase());
    const evidence = [...new Set(found?.evidence ?? [])].filter((q) => quoteIsGrounded(q, cv)).slice(0, 3);
    let score = clamp(found?.score ?? 0, 0, 10);
    // A high score with zero surviving evidence is not defensible; cap it.
    if (evidence.length === 0) score = Math.min(score, 4);
    return { name: d.name, score, rationale: found?.rationale ?? "Not assessed.", evidence };
  });
  const mustHaveCoverage = raw.mustHaveCoverage.map((m) => {
    const grounded = m.evidence && quoteIsGrounded(m.evidence, cv) ? m.evidence : null;
    return { skill: m.skill, present: m.present && grounded !== null, evidence: grounded };
  });
  const score = Math.round(
    CV_DIMENSIONS.reduce((sum, d, i) => sum + dimensions[i].score * 10 * d.weight, 0),
  );
  return { assessment: { dimensions, mustHaveCoverage, summary: raw.summary, knockout: null }, score };
}

// ---------- Interview question design ----------

const QuestionsSchema = z.object({
  questions: z.array(z.object({ question: z.string(), purpose: z.string() })),
});

export async function designQuestions(opts: {
  redactedCv: string;
  spec: RequirementSpec;
  assessment: CvAssessment | null;
  customQuestions: string[];
}): Promise<InterviewQuestion[]> {
  if (isDemoMode()) return demo.designQuestions(opts.spec, opts.assessment, opts.customQuestions);
  const { data } = await structured({
    tier: "smart",
    schema: QuestionsSchema,
    system: `You design an 8-12 minute structured phone screening for one candidate. Write 6-8 spoken-style questions: probe must-have skills, test CV claims that are not evidenced, ask one practical scenario question, and end with logistics (notice period, compensation expectation, location/shift). Include the recruiter's custom questions verbatim. Questions must be answerable by voice, one topic each. ${BIAS_RULE}`,
    content: `<spec>\n${JSON.stringify(opts.spec)}\n</spec>\n<cv_assessment>\n${JSON.stringify(opts.assessment)}\n</cv_assessment>\n<custom_questions>\n${opts.customQuestions.join("\n") || "none"}\n</custom_questions>\n<cv>\n${opts.redactedCv}\n</cv>`,
  });
  return data.questions.slice(0, 10);
}

// ---------- Interview assessment + report ----------

export const INTERVIEW_DIMENSIONS = [
  "Role fit",
  "Depth on claimed skills",
  "Communication",
  "Problem reasoning",
  "Logistics alignment",
] as const;

const EvidenceSchema = z.object({ quote: z.string(), source: z.enum(["cv", "transcript"]) });

const InterviewSchema = z.object({
  dimensions: z.array(
    z.object({ name: z.string(), score: z.number().describe("0-10"), rationale: z.string(), evidence: z.array(z.string()) }),
  ),
  skillVerification: z.array(
    z.object({
      skill: z.string(),
      claimedOnCv: z.boolean(),
      probed: z.boolean(),
      substantiated: z.enum(["yes", "partly", "no", "not_probed"]),
      evidence: z.string().nullable(),
    }),
  ),
  logistics: z.object({
    noticePeriod: z.string().nullable(),
    compensation: z.string().nullable(),
    location: z.string().nullable(),
    shiftWillingness: z.string().nullable(),
  }),
  recommendation: z.enum(["strong_fit", "fit", "borderline", "not_recommended"]),
  summary: z.string().describe("Two lines on the deciding factors"),
  strengths: z.array(z.object({ title: z.string(), detail: z.string(), evidence: EvidenceSchema })),
  concerns: z.array(z.object({ title: z.string(), detail: z.string(), evidence: EvidenceSchema })),
  suggestedProbes: z.array(z.string()),
});

export async function assessInterview(opts: {
  transcript: string;
  redactedCv: string;
  spec: RequirementSpec;
  questions: InterviewQuestion[];
}): Promise<{ assessment: InterviewAssessment; score: number; report: ReportContent; model: string }> {
  const { data: raw, model } = isDemoMode()
    ? { data: demo.assessInterview(opts.transcript, opts.redactedCv, opts.spec), model: "demo-heuristic" }
    : await structured({
        tier: "smart",
        schema: InterviewSchema,
        system: `You assess an AI-conducted screening interview for a hiring panel. Score each dimension 0-10: ${INTERVIEW_DIMENSIONS.join(", ")}. Then write the candidate report: 3-5 strengths and all material concerns (gaps, unverified claims, risk signals). Every evidence quote must be copied character-for-character from the transcript (source "transcript") or CV (source "cv") - only the candidate's own words count, not the interviewer's. Never assert anything without a source. Report logistics exactly as the candidate stated them, null if not discussed. Suggested probes tell the human panel what remains unresolved. ${BIAS_RULE}`,
        content: `<spec>\n${JSON.stringify(opts.spec)}\n</spec>\n<questions_asked>\n${opts.questions.map((q) => q.question).join("\n")}\n</questions_asked>\n<cv>\n${opts.redactedCv}\n</cv>\n<transcript>\n${opts.transcript}\n</transcript>`,
      });
  return groundInterview(raw, opts.transcript, opts.redactedCv, model);
}

function groundInterview(raw: z.infer<typeof InterviewSchema>, transcript: string, cv: string, model: string) {
  const grounded = (q: string, source: "cv" | "transcript") => quoteIsGrounded(q, source === "cv" ? cv : transcript);
  const dimensions = INTERVIEW_DIMENSIONS.map((name) => {
    const found = raw.dimensions.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const evidence = [...new Set(found?.evidence ?? [])].filter((q) => grounded(q, "transcript")).slice(0, 3);
    let score = clamp(found?.score ?? 0, 0, 10);
    if (evidence.length === 0) score = Math.min(score, 4);
    return { name, score, rationale: found?.rationale ?? "Not assessed.", evidence };
  });
  let dropped = 0;
  const keep = <T extends { evidence: { quote: string; source: "cv" | "transcript" } }>(items: T[]) =>
    items.filter((i) => {
      const ok = grounded(i.evidence.quote, i.evidence.source);
      if (!ok) dropped++;
      return ok;
    });
  const strengths = keep(raw.strengths).slice(0, 5);
  const concerns = keep(raw.concerns);
  const skillVerification = raw.skillVerification.map((s) => ({
    ...s,
    evidence: s.evidence && grounded(s.evidence, "transcript") ? s.evidence : null,
    substantiated: s.evidence && !grounded(s.evidence, "transcript") && s.substantiated === "yes" ? ("partly" as const) : s.substantiated,
  }));
  const score = Math.round((dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length) * 10);
  const report: ReportContent = {
    recommendation: raw.recommendation,
    summary: raw.summary,
    strengths,
    concerns,
    noConcernsStatement: concerns.length === 0 ? "No material concerns were identified in the CV or interview." : null,
    suggestedProbes: raw.suggestedProbes.slice(0, 6),
    droppedUnsupportedClaims: dropped,
  };
  return { assessment: { dimensions, skillVerification, logistics: raw.logistics }, score, report, model };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

export const aiModelLabel = () => (isDemoMode() ? "demo-heuristic" : MODELS.smart);
