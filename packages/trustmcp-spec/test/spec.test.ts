import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Discovery, Manifest, Attestations, KeyRequest } from "../src/index.js";

const root = resolve(__dirname, "../../..");
const ex = (p: string) => JSON.parse(readFileSync(resolve(root, "spec/examples/acme", p), "utf8"));

describe("TrustMCP zod schemas accept the canonical examples", () => {
  it("discovery record", () => {
    expect(() => Discovery.parse(ex("well-known-trustmcp.json"))).not.toThrow();
  });

  it("manifest", () => {
    const m = Manifest.parse(ex("manifest.json"));
    expect(m.vendor.id).toBe("vnd_acme");
    expect(m.artifacts.length).toBe(4);
  });

  it("attestations", () => {
    const a = Attestations.parse(ex("attestations.json"));
    expect(a.claims.find((c) => c.key === "mfa.enforced")?.value).toBe(true);
  });
});

describe("TrustMCP zod schemas reject malformed input", () => {
  it("rejects bad vendor_id", () => {
    expect(() => Discovery.parse({ ...ex("well-known-trustmcp.json"), vendor_id: "ACME" })).toThrow();
  });

  it("rejects empty key request scope", () => {
    expect(() =>
      KeyRequest.parse({
        vendor_id: "vnd_acme",
        requester: { name: "Globex", domain: "globex.com", contact: "trust@globex.com" },
        scope: [],
      }),
    ).toThrow();
  });
});
