# Agent Control Android Overhaul Implementation Plan

1. Add protocol tests for readable workspace fallbacks, prompt-derived titles, manual pinned titles, and progress validation.
2. Extend the task contract and PostgreSQL/D1 schemas with progress and activity fields.
3. Add store operations for task detail replacement and progress events; expose progress updates through the authenticated API.
4. Update Codex hook handling so session creation is immediate, first prompts rename placeholders, tool activity refreshes the current step, and stop moves work to verification.
5. Update the Windows adapter to report managed execution stages and make hook registration self-repairing without disturbing unrelated hooks.
6. Add Room entities for task activity and the new task fields, plus a migration test that proves all version-2 values survive.
7. Update Android sync to persist events transactionally, map new optional fields, and keep backward compatibility with older responses.
8. Replace the Compose navigation and screens with the Command, Board, Agents, Mission Detail, New Mission, and Settings experiences defined in the design.
9. Add domain/UI tests for grouping, freshness, progress presentation, title preview, keyboard-safe creation, filtering, and task detail.
10. Run protocol, control-plane, adapter, Android unit, lint, instrumentation, and release checks; resolve every regression.
11. Deploy the database migration and control plane, verify production task creation/progress/sync, and repair the installed Windows adapter/hooks.
12. Seed representative local states and inspect emulator screenshots at phone and compact viewport sizes, including light/dark, offline, active, waiting, failed, and empty states.
13. Build the signed release, confirm package/signing/version continuity, and upgrade the explicitly bound Samsung with `adb install -r`.
14. On the physical phone, verify launch from the existing home shortcut, preserved data/configuration, keyboard-safe creation, offline creation, online reconciliation, live Codex lifecycle updates, dispatch, progress, completion, and rotation/font-scale resilience.
15. Save screenshots/logs/hashes, update `VERIFICATION.md`, commit and push the exact verified source.
