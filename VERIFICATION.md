# Agent Control 0.2.2 Verification

Verified on July 13, 2026.

## Release Artifact

- APK: `release\agent-control-0.2.2.apk`
- Package: `com.michaelovsky.agentcontrol`
- Version code: `4`
- Version name: `0.2.2`
- Minimum Android API: `26`
- Target Android API: `36`
- Size: `1,151,725` bytes
- SHA-256: `E471AEC8DAE4067F3E62116536B26BBC2350289B753923418500EF0D2E8981D6`
- Signer SHA-256:
  `f913ec8ccfae6c2813ed25f162f17a01b1d8f34b89893c13e67c337207a2d7d1`
- APK Signature Scheme v2: verified

## Automated Results

- Shared protocol: 6/6 tests passed.
- Control plane: 15/15 generic tests passed.
- PostgreSQL integration: 3/3 tests passed.
- Windows adapter: 18/18 tests passed.
- Android unit tests: passed.
- Android debug lint: passed.
- Android release vital lint: passed.
- TypeScript type checks and production builds: passed.
- Production dependency audit: zero vulnerabilities.

## Portable Study Package

- Final source path: `F:\study\AI_ML\AI_and_Machine_Learning\Artificial_Intelligence\cli\codex\agent-control-dashboard`.
- Independent component lockfiles avoid npm workspace links and install cleanly
  on the exFAT study volume.
- Clean `npm run install:all` completed for protocol, control plane, and Windows
  adapter with zero audit findings.
- All 39 generic Node tests passed from the final study path.
- Type checks and production builds passed for all three Node components.
- Six PowerShell files parsed successfully under Windows PowerShell 5.1.
- The Windows scheduled-task launcher passed a regression check proving it
  resolves Node and `dist\server.js` without a machine-specific checkout path.
- Nine Android unit tests passed from the final study path with zero failures.
- Android debug lint, release vital lint, and release assembly passed from the
  final study path.
- The packaged APK retained SHA-256
  `E471AEC8DAE4067F3E62116536B26BBC2350289B753923418500EF0D2E8981D6`
  and independently passed APK Signature Scheme v2 verification.

## Android Runtime Results

- Signed release installed in place on a physical Samsung `SM-S938B` using
  `adb install -r`.
- Existing app data and the original first-install timestamp
  `2026-07-13 01:40:57` were preserved.
- Pulled installed APK hash exactly matched the release APK hash.
- Cold launch and home-shortcut cold launch succeeded with zero fatal Android
  runtime exceptions.
- WorkManager's release-only constructor was inspected in the minimized DEX and
  verified on the physical device.
- Synchronization status now updates live across `ConfigStore` instances without
  requiring an activity restart.
- Offline instrumentation passed with airplane mode enabled and network
  reachability unavailable.
- Room migration and dashboard behavior passed offline.
- Production instrumentation verified periodic WorkManager scheduling.
- Production task roundtrip completed through the live control plane.
- Outbox drained to zero and the persisted sync state reported success.
- Physical home shortcut:
  `docs\evidence\agent-control-home-shortcut.png`
- Shortcut launch proof:
  `docs\evidence\agent-control-home-shortcut-launched.png`

## Production Results

- Control plane: `https://agent-control-phi.vercel.app`
- Deployment: `dpl_BGQFSjaVCHN7UKuT4JhYtkeibAZf`
- Health endpoint: healthy.
- Missing or incorrect owner token: rejected with HTTP 401.
- Authorized owner request: accepted.
- Client-provided executor availability is ignored.
- Dispatch availability is derived from fresh server-side agent heartbeats.
- Windows adapter health: `{"status":"ok","pending":0}`.
- Windows adapter now sends execution heartbeats every 30 seconds, preventing
  long-running Codex work from making the PC appear offline.
- Idle heartbeats clear stale `currentTaskId` state.
- Real production executor task:
  `f929bb71-33e0-4e54-b3de-f068d167dd40`
- Executor result: `DONE`.
- Exact evidence marker:
  `Agent Control Android to Windows proof 1783908598`

## Physical Acceptance

The physical installation, package readback, live synchronization, launcher
shortcut creation, shortcut cold launch, Android task creation, production
Windows claim, periodic execution heartbeat, evidence upload, and final `DONE`
transition have all been directly verified. No uninstall, app-data clear, device
reboot, or shared ADB daemon restart was used.
