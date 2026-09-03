# Phase 4A working-tree checkpoint

Date: 2026-08-28

This is a documentation checkpoint for the intentionally uncommitted OneWeb workspace before Phase
4B implementation. It is not a Git commit and does not make the working tree reconstructible from
`HEAD` alone.

## Protected baseline

- Repository: `/home/juck/Projects/one-webext`
- Branch: `main`
- Base `HEAD`: `062c8e74d8141bef54d87d7ea1f31148e47cffa5`
- Preserved scope: all Phase 0 through Phase 4A module-platform, branding, management UI, Bookmark
  Doctor, Clash Control PoC, fixture and documentation changes.
- Protection rule: do not reset, checkout, clean, overwrite or commit this working tree during
  Phase 4B unless the user explicitly authorizes it.

## Reproduced pre-4B gates

Before Phase 4B code changes, the protected workspace passed:

```text
pnpm typecheck
pnpm lint
pnpm test                         # 199 / 199 unit tests
pnpm build                        # production Chromium artifact
git diff --check
```

The Clash Control and Bookmark Doctor Chromium scenarios also passed against the protected artifact.
The initial baseline replay exposed one test-only dependency problem: the two older RepoLens bridge
scenarios used an external server configured for one temporary extension ID, while a fresh unpacked
profile received another ID and was rejected with HTTP 403. Phase 4B replaced that external
dependency with an E2E-only HTTP fixture that emits an exact per-request `frame-ancestors` origin;
RepoLens production validation remains unchanged. The corrected pre-4B bridge scenarios pass, and
the final Phase 4B gate passes all 13 Chromium scenarios.
