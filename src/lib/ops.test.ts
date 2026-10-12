import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./auth/redirects";
import { configProblems } from "./env";
import { readBodyCapped } from "./http";
import { ipFromHeaders } from "./rate-limit";

const headers = (h: Record<string, string>) => (n: string) => h[n] ?? null;

describe("safeNextPath", () => {
  it("allows only known in-app destinations", () => {
    assert.equal(safeNextPath("/reset-password"), "/reset-password");
    assert.equal(safeNextPath("/invite/abcdefghijklmnopqrstuvwx"), "/invite/abcdefghijklmnopqrstuvwx");
  });
  it("rejects open redirects", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/app/../../x", "/invite/short", null, 42]) assert.equal(safeNextPath(bad), "/app");
  });
});

describe("ipFromHeaders", () => {
  it("trusts the entry appended by the platform's proxy, not a client-supplied one", () => {
    assert.equal(ipFromHeaders(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), 1), "203.0.113.9");
  });
  it("supports two proxy hops", () => {
    assert.equal(ipFromHeaders(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }), 2), "203.0.113.9");
  });
  it("falls back to x-real-ip", () => assert.equal(ipFromHeaders(headers({ "x-real-ip": "198.51.100.4" }), 1), "198.51.100.4"));
  it("returns null with no headers", () => assert.equal(ipFromHeaders(headers({}), 1), null));
});

describe("configProblems", () => {
  const good = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://u:p@db.example:6543/postgres",
    DATABASE_SSL: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    APP_URL: "https://hire.example.com",
  } as NodeJS.ProcessEnv;
  it("accepts a complete production config", () => assert.deepEqual(configProblems(good).errors, []));
  it("requires https APP_URL in production", () => {
    assert.match(configProblems({ ...good, APP_URL: "http://hire.example.com" }).errors.join(), /https/);
  });
  it("rejects a wrong-length encryption key", () => {
    assert.match(configProblems({ ...good, APP_ENCRYPTION_KEY: "c2hvcnQ=" }).errors.join(), /32 random bytes/);
  });
  it("only warns about optional services", () => {
    const { errors, warnings } = configProblems(good);
    assert.equal(errors.length, 0);
    assert.ok(warnings.some((w) => /OMNIDIM_API_KEY/.test(w)));
  });
});

describe("readBodyCapped", () => {
  it("reads a small body", async () => {
    assert.equal(await readBodyCapped(new Request("http://x", { method: "POST", body: "hello" }), 10), "hello");
  });
  it("refuses a body over the limit", async () => {
    assert.equal(await readBodyCapped(new Request("http://x", { method: "POST", body: "x".repeat(50) }), 10), null);
  });
});
