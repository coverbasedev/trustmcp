import { z } from "zod";

/**
 * TrustMCP — canonical TypeScript schemas.
 *
 * These zod schemas are the typed mirror of the JSON Schemas in `schemas/`.
 * The Python backend mirrors the same shapes with pydantic. Keep all three in
 * sync for v0.1 (the surface is intentionally small).
 */

export const SCHEMA_VERSION = "0.1" as const;

export const vendorId = z.string().regex(/^vnd_[a-z0-9_]+$/, "vendor_id must look like vnd_acme");
export const artifactId = z.string().regex(/^art_[a-z0-9_]+$/, "artifact_id must look like art_soc2_2026");

export const ScopeItem = z.enum(["manifest", "attestations", "artifacts"]);
export type ScopeItem = z.infer<typeof ScopeItem>;

export const Discovery = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  vendor_id: vendorId,
  legal_name: z.string().min(1),
  network: z.string().url(),
  manifest: z.string().url(),
  mark: z.literal("agent-ready").optional(),
});
export type Discovery = z.infer<typeof Discovery>;

export const Artifact = z.object({
  id: artifactId,
  type: z.string().min(1),
  title: z.string().optional(),
  format: z.string().optional(),
  issued_at: z.string(),
  valid_until: z.string().nullable().optional(),
  scope: z.string().optional(),
  sha256: z.string().regex(/^[a-f0-9]{8,64}$/),
  access: z.enum(["public", "key_required"]),
  version: z.number().int().min(1).optional(),
  uri: z.string(),
});
export type Artifact = z.infer<typeof Artifact>;

export const Manifest = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  vendor: z.object({
    id: vendorId,
    legal_name: z.string().min(1),
    domains: z.array(z.string()).optional(),
    product: z.string().optional(),
  }),
  published_at: z.string(),
  artifacts: z.array(Artifact),
  attestations_uri: z.string().optional(),
  subprocessors_uri: z.string().optional(),
});
export type Manifest = z.infer<typeof Manifest>;

export const ClaimValue = z.union([
  z.boolean(),
  z.string(),
  z.number(),
  z.array(z.string()),
]);

export const Claim = z.object({
  key: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/),
  value: ClaimValue,
  evidence: z.array(artifactId),
});
export type Claim = z.infer<typeof Claim>;

export const Attestations = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  vendor_id: vendorId,
  generated_at: z.string(),
  claims: z.array(Claim),
});
export type Attestations = z.infer<typeof Attestations>;

export const Requester = z.object({
  name: z.string(),
  domain: z.string(),
  contact: z.string(),
});
export type Requester = z.infer<typeof Requester>;

export const KeyRequest = z.object({
  vendor_id: vendorId,
  requester: Requester,
  scope: z.array(ScopeItem).min(1),
});
export type KeyRequest = z.infer<typeof KeyRequest>;

export const FreshnessStatus = z.enum(["valid", "expiring", "expired"]);
export type FreshnessStatus = z.infer<typeof FreshnessStatus>;

export const Freshness = z.object({
  vendor_id: vendorId,
  checked_at: z.string(),
  items: z.array(
    z.object({
      id: artifactId,
      status: FreshnessStatus,
      valid_until: z.string().nullable().optional(),
      days_left: z.number().int().nullable().optional(),
    }),
  ),
});
export type Freshness = z.infer<typeof Freshness>;

export const SUGGESTED_ARTIFACT_TYPES = [
  "soc2_type2",
  "soc2_type1",
  "iso_27001",
  "pentest",
  "insurance_coi",
  "financials",
  "dpa",
  "architecture",
  "subprocessor_list",
  "sbom",
  "policy",
] as const;
