# Agent Control Android Overhaul

## Goal

Turn Agent Control into a calm, information-dense mobile control surface where the owner can understand every mission, agent, blocker, and recent change in seconds, while preserving offline operation and the existing production execution path.

## Problems Confirmed

- Codex sessions are created from a filesystem path before their first prompt and are never renamed.
- The dashboard stores no current step or progress and ignores task events already returned by sync.
- The command screen repeats the same generic cards and makes status, agent ownership, age, and attention needs hard to scan.
- The board renders every status group in one long list, including empty groups and old proof tasks.
- Task creation uses a modal card that collides with the keyboard and gives no useful title preview.
- Agent rows expose internal IDs instead of the task being performed.
- Hook registration has drifted: Agent Control is currently registered only for `Stop`, so session start and prompt activity are not reliably captured.

## Product Structure

### Command

- Compact top bar with synchronization state and manual refresh.
- A single operational summary strip: working, waiting, and attention counts.
- `Now working` appears first and shows task name, current step, responsible agent, last activity, and progress.
- `Needs attention` follows for approvals, failures, conflicts, and blocked work.
- `Up next` shows ready and queued work.
- Recent completions are collapsed into a compact history section.

### Board

- One status lane at a time on phones, selected with a scrollable segmented row and count badges.
- Search and sort remain available without forcing all columns into one vertical document.
- Terminal work is grouped into `History`; empty lanes show a useful state rather than a heading with nothing beneath it.

### Agents

- Fresh heartbeat state is computed locally, so a stale `online` value is never presented as live.
- Each row shows agent name, executor type, current task title, heartbeat age, and capabilities.

### Mission Detail

- Dedicated full-screen surface, not a card over the dashboard.
- Clear title, full request, state, priority, agent, timestamps, current step, progress, synchronization state, and chronological activity.
- Contextual actions only: run on phone, queue for Windows, retry, cancel, approve, or reject.

### New Mission

- Dedicated full-screen editor with IME-safe scrolling and a persistent create action.
- Description is primary. A generated title preview updates as the request changes.
- The title can be edited explicitly and is then pinned.
- Priority uses a segmented selector with plain-language labels.
- Executor choice is explicit and defaults to Windows Codex.
- Creation remains local-first; dispatch is queued in the same offline outbox.

## Visual System

- Near-black neutral background, charcoal surfaces, and thin separators instead of large gray blocks.
- Mint signals healthy/live work, blue signals queued work, amber signals waiting, red signals failures, and green signals completion.
- Cards use at most 8 dp radius. Repeated mission rows use a narrow status rail, stable spacing, and restrained elevation.
- Type hierarchy is compact: 24 sp page titles, 17 sp mission titles, 14 sp current activity, and 12 sp metadata.
- All interactive targets are at least 48 dp, status is never communicated by color alone, and text supports Android font scaling without fixed-height clipping.

## Lifecycle And Data

Task records gain nullable `progressPercent`, `currentStep`, `startedAt`, and `completedAt`. Nullable progress means the executor cannot honestly estimate a percentage; the Android UI then renders an indeterminate live indicator.

Task events are persisted in Room and shown in the detail timeline. Sync remains cursor-based and offline-first. Existing app data is retained with a Room migration.

The control plane gains two internal capabilities:

1. Update task details when a real Codex prompt arrives after `SessionStart`.
2. Record progress/current-step updates as task events while bumping task version and update time.

Managed Windows work reports real pipeline stages: assigned, preparing, executing, verifying, and complete. Interactive Codex sessions report current activity without inventing a percentage.

## Naming Rules

- Android creation generates a short action-and-target title and lets the owner override it.
- `SessionStart` creates `Codex session - <workspace>` immediately.
- `UserPromptSubmit` replaces that placeholder with a title derived from the real prompt and updates the full description.
- Path-only titles are converted to a readable workspace label.
- Repeated filler and voice-transcription duplication are normalized before truncation.
- User-edited titles are pinned and never overwritten automatically.

## Reliability

- The Windows installer repairs Agent Control entries for `SessionStart`, `UserPromptSubmit`, `PostToolUse`, and `Stop` without removing unrelated hooks.
- The adapter periodically verifies those entries to survive later hook-file rewrites.
- Sync uses cellular or Wi-Fi and keeps Room as the source of truth while offline.
- Production changes are backward compatible: new task fields are optional at the protocol boundary and database columns have defaults or allow null.

## Acceptance Criteria

- No active task is presented primarily as a raw Windows path.
- A new Codex session appears immediately and is renamed after its first real prompt.
- Working tasks show current activity, agent, freshness, and honest progress treatment.
- Blocking, approval, failure, and synchronization-conflict states are visible on the first screen.
- Creation and task detail remain fully usable with the keyboard open and at large font scale.
- Room migration preserves existing tasks and configuration.
- Unit, integration, lint, release build, production API, emulator, and physical Samsung checks pass.
- The physical update uses `adb install -r`; package data and the existing home shortcut remain intact.
