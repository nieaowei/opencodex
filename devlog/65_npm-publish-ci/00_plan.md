# npm release CI + runbook (jawcode-style)

## Why
`bun/npm install -g opencodex` install from the **npm registry**, not GitHub — so opencodex must be
**published to npm**. Modeled on jawcode's release flow (minus its monorepo/native-binary bits).

## How jawcode does it (reference)
`jawcode/.github/workflows/release.yml` is a **`workflow_dispatch`** job with `version` + `tag`
(latest/preview) + `dry-run` (default **true**) inputs: it verifies package.json matches the input,
then `npm publish --tag … --access public --provenance`, then a post-publish registry smoke. A local
`bun scripts/release.ts <version>` does preflight → bump → commit → push → dispatch → watch.

## What shipped (opencodex)
- **`.github/workflows/release.yml`** — `workflow_dispatch` with `version` / `tag` (latest|preview) /
  `dry-run` (default true). Verifies the tag input == package.json, then `npm publish` (prepublishOnly
  builds the GUI into gui/dist first) with `--provenance`, then `npm view` smoke on real publishes.
  Replaces the old tag-push `publish-npm.yml`.
- **`scripts/release.ts`** (+ `bun run release` / `release:watch`) — single-package version of
  jawcode's helper: clean-main + typecheck preflight → `npm version --no-git-tag-version` → commit →
  push → `gh workflow run release.yml` (dry-run unless `--publish`) → watch. Not shipped in the tarball.
- Package already publish-ready (`files`, bin `#!/usr/bin/env bun`, `engines.bun`, `prepublishOnly`).

## One-time setup (owner)
1. npm **Automation** (or Granular all-packages Read+Write) token: npmjs.com → Access Tokens.
2. Add it as the repo secret **`NPM_TOKEN`**: GitHub → Settings → Secrets and variables → Actions.

## Releasing
**Easiest (local helper):**
```bash
bun run release 0.1.0            # preflight → bump → commit → push → DRY-RUN dispatch → watch
bun run release 0.1.0 --publish  # …and actually publish (after the dry-run looks good)
```
**Manual (GitHub UI):** bump `version` in package.json on main, commit/push, then Actions → **Release**
→ Run workflow → enter the version, pick the dist-tag, leave **dry-run on** first, re-run with dry-run
off to publish.

After a real publish: `bun install -g opencodex` / `npm install -g opencodex` work (package page:
https://www.npmjs.com/package/opencodex). opencodex is bun-native, so installers still need **bun** on PATH.
