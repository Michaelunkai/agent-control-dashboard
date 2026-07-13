# Agent Control 0.4.2 Verification

Verified on July 13, 2026.

## Release Artifact

- APK: `release\agent-control-0.4.2.apk`
- Package: `com.michaelovsky.agentcontrol`
- Version code/name: `8` / `0.4.2`
- Android API range: `26` minimum, `36` target
- Size: `1,171,341` bytes
- SHA-256: `8491D6904A0895131CC7205AB45411096599FB6089B69C0763BD07A31B74C5D2`
- Signer SHA-256: `f913ec8ccfae6c2813ed25f162f17a01b1d8f34b89893c13e67c337207a2d7d1`
- APK Signature Scheme v2: verified
- The signer matches every previously installed Agent Control release.

## Automated Results

- Shared protocol: 15/15 tests passed.
- Control plane: 24/24 portable tests passed.
- PostgreSQL integration: 4/4 tests passed against the production database.
- Windows adapter: 30/30 tests passed, including the real PowerShell 5
  `SessionStart` hook output contract.
- Android JVM tests, debug lint, and release vital lint passed.
- Six Android instrumentation flows passed on a clean API 34 emulator; the
  production-credential-only case was intentionally skipped.
- TypeScript type checks and production builds passed for every subsystem.
- Production dependency audit: zero vulnerabilities.
- PowerShell 5.1 parsing passed for all seven adapter scripts.
- `git diff --check`: passed.

## Lifecycle Behavior

- `SessionStart`, `UserPromptSubmit`, and `PostToolUse` create or reactivate a
  mission and move it through ready, queued, and in-progress states.
- Prompt text updates the readable title and full mission description.
- Tool activity updates current activity and progress while work is running.
- `Stop` moves active work into verification. The adapter derives `DONE`,
  `WAITING`, or `FAILED` only from the documented final assistant message field
  and the injected Agent Control result contract. Missing or ambiguous markers
  stay in review; `DONE` records durable evidence before completion.
- Late hooks cannot reopen or mutate terminal tasks.
- Managed dashboard tasks remain active after Desktop launch. Their original
  task ID is bound to the new pinned Codex session, and only that session's
  real lifecycle completion can finish the mission.
- Android foreground synchronization runs every three seconds; WorkManager
  continues durable background and reconnect synchronization.
- PostgreSQL, Room, and the offline outbox persist task detail, progress,
  activity, approvals, waiting, failure, and completion data.

## Dispatch Safety

- Android offers Remote and Desktop launch controls only for dispatchable
  ready, waiting, or failed tasks.
- Queued and active missions cannot be dispatched twice; they show their
  current execution state and retain only the cancel action.
- Desktop dispatch always starts Codex for the requested workspace and refuses
  to create a task unless that workspace is visible in Codex Desktop.
- The native thread-pinning tool must succeed before the adapter binds the
  dashboard task to the session.
- Android Remote opens through the official `com.openai.chat://codex/open`
  deep link. The mission is queued only after Android accepts that launch.

## Windows Runtime

- Scheduled task: `AgentControlWindowsAdapter`.
- Local health endpoint: `http://127.0.0.1:17867/health`.
- All five hooks are installed and verified: `SessionStart`,
  `UserPromptSubmit`, `PostToolUse`, `Stop`, and `SessionEnd`.
- Hook registration self-repairs every 30 seconds.
- Durable SQLite state preserves hook outbox events and managed
  task-to-session bindings across process restarts.

## Production Runtime

- Control plane: `https://agent-control-phi.vercel.app`
- Deployment: `dpl_AUZ9yZYEFmWRnSfV2G7AUpQnBZvE`
- Deployment target/status: production / ready
- PostgreSQL migration `0004_task_activity_postgres.sql`: applied
- Health endpoint: `{"status":"ok"}`
- Owner-token authentication remains required on every non-health route.

## Physical Samsung Acceptance

- Target: Samsung `SM-S938B`, hardware serial `R5CY610XJGV`.
- AADB 0.2.0 doctor passed and matched the bound hardware; the shared ADB
  daemon was not restarted.
- Release installed successfully in place with `adb install -r`; app data was
  neither uninstalled nor cleared.
- Installed package readback: version code `8`, version name `0.4.2`.
- Existing encrypted production configuration survived the upgrade.
- Main UI readback showed `Everything synchronized`, working, waiting, and
  attention counts, readable mission names, live steps, progress, priority,
  assignment, and synchronization state.
- Failed mission detail showed `Start in Android Remote`, `Retry in Codex
  Desktop`, `Stop and cancel`, and ordered activity history.
- Queued mission detail hid duplicate launch controls and showed `Waiting for
  an available executor` plus `Stop and cancel`.
- Dashboard proof: `docs\evidence\agent-control-0.4.2-synced.png`
- Failed-detail proof: `docs\evidence\agent-control-0.4.1-failed-detail.png`
- Queued-detail proof: `docs\evidence\agent-control-0.4.1-queued-detail.png`

The installed Android app, hosted control plane, PostgreSQL schema, Windows
adapter, Codex hooks, offline storage, reconnect path, and user-visible mission
states were checked on their actual runtime paths.
