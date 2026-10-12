import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { knockoutReason, lexicalScore, mentions } from "./lexical";
import { quoteIsGrounded, redactForScoring } from "./redact";
import { toE164 } from "./messaging";
import { parseCallResult, phoneKey } from "./omnidim";

describe("redactForScoring", () => {
  it("removes contact details and sensitive lines", () => {
    const out = redactForScoring("Priya Rao\npriya@example.com\n+91 98765 43210\nGender: Female\nWorked 2018 - 2021", "Priya Rao");
    assert.doesNotMatch(out, /Priya|Rao|example\.com|98765|Female/);
    assert.match(out, /2018 - 2021/);
  });
  it("keeps Microsoft product names intact", () => {
    const out = redactForScoring("Advanced MS Office and Ms Excel. Reported to Ms. Sharma.");
    assert.match(out, /MS Office/);
    assert.match(out, /Ms Excel/);
    assert.doesNotMatch(out, /Ms\. Sharma/);
  });
  it("neutralises gendered pronouns", () => {
    assert.equal(redactForScoring("She led her team"), "they led they team");
  });
});

describe("quoteIsGrounded", () => {
  const cv = "Built a Kafka pipeline handling 2M events/day. Led a team of 5 engineers.";
  it("accepts an exact quote ignoring case and punctuation", () => assert.equal(quoteIsGrounded("built a kafka pipeline handling 2M events/day", cv), true));
  it("rejects an invented quote", () => assert.equal(quoteIsGrounded("Led a team of 50 engineers", cv), false));
  it("accepts two exact fragments joined by an ellipsis", () => assert.equal(quoteIsGrounded("Built a Kafka pipeline ... Led a team of 5", cv), true));
  it("rejects quotes too short to mean anything", () => assert.equal(quoteIsGrounded("Kafka", cv), false));
});

describe("lexical matching", () => {
  it("matches aliases in both directions", () => {
    assert.equal(mentions("Deployed on k8s clusters", "Kubernetes"), true);
    assert.equal(mentions("Ran Kubernetes in prod", "k8s"), true);
  });
  it("matches RESTful for a REST API requirement", () => assert.equal(mentions("Designed RESTful services", "REST API"), true));
  it("tolerates plural forms", () => assert.equal(mentions("Tuned several databases", "database"), true));
  it("scores must-have coverage", () => {
    const spec = { summary: "", mustHave: ["Python", "SQL"], niceToHave: [], minYears: null, maxYears: null, qualifications: [], location: null, shift: null };
    assert.equal(lexicalScore("Python and SQL daily", spec), 80);
    assert.equal(lexicalScore("Java only", spec), 0);
  });
  it("applies knockouts", () => {
    const config = { cvWeight: 0.4, minYears: 3, mandatoryKeywords: ["AWS"], customQuestions: [] };
    assert.match(knockoutReason("AWS certified", 1, config) ?? "", /minimum experience/);
    assert.match(knockoutReason("GCP certified", 5, config) ?? "", /Missing mandatory: AWS/);
    assert.equal(knockoutReason("AWS certified", 5, config), null);
  });
});

describe("toE164", () => {
  it("adds the default country code to 10-digit numbers", () => assert.equal(toE164("098765 43210"), "+919876543210"));
  it("keeps an explicit country code", () => assert.equal(toE164("+1 (415) 555-0100"), "+14155550100"));
  it("rejects junk", () => assert.equal(toE164("12345"), null));
});

describe("parseCallResult", () => {
  it("reads a completed call with a turn-pair transcript", () => {
    const r = parseCallResult({
      call_status: "completed",
      metadata: { interview_id: "11111111-1111-1111-1111-111111111111" },
      call_conversation: [{ user_query: "I have five years in Java", bot_response: "Thanks" }],
      call_duration_in_seconds: "612",
      recording_url: "https://cdn.example/rec.mp3",
      to_number: "+919876543210",
    });
    assert.equal(r.status, "completed");
    assert.equal(r.interviewId, "11111111-1111-1111-1111-111111111111");
    assert.match(r.transcript ?? "", /Candidate: I have five years in Java/);
    assert.equal(r.durationSec, 612);
    assert.equal(phoneKey(r.toNumber), "9876543210");
  });
  it("classifies missed calls", () => assert.equal(parseCallResult({ status: "no-answer" }).status, "no_answer"));
  it("ignores non-http recording links", () => assert.equal(parseCallResult({ status: "completed", recording_url: "javascript:alert(1)" }).recordingUrl, null));
});
