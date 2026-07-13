# Agent Control

Agent Control is an offline-first Android task dashboard and always-on control
plane for Codex and other AI executors. Tasks created without connectivity stay
in a Room outbox, synchronize when a network returns, and are dispatched only
when a compatible executor has a fresh server-side heartbeat.

Production dashboard API: <https://agent-control-phi.vercel.app>

## Capabilities

- Create, edit, prioritize, and monitor tasks from Android online or offline.
- Track queued, active, waiting, failed, approval, and completed work.
- Receive Codex session lifecycle events from a persistent Windows adapter.
- Dispatch Android-created tasks to an online Windows Codex runtime.
- Keep the dashboard available through the hosted control plane while the PC is
  off; execution waits safely until an executor returns.
- Preserve Android data during in-place APK upgrades.

No usage-based AI billing is built into this project. Executors use their own
installed and authenticated runtimes.

## Architecture

- `protocol/`: shared Zod contracts for tasks, events, commands, and agents.
- `control-plane/`: Hono API for Vercel/PostgreSQL, with synchronization,
  dispatch, heartbeats, approvals, and owner-token authentication. A Cloudflare
  Worker/D1 implementation is retained as an optional alternative.
- `android-app/`: Kotlin, Jetpack Compose, Room, WorkManager, and encrypted
  configuration.
- `windows-adapter/`: Node service, SQLite event queue, Codex hooks, executor,
  scheduled task installer, and local health endpoint.
- `release/`: verified signed Android APK.
- `docs/evidence/`: physical-device launcher and runtime screenshots.

## Requirements

- Windows 11 and PowerShell 5.1 or newer for the adapter installer.
- Node.js 22 or newer and npm.
- Codex installed and authenticated on each Windows executor.
- PostgreSQL and a Vercel account for a new hosted control plane.
- JDK 17 plus Android SDK API 36 to rebuild the Android app.
- Android 8.0/API 26 or newer to run the APK.

## Verify The Source

```powershell
npm run install:all
npm test
npm run typecheck
npm run build
npm run audit:production
npm run verify:powershell5
npm run verify:portability

Set-Location android-app
.\gradlew.bat testDebugUnitTest lintDebug lintVitalRelease assembleRelease
```

The generic Node suite contains 39 tests. PostgreSQL integration tests require
`control-plane/.env.local` and run separately:

```powershell
npm run db:migrate --prefix control-plane
npm run test:postgres --prefix control-plane
```

## Deploy A Control Plane

1. Copy `control-plane/.env.example` to `control-plane/.env.local`.
2. Set `DATABASE_URL` to a TLS PostgreSQL connection string.
3. Generate a high-entropy `OWNER_TOKEN`; use the same value in Android and on
   every trusted executor. Never commit either value.
4. Run the migration and PostgreSQL integration commands above.
5. From `control-plane`, run `npx vercel`, configure `DATABASE_URL` and
   `OWNER_TOKEN` as Vercel secrets, then run `npx vercel --prod`.
6. Confirm `https://YOUR-DOMAIN/health` returns `{"status":"ok"}`.

`control-plane/Deploy-AgentControl.ps1` is the optional Cloudflare Worker/D1
deployment route. It is not required for the Vercel/PostgreSQL production path.

## Install The Windows Executor

Run from an ordinary PowerShell session after `npm run install:all`:

```powershell
.\windows-adapter\Install-AgentControlAdapter.ps1 `
  -ApiUrl "https://YOUR-DOMAIN" `
  -OwnerToken "YOUR_OWNER_TOKEN"
```

The installer builds the adapter, registers `AgentControlWindowsAdapter`, adds
Codex lifecycle hooks, and stores user-scoped configuration. Verify it with:

```powershell
Invoke-RestMethod http://127.0.0.1:17867/health
Get-ScheduledTask AgentControlWindowsAdapter
```

## Install Android

The verified release is `release/agent-control-0.2.2.apk` (SHA-256 is recorded
in `VERIFICATION.md`). Install it through Android's package installer or, with
exactly one intended device selected:

```powershell
adb install -r .\release\agent-control-0.2.2.apk
```

Do not uninstall or clear app data during upgrades. Open Settings in Agent
Control, enter the HTTPS control-plane URL and owner token, save, then refresh.
Without Wi-Fi or mobile data, task changes remain usable and queued locally.

To build a deployment-specific release, provide the API URL and a private
keystore through Gradle properties; never add keystores or passwords to git:

```powershell
Set-Location android-app
.\gradlew.bat assembleRelease `
  -PagentControlApiUrl="https://YOUR-DOMAIN" `
  -PagentControlKeystore="C:\secure\agent-control.jks" `
  -PagentControlStorePassword="..." `
  -PagentControlKeyAlias="agentcontrol" `
  -PagentControlKeyPassword="..."
```

## Security

The owner token is required on all non-health API routes. Android stores it in
encrypted preferences; Windows stores it as a user environment variable. Local
`.env` files, Vercel state, databases, keystores, logs, caches, and generated
build trees are intentionally excluded from version control.

See `VERIFICATION.md` for automated, production, emulator, and physical-device
acceptance evidence.
