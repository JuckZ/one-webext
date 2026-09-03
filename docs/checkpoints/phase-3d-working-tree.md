# Phase 3D working-tree checkpoint

Date: 2026-08-28

This is a documentation checkpoint for the intentionally uncommitted OneWeb workspace before Phase
4A begins. It is not a Git commit and does not claim that the current files can be reconstructed from
`HEAD` alone.

## Protected baseline

- Repository: `/home/juck/Projects/one-webext`
- Branch: `main`
- Base `HEAD`: `062c8e74d8141bef54d87d7ea1f31148e47cffa5`
- Working tree: 37 modified, deleted or untracked paths before this checkpoint file was added.
- Preserved scope: all Phase 0 through Phase 3D module-platform, branding, management UI, Bookmark
  Doctor, test-fixture and documentation changes.
- Protection rule: do not reset, checkout, clean, overwrite or commit this working tree while Phase
  4A is in progress unless the user explicitly authorizes a commit.

## Reproduced gates

The following commands passed against the protected baseline before Phase 4A code or architecture
changes were started:

```text
pnpm typecheck
pnpm lint
pnpm test                         # 164 / 164 unit tests
pnpm build                        # production Chromium artifact
EXTENSION_PATH=... pnpm exec playwright test  # 12 / 12 Chromium scenarios
git diff --check
```

RepoLens was served only as the existing local E2E dependency at `http://127.0.0.1:4747`; the server
is not part of OneWeb's persisted state. This checkpoint establishes the comparison point for the
Phase 4A isolation gate.
