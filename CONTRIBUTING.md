# Contributing to TrustMCP

Thanks for helping build an open, agent-first trust standard. TrustMCP is not a product of
any single company: the spec, schemas, SDK, MCP server, and conformance suite are
Apache-2.0, and the reference apps are FSL-1.1-ALv2 (see the Licensing section of the
[README](README.md#licensing)).

## Repo layout

See the [root README](README.md) for the monorepo map. In short:
`spec/` (the standard), `packages/` (TS spec + SDK), `apps/network` (Python API),
`apps/web` (Next.js), `apps/docs` (docs site), `mcp/python` (MCP server), `render.yaml`
(Render Blueprint), `governance/`, `docs/`.

## Dev setup

```bash
pnpm install
# Python services use uv:
cd apps/network && uv venv .venv && uv pip install --python .venv -e ".[dev]"
cd ../../mcp/python && uv venv .venv && uv pip install --python .venv -e ".[dev]"
# Full local stack:
docker compose up --build
```

## Before opening a PR

Run the same checks CI runs:

```bash
pnpm --filter @trustmcp/spec test
pnpm spec:validate
pnpm --filter @trustmcp/web test
pnpm --filter @trustmcp/web build
pnpm --filter @trustmcp/docs build
(cd apps/network && .venv/bin/ruff check app tests && .venv/bin/python -m pytest)
(cd mcp/python && .venv/bin/ruff check . && .venv/bin/python -m pytest)
```

## Conventions

- Python: `ruff` (line length 100), type hints, `pytest`.
- TypeScript: strict mode; keep `@trustmcp/spec` and the Python pydantic models in sync.
- Changing the wire format? Update `spec/`, the JSON Schemas, `@trustmcp/spec`, the pydantic
  models, **and** `apps/network/CHANGELOG`/`CHANGELOG.md`, and add a migration.
- Conventional, descriptive commit messages.

## Spec changes

Spec changes happen in the open. Open an issue describing the change and its
compatibility impact before a PR. v0.x is pre-stability; breaking changes are possible
until v1.0.

## Licensing of contributions

By contributing you agree your contribution is licensed under the license covering the
part of the repo it lands in: Apache-2.0 for `spec/`, `packages/`, `mcp/`, and
`conformance/`; FSL-1.1-ALv2 for the apps and everything else (which itself converts to
Apache-2.0 two years after each release).
