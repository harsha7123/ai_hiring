/**
 * Deterministic heuristics used when AI_DEMO_MODE=true. They exist so the full
 * pipeline can be exercised without an API key. Quality is far below the model path.
 * Every quote they emit is copied from the source text, so grounding checks pass honestly.
 */
import type { CvAssessment, CvProfile, InterviewQuestion, RequirementSpec } from "@/db/schema";
import { mentions } from "@/lib/lexical";

const SKILLS = [
  "Python", "Java", "JavaScript", "TypeScript", "Go", "Rust", "C++", "C#", "SQL", "PostgreSQL", "MySQL", "MongoDB",
  "Redis", "Kafka", "RabbitMQ", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Linux", "Git",
  "React", "Next.js", "Node.js", "Django", "FastAPI", "Spring", "GraphQL", "REST", "Microservices", "CI/CD",
  "Jenkins", "Prometheus", "Grafana", "Machine Learning", "Pandas", "Spark", "Airflow", "Excel", "Tableau",
  "Power BI", "Salesforce", "SAP", "Figma", "Agile", "Scrum", "Communication", "Leadership", "Sales",
  "Customer Service", "Accounting", "Recruiting", "Negotiation", "Hindi", "English",
];

const lines = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function extractSpec(jd: string): RequirementSpec {
  const all = lines(jd);
  const niceIdx = all.findIndex((l) => /nice to have|preferred|bonus|good to have/i.test(l));
  const mustText = niceIdx >= 0 ? all.slice(0, niceIdx).join("\n") : jd;
  const niceText = niceIdx >= 0 ? all.slice(niceIdx).join("\n") : "";
  const mustHave = SKILLS.filter((s) => mentions(mustText, s)).slice(0, 10);
  const niceToHave = SKILLS.filter((s) => mentions(niceText, s) && !mustHave.includes(s)).slice(0, 8);
  const years = jd.match(/(\d+)\s*(?:\+|-\s*(\d+))?\s*years?/i);
  return {
    summary: all.slice(0, 2).join(" ").slice(0, 300),
    mustHave: mustHave.length ? mustHave : ["Communication"],
    niceToHave,
    minYears: years ? Number(years[1]) : null,
    maxYears: years?.[2] ? Number(years[2]) : null,
    qualifications: all.filter((l) => /degree|bachelor|master|b\.?tech|certif/i.test(l)).slice(0, 3),
    location: jd.match(/location:\s*(.+)/i)?.[1]?.trim() ?? null,
    shift: jd.match(/shift:\s*(.+)/i)?.[1]?.trim() ?? null,
  };
}

export function structureProfile(cv: string): CvProfile {
  const all = lines(cv);
  const years = cv.match(/(\d+(?:\.\d)?)\+?\s*years?\s+(?:of\s+)?(?:professional\s+)?experience/i);
  return {
    name: all.find((l) => l.length < 40 && /^[A-Za-z][A-Za-z .'-]+$/.test(l)) ?? null,
    email: cv.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null,
    phone: cv.match(/\+?\d[\d\s-]{9,14}\d/)?.[0]?.replace(/[\s-]/g, "") ?? null,
    location: cv.match(/location:\s*(.+)/i)?.[1]?.trim() ?? null,
    totalYears: years ? Number(years[1]) : null,
    currentTitle: null,
    employment: [],
    skills: SKILLS.filter((s) => mentions(cv, s)).map((name) => ({ name, years: null })),
    education: all.filter((l) => /university|college|b\.?tech|bachelor|master|mba/i.test(l)).slice(0, 3),
    gaps: [],
  };
}

function lineMentioning(text: string, term: string): string | null {
  return lines(text).find((l) => mentions(l, term) && l.length >= 12)?.slice(0, 220) ?? null;
}

export function assessCv(cv: string, spec: RequirementSpec) {
  const coverage = spec.mustHave.map((skill) => {
    const evidence = lineMentioning(cv, skill);
    return { skill, present: evidence !== null, evidence };
  });
  const niceHits = spec.niceToHave.map((s) => lineMentioning(cv, s)).filter((x): x is string => !!x);
  const mustRatio = coverage.length ? coverage.filter((c) => c.present).length / coverage.length : 0;
  const expLine = lines(cv).find((l) => /\d+\+?\s*years?/i.test(l)) ?? null;
  const qualLine = lines(cv).find((l) => /university|college|degree|b\.?tech|bachelor|master|certif/i.test(l)) ?? null;
  const dims: CvAssessment["dimensions"] = [
    { name: "Must-have skills", score: Math.round(mustRatio * 10), rationale: `${coverage.filter((c) => c.present).length} of ${coverage.length} must-have skills evidenced.`, evidence: coverage.flatMap((c) => (c.evidence ? [c.evidence] : [])).slice(0, 3) },
    { name: "Relevant experience", score: expLine ? 7 : 4, rationale: expLine ? "States relevant experience." : "Experience duration not stated.", evidence: expLine ? [expLine] : [] },
    { name: "Stability & progression", score: 6, rationale: "Heuristic default in demo mode.", evidence: expLine ? [expLine] : [] },
    { name: "Nice-to-have skills", score: spec.niceToHave.length ? Math.round((niceHits.length / spec.niceToHave.length) * 10) : 5, rationale: `${niceHits.length} nice-to-have skills found.`, evidence: niceHits.slice(0, 2) },
    { name: "Qualifications", score: qualLine ? 7 : 3, rationale: qualLine ? "Relevant qualification listed." : "No qualification found.", evidence: qualLine ? [qualLine] : [] },
  ];
  return { dimensions: dims, mustHaveCoverage: coverage, summary: `Demo-mode assessment: ${Math.round(mustRatio * 100)}% must-have coverage.` };
}

export function designQuestions(spec: RequirementSpec, a: CvAssessment | null, custom: string[]): InterviewQuestion[] {
  const missing = a?.mustHaveCoverage.filter((c) => !c.present).map((c) => c.skill) ?? [];
  const present = spec.mustHave.filter((s) => !missing.includes(s));
  const qs: InterviewQuestion[] = [
    ...present.slice(0, 3).map((s) => ({ question: `Tell me about a recent project where you used ${s}. What exactly did you do yourself?`, purpose: `Verify depth on ${s}` })),
    ...missing.slice(0, 2).map((s) => ({ question: `The role needs ${s}. What experience do you have with it?`, purpose: `Probe gap: ${s}` })),
    { question: "Describe a difficult problem you solved at work recently, step by step.", purpose: "Problem reasoning" },
    ...custom.map((q) => ({ question: q, purpose: "Recruiter question" })),
    { question: "What is your notice period, your expected compensation, and are you comfortable with the location and shift?", purpose: "Logistics" },
  ];
  return qs;
}

export function assessInterview(transcript: string, cv: string, spec: RequirementSpec) {
  // Candidate turns only: lines prefixed user/candidate/customer, or every line if unlabelled.
  const turns = lines(transcript);
  const labelled = turns.filter((l) => /^(user|candidate|customer|human)\s*:/i.test(l));
  const said = (labelled.length ? labelled : turns).map((l) => l.replace(/^[a-z ]+:\s*/i, ""));
  const long = said.filter((s) => s.split(" ").length >= 8);
  const skillQuote = (s: string) => said.find((x) => mentions(x, s) && x.length > 15) ?? null;
  const verified = spec.mustHave.map((skill) => {
    const q = skillQuote(skill);
    return { skill, claimedOnCv: mentions(cv, skill), probed: q !== null, substantiated: q ? ("partly" as const) : ("not_probed" as const), evidence: q };
  });
  const depth = verified.filter((v) => v.evidence).length / Math.max(1, verified.length);
  const notice = said.find((s) => /notice|join|days|weeks|month/i.test(s)) ?? null;
  const comp = said.find((s) => /lakh|lpa|salary|ctc|compensation|\d+\s*k\b/i.test(s)) ?? null;
  const ev = (q: string | null) => (q ? [q] : []);
  const dims = [
    { name: "Role fit", score: Math.round(4 + depth * 5), rationale: "Based on skill mentions in answers.", evidence: ev(long[0] ?? null) },
    { name: "Depth on claimed skills", score: Math.round(depth * 9), rationale: `${Math.round(depth * 100)}% of must-have skills discussed.`, evidence: verified.flatMap((v) => ev(v.evidence)).slice(0, 2) },
    { name: "Communication", score: long.length >= 4 ? 7 : 4, rationale: `${long.length} substantive answers.`, evidence: ev(long[1] ?? null) },
    { name: "Problem reasoning", score: long.length >= 3 ? 6 : 3, rationale: "Heuristic based on answer length.", evidence: ev(long[2] ?? null) },
    { name: "Logistics alignment", score: notice || comp ? 7 : 4, rationale: notice || comp ? "Logistics discussed." : "Logistics not covered.", evidence: ev(notice ?? comp) },
  ];
  const avg = dims.reduce((a, d) => a + d.score, 0) / dims.length;
  const unprobed = verified.filter((v) => !v.evidence);
  return {
    dimensions: dims,
    skillVerification: verified,
    logistics: { noticePeriod: notice, compensation: comp, location: null, shiftWillingness: null },
    recommendation: (avg >= 7.5 ? "strong_fit" : avg >= 6 ? "fit" : avg >= 4.5 ? "borderline" : "not_recommended") as "strong_fit" | "fit" | "borderline" | "not_recommended",
    summary: `Demo-mode assessment. Discussed ${verified.length - unprobed.length} of ${verified.length} must-have skills with ${long.length} substantive answers.`,
    strengths: verified
      .filter((v) => v.evidence)
      .slice(0, 3)
      .map((v) => ({ title: `Discussed ${v.skill}`, detail: `Candidate spoke to ${v.skill} directly.`, evidence: { quote: v.evidence!, source: "transcript" as const } })),
    concerns: unprobed.slice(0, 3).flatMap((v) => {
      const cvLine = lineMentioning(cv, v.skill);
      return cvLine
        ? [{ title: `${v.skill} not evidenced in interview`, detail: `The CV lists ${v.skill} but the interview did not substantiate it.`, evidence: { quote: cvLine, source: "cv" as const } }]
        : [];
    }),
    suggestedProbes: unprobed.map((v) => `Probe hands-on depth with ${v.skill}.`),
  };
}
