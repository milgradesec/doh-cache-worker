# Repository guide

## Layout

- `src/index.ts` contains the Cloudflare Worker entry point and runtime logic.
  It converts compatible DNS-over-HTTPS POST requests into equivalent,
  cacheable GET requests. Keep request handling and small helpers there unless
  a feature warrants another module under `src/`.
- `wrangler.toml` sets the Worker name, route, compatibility date, smart
  placement, and `DOH_ENDPOINT` binding.
- `package.json` and `package-lock.json` manage dependencies. `tsconfig.json`
  enables strict TypeScript checks; `.prettierrc` sets formatting rules.
- `.github/workflows/deploy.yml` deploys changes that reach `main`.

## Commands

- `npm ci`: install the locked development dependencies.
- `npm test`: run focused Worker tests with Node's built-in test runner. Add
  descriptive tests for DNS changes, including body boundaries and forwarding.
- `npx wrangler dev`: run the Worker locally.
- `npx tsc --noEmit`: run the strict TypeScript check.
- `npm run fmt`: format TypeScript, JavaScript, JSON, CSS, and Markdown files.
- `npm run deploy`: publish with Wrangler. Normally use the GitHub Actions
  workflow after merging to `main` instead of deploying locally.

## Code style

Write strict TypeScript for the Cloudflare Workers runtime. Use two-space
indentation, single quotes, semicolons, trailing commas, and an 80-character
print width, as enforced by Prettier. Use `camelCase` for functions and
variables and `PascalCase` for interfaces and types. Give request and
environment values explicit names, such as `encodedBody` and `DOH_ENDPOINT`.
Keep helpers small and preserve URL-safe base64 behavior.

## Commits and PRs

Use concise imperative commit subjects, such as `Use bundler moduleResolution
for TypeScript 7`. Name dependency updates `Bump <package> from <old> to
<new>`. Keep commits scoped and include lockfile changes with dependency
updates.

PRs should explain the behavior change, link the relevant issue when available,
and state validation performed, such as `npx tsc --noEmit` and local Wrangler
checks. Include request and response examples for DNS handling changes.
Screenshots are generally irrelevant to this API-only Worker.

## Deployment and security

Do not commit Cloudflare credentials. GitHub deployment requires the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Changes to the
endpoint or route in `wrangler.toml` affect production; verify them before
merging.
