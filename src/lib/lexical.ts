import type { PositionConfig, RequirementSpec } from "@/db/schema";
import { normalise } from "./redact";

const ALIASES: Record<string, string[]> = {
  javascript: ["js", "ecmascript"],
  typescript: ["ts"],
  kubernetes: ["k8s"],
  "node.js": ["node", "nodejs"],
  postgresql: ["postgres", "psql"],
  "amazon web services": ["aws"],
  "google cloud": ["gcp"],
  "machine learning": ["ml"],
  "continuous integration": ["ci/cd", "ci cd"],
  "rest api": ["restful", "rest apis", "restful api", "restful apis", "rest"],
  react: ["react.js", "reactjs"],
  "vue.js": ["vue", "vuejs"],
  "next.js": ["nextjs"],
  "c#": ["csharp", ".net"],
  golang: ["go lang"],
  "microsoft excel": ["excel", "ms excel"],
};

/** Singular/plural forms of a phrase's last word ("rest apis" <-> "rest api", "databases" <-> "database"). */
function numberForms(t: string): string[] {
  if (/[^s]s$/.test(t) && t.length > 4) return [t.slice(0, -1)];
  if (/[a-z]$/.test(t) && !t.endsWith("s")) return [`${t}s`];
  return [];
}

function variants(term: string): string[] {
  const t = normalise(term);
  // An alias group matches in both directions: the canonical name, or any of its aliases.
  const group = Object.entries(ALIASES).find(([k, v]) => k === t || v.includes(t));
  const extra = group ? [group[0], ...group[1]] : [];
  // Also match meaningful sub-terms of long phrases ("REST API design" -> "rest api").
  const words = t.split(" ").filter((w) => w.length > 2);
  const base = [t, ...extra.map(normalise), ...(words.length > 2 ? [words.slice(0, 2).join(" ")] : [])];
  return [...new Set(base.flatMap((v) => [v, ...numberForms(v)]))];
}

export function mentions(text: string, term: string): boolean {
  const hay = ` ${normalise(text)} `;
  return variants(term).some((v) => hay.includes(` ${v} `) || hay.includes(` ${v}.`) || hay.includes(` ${v},`));
}

/**
 * Fast first pass: must-have coverage (weighted 80%) plus nice-to-have coverage.
 * Returns 0..100. Cheap enough to run on every CV before any model call.
 */
export function lexicalScore(text: string, spec: RequirementSpec): number {
  const must = spec.mustHave.length ? spec.mustHave.filter((s) => mentions(text, s)).length / spec.mustHave.length : 1;
  const nice = spec.niceToHave.length
    ? spec.niceToHave.filter((s) => mentions(text, s)).length / spec.niceToHave.length
    : 0;
  return Math.round((must * 0.8 + nice * 0.2) * 100);
}

/** Knockout criteria set by the recruiter. Returns a reason, or null if the CV passes. */
export function knockoutReason(
  text: string,
  totalYears: number | null,
  config: PositionConfig,
): string | null {
  if (config.minYears != null && totalYears != null && totalYears < config.minYears) {
    return `Below minimum experience (${totalYears} of ${config.minYears} years)`;
  }
  const missing = config.mandatoryKeywords.filter((k) => !mentions(text, k));
  if (missing.length) return `Missing mandatory: ${missing.join(", ")}`;
  return null;
}
