# MAKA development and release policy

GitHub is the canonical source of application code. This integration preserves the synchronized backend tree from `eed85930daeac8a90241912e5a20cc894d609ab8`. Existing source branches and backups are retained. Publication through the GitHub connector may produce a different commit SHA; the published tree must match the reviewed local tree exactly.

## Everyday work

1. Start a short `feature/<topic>` or `fix/<topic>` branch from current GitHub `main`. Keep one logical change per PR. Do not edit source directly on VPS.
2. Commit locally, run checks relevant to the change, publish a new branch without force, and open a PR to `main`. Codex should report the commit, validation and remaining limitations.
3. Keep unfinished changes in draft PRs with explicit blockers. Never treat a green unit-test job as proof of a migration or live worker rollout.
4. Merge only after approval and required checks. Preserve relevant history; do not force-push shared branches. Delete a replaced branch only after checking for unique commits and obtaining approval.

## Main and release gates

`main` is intended to contain reviewed, releasable code; this document does not assert that current main matches the running VPS. Branch protection is currently absent and has NOT been changed. After approval, configure PR-only changes, one review, required current checks, no force pushes and no deletions. Recommended check names: Backend `Backend regression checks`; Frontend `Frontend tests, types, production build` (plus any existing checks required by the team). Never make a path-filtered workflow an unconditional required check unless it always runs.

Release flow: `feature/fix → PR → main → immutable release → production`. After an approved merge, record a backend/frontend commit pair in a release manifest and create an annotated, unique tag such as `maka-YYYYMMDD.N` in each repository. Tags identify reviewed commits and must never move. Record the lockfile hashes, Node version, migration ledger expectations, runtime owner variables, build configuration and previous release pair. Do not store environment values containing secrets.

Prepare each VPS release in a new immutable directory from the GitHub tags, install from lockfiles and build Frontend with the reviewed public API origin. Before a separately approved deployment, validate the DB backup and migration plan, read-only smoke checks, worker ownership and rollback. Promotion of process paths, symlinks or PM2 configuration requires a separate deployment task; CI must not deploy or access production secrets.

## Rollback

Retain the previous release directories and the exact backend/frontend commit pair. After approval, switch the application and worker paths back together and restore the previous nonsecret owner configuration. Do not reset Git history or move tags. Database rollback is separate: assess migration compatibility before promotion; use reviewed forward fixes or a verified restore plan. Never blindly run DOWN migrations or delete active TXT/source files. Turning off a new feature does not undo already committed database changes.

## Existing integration: not yet approved for main

The consolidated integration remains draft until its CI is green and these release-sensitive areas are reviewed: real EMAIL/XLSX import on a disposable full-schema database, linked-customer pricing and authenticated checkout, live-bot parity without multiple polling owners, TXT/outbox/cleanup end-to-end and migration/rollback compatibility. Previous focused local tests and the successful Frontend build are recorded in the synchronization report; they are not repeated as a full audit here. No cleanup worker or feature flag is enabled by publishing a branch.

Backend runtime ownership is specified in [local-sync-workers.md](https://github.com/VitaliiHordiichuk/autohub/blob/integration/maka-consolidated-2026-11-14/docs/local-sync-workers.md): latest-only EMAIL vs explicit legacy owner, API vs dedicated retention, and separate TXT outbox. The latest EMAIL and standalone retention launchers are already committed; no additional VPS source copying is needed based on the completed synchronization. VPS-only migration 124 duplicates tracked migration 131. Prior VPS source divergences were intentionally excluded because they remove reviewed GitHub fixes. Runtime environment files, secrets and existing PM2 configuration remain external and unchanged.

## Superseded work

PR19 (Backend) and PR32 (Frontend) are included in the integration. Propose closing them as superseded only after verifying the new PR heads and preserving their branches; no closure or deletion is performed automatically. Original local branches and backup/stash refs remain recovery points. Branches with commits absent from the integration must be preserved and reviewed separately.
