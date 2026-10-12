import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { browserTranscriptIsPlausible, combinedScore, mergeTranscriptEvent, nextCallSlot, type TranscriptLine } from "./interview-rules";

const hours = { callWindowStartHour: 9, callWindowEndHour: 18 };
/** A UTC instant for the given IST wall-clock time on 2026-10-12. */
const ist = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 12, h, m) - 330 * 60_000);

describe("nextCallSlot", () => {
  it("dials immediately inside calling hours", () => {
    const t = ist(11, 30);
    assert.equal(nextCallSlot(t, hours).getTime(), t.getTime());
  });
  it("waits until opening time before hours", () => {
    assert.equal(nextCallSlot(ist(7), hours).toISOString(), ist(9).toISOString());
  });
  it("rolls over to the next morning after hours", () => {
    assert.equal(nextCallSlot(ist(19), hours).toISOString(), new Date(ist(9).getTime() + 864e5).toISOString());
  });
  it("treats the end hour as closed", () => {
    assert.notEqual(nextCallSlot(ist(18), hours).getTime(), ist(18).getTime());
  });
});

describe("combinedScore", () => {
  it("weights CV and interview", () => assert.equal(combinedScore(80, 60, { cvWeight: 0.4 }), 68));
  it("treats a missing CV score as zero", () => assert.equal(combinedScore(null, 50, { cvWeight: 0.5 }), 25));
  it("clamps out-of-range weights", () => assert.equal(combinedScore(90, 10, { cvWeight: 3 }), 90));
});

describe("browserTranscriptIsPlausible", () => {
  it("accepts a normal-length transcript for a 10-minute session", () => {
    assert.equal(browserTranscriptIsPlausible("x".repeat(9000), 600), true);
  });
  it("rejects a long transcript posted seconds after the session opened", () => {
    assert.equal(browserTranscriptIsPlausible("x".repeat(9000), 5), false);
  });
});

describe("mergeTranscriptEvent", () => {
  const line = (role: TranscriptLine["role"], text: string, final: boolean): TranscriptLine => ({ role, text, final });

  it("replaces a growing (non-final) line from the same speaker", () => {
    const out = mergeTranscriptEvent([line("user", "I worked", false)], line("user", "I worked on Kafka", false));
    assert.deepEqual(out.map((l) => l.text), ["I worked on Kafka"]);
  });
  it("keeps a final segment when the same speaker continues after a pause", () => {
    let lines: TranscriptLine[] = [];
    for (const e of [line("user", "I led the migration.", true), line("user", "It took", false), line("user", "It took six months.", true)]) {
      lines = mergeTranscriptEvent(lines, e);
    }
    assert.deepEqual(lines.map((l) => l.text), ["I led the migration.", "It took six months."]);
  });
  it("starts a new line when the speaker changes", () => {
    const out = mergeTranscriptEvent([line("agent", "Tell me about Kafka", false)], line("user", "Sure", false));
    assert.equal(out.length, 2);
  });
});
