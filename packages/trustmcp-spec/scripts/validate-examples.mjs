#!/usr/bin/env node
// Validates the example profiles in spec/examples against the JSON Schemas in
// spec/schemas. Run from the repo root via `pnpm spec:validate`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const schemaDir = resolve(root, "spec/schemas");
const exDir = resolve(root, "spec/examples/acme");

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const schema = (name) => ajv.compile(load(resolve(schemaDir, name)));

const cases = [
  ["discovery.schema.json", "well-known-trustmcp.json"],
  ["manifest.schema.json", "manifest.json"],
  ["attestations.schema.json", "attestations.json"],
];

let failed = 0;
for (const [schemaFile, exampleFile] of cases) {
  const validate = schema(schemaFile);
  const data = load(resolve(exDir, exampleFile));
  if (validate(data)) {
    console.log(`✓ ${exampleFile} valid against ${schemaFile}`);
  } else {
    failed++;
    console.error(`✗ ${exampleFile} INVALID against ${schemaFile}`);
    console.error(JSON.stringify(validate.errors, null, 2));
  }
}

if (failed > 0) {
  console.error(`\n${failed} example(s) failed validation.`);
  process.exit(1);
}
console.log("\nAll example profiles validate. ✅");
