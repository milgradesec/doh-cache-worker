# Repository Guidelines

## Project Structure & Architecture

This repository is a compact Cloudflare Worker that makes DNS-over-HTTPS POST
requests cacheable by converting them to equivalent GET requests. The worker
entry point and all runtime logic live in `src/index.ts`; keep request handling
and small helpers close to that entry point unless the feature warrants a new
module under `src/`. `wrangler.toml` defines the Worker name, route, runtime
compatibility date, smart placement, and the `DOH_ENDPOINT` binding.

Project tooling is at the repository root: `package.json` and
`package-lock.json` manage dependencies, `tsconfig.json` provides strict
TypeScript checks, and `.prettierrc` holds formatting rules. Deployment runs
from `.github/workflows/deploy.yml` whenever changes reach `main`.

## Build, Test, and Development Commands

- `npm ci` installs the exact locked development dependencies.
- `npx wrangler dev` runs the Worker locally through Wrangler.
- `npx tsc --noEmit` performs the configured strict TypeScript check.
- `npm run fmt` formats TypeScript, JavaScript, JSON, CSS, and Markdown files.
- `npm run deploy` publishes with Wrangler; normally rely on the GitHub Actions
  workflow after merging to `main` rather than deploying from a local machine.

`npm test` is currently a placeholder and fails intentionally; no test runner
or coverage threshold is configured. Add focused Worker tests alongside a test
tooling change, using descriptive names such as
`converts a DoH POST body to a cacheable GET request`.

## Coding Style & Naming Conventions

Write strict TypeScript compatible with the Cloudflare Workers runtime. Use
two-space indentation, single quotes, semicolons, trailing commas, and an
80-character print width; Prettier enforces these rules. Use `camelCase` for
functions and variables, `PascalCase` for interfaces/types, and explicit names
for request and environment values (for example, `encodedBody` and
`DOH_ENDPOINT`). Keep helpers small and preserve URL-safe base64 behavior.

## Commit & Pull Request Guidelines

Recent history uses concise imperative subjects, such as `Use bundler
moduleResolution for TypeScript 7`; dependency updates follow `Bump <package>
from <old> to <new>`. Keep commits scoped and include lockfile changes when
dependencies change. PRs should explain the behavior change, link the relevant
issue when available, and state validation performed (`npx tsc --noEmit`, local
Wrangler checks). Include request/response examples for changes to DNS handling;
screenshots are not generally relevant to this API-only Worker.

## Configuration & Security

Do not commit Cloudflare credentials. GitHub deployment requires
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Treat endpoint and
route changes in `wrangler.toml` as production-impacting and verify them before
merging.
