# /goal: AIMD low-interruption updater and About interaction redesign

## Background

The current updater/About implementation is too heavy for a productivity app.
It exposes multiple floating surfaces, repeats status copy, visually competes
with the document, and makes update work feel like the user's primary task.

Observed issues from review screenshots:

- About and Update can appear as separate prominent panels.
- About starts looking like an update workflow instead of a quiet version
  surface.
- The update panel repeats "正在检查更新" across title, message, and progress
  detail.
- The background/update affordance is another floating UI element, which adds
  interruption instead of reducing it.
- Long release URLs are shown directly in UI.
- `查看发布页面` does not use the system default browser.
- Button weight is too strong for secondary actions.

This goal replaces the over-scoped production updater UI with a low-fidelity,
low-interruption interaction model for review and implementation.

## Objective

Ship a simpler update/version experience:

1. Use one unified floating container for version and update surfaces.
2. About is quiet and static by default; it must not auto-check updates.
3. Update checks can run automatically in the background without opening a
   window unless the user asks.
4. Users can still discover updates without manually checking every time.
5. Download progress remains honest, but compact.
6. Background download status lives in the existing status bar, not another
   floating panel.
7. Release pages open in the system default browser through native code.

## Core Interaction Model

There is only one updater/version container:

```text
Unified floating panel
├─ About view
└─ Update view
```

Rules:

- `关于 AIMD` opens the unified panel in About view.
- `检查更新...` opens the unified panel in Update view and starts a manual
  check.
- About's `检查更新` action switches the same panel to Update view.
- Update work never opens a second panel.
- If update work is active and the user opens About, About may show one compact
  update status line, but must not duplicate the Update panel.
- At most one updater/version floating panel is visible at any time.
- The existing app status bar is the only background update affordance.

## Low-Fidelity Wireframes

### About View

About is for identity and version discovery. It does not start network work.

```text
┌────────────────────────────┐
│ AIMD                    ×  │
│ 版本 1.0.5 · stable        │
│ macOS arm64                │
│                            │
│ 更新状态：未检查            │
│                            │
│ [检查更新] [复制版本信息] [发布页面]
└────────────────────────────┘
```

Requirements:

- Do not show the full GitHub release URL in the panel.
- Do not render version metadata as a large table.
- Do not auto-check update when About opens.
- `发布页面` opens the system default browser.
- `检查更新` closes/replaces About content with Update view in the same
  container.
- If a background check already found an update, show:

```text
更新状态：发现 1.0.6
[检查更新] [下载并安装] [发布页面]
```

### Manual Checking

```text
┌────────────────────────────┐
│ AIMD 更新              ×   │
│ 正在检查更新               │
│ ━━━━━━━━━━━━━              │
│ 连接发布清单               │
│                            │
│                    [后台继续]
└────────────────────────────┘
```

Requirements:

- Show the checking state only for manual checks.
- Startup and scheduled checks do not show this panel.
- Do not repeat the same phrase across multiple rows.
- `×` and `后台继续` both hide the panel while work continues.

### Up To Date

Shown only after manual checks.

```text
┌────────────────────────────┐
│ AIMD 已是最新版本       ×   │
│ 当前版本 1.0.5              │
│                            │
│ [发布页面]            [关闭]
└────────────────────────────┘
```

Startup/scheduled checks with no update remain fully quiet.

### Update Available

```text
┌────────────────────────────┐
│ AIMD 1.0.6 可用        ×   │
│ 当前 1.0.5 → 最新 1.0.6    │
│ 修复更新流程，改进安装保护   │
│                            │
│ [发布说明] [稍后提醒] [下载并安装]
└────────────────────────────┘
```

Requirements:

- Release notes are a short summary, not a full changelog dump.
- Do not show long release URLs.
- `发布说明` opens the system default browser.
- `稍后提醒` suppresses repeated panel opening for this version in the current
  session.
- Scheduled checks may put `有新版本 1.0.6` in the status bar instead of opening
  this panel automatically.

### Downloading With Known Size

```text
┌────────────────────────────┐
│ 正在下载 AIMD 1.0.6    ×   │
│ ███████░░░░░ 42%           │
│ 52.4 MB / 125.6 MB         │
│ 8.1 MB/s · 约 9 秒         │
│                            │
│                    [后台继续]
└────────────────────────────┘
```

Requirements:

- Use a real determinate progress bar.
- Show percent only when total size is known.
- Show downloaded/total bytes.
- Show smoothed speed.
- Show ETA only when total size and stable speed are available.
- `×` and `后台继续` hide the panel and keep downloading.

### Downloading With Unknown Size

```text
┌────────────────────────────┐
│ 正在下载 AIMD 1.0.6    ×   │
│ ━━━━━━━━━━━━━              │
│ 已下载 52.4 MB · 8.1 MB/s  │
│                            │
│                    [后台继续]
└────────────────────────────┘
```

Requirements:

- Use an indeterminate progress bar.
- Do not show fake percent.
- Do not show fake ETA.
- Still show downloaded bytes and speed when available.

### Background Status

Background status is not a floating chip. It uses the existing status bar.

```text
Status bar:
正在下载 1.0.6 · 42%
```

Other possible status bar copy:

```text
有新版本 1.0.6
更新失败
更新已准备好
```

Requirements:

- Clicking the status text restores the same Update view.
- Restoring must not start a second check or second download.
- If the user closes the app while downloading, the UI/logs must not claim that
  the download is resumable unless resumable downloads are implemented.

### Blocked By Unsaved Documents

```text
┌────────────────────────────┐
│ 需要先保存文档          ×   │
│ 有 2 个未保存文档，保存后再安装 │
│                            │
│ [定位文档]        [保存后重试]
└────────────────────────────┘
```

Requirements:

- Never install, relaunch, or close windows while any document has unsaved
  changes.
- `定位文档` focuses one dirty document window.
- `保存后重试` re-runs the install preflight for the same pending update.
- The panel remains recoverable after the user saves documents.

### Installing / Verifying

```text
┌────────────────────────────┐
│ 正在准备安装           ×   │
│ 正在验证签名               │
│ ━━━━━━━━━━━━━              │
│                            │
│                    [后台继续]
└────────────────────────────┘
```

macOS PKG completion:

```text
┌────────────────────────────┐
│ 已打开系统安装器        ×   │
│ 完成安装后重新打开 AIMD     │
│                            │
│                      [关闭]
└────────────────────────────┘
```

Requirements:

- Keep signature verification before opening the installer.
- Use concise copy for platform-specific behavior.
- Do not force restart while dirty documents exist.

### Error

```text
┌────────────────────────────┐
│ 更新失败               ×   │
│ 下载失败，请稍后重试       │
│                            │
│ [复制诊断]        [重新检查]
└────────────────────────────┘
```

Requirements:

- Errors do not block editing.
- Scheduled check failures do not open the panel.
- Manual check/install failures show this compact error state.
- Diagnostics copy is safe and concise: request id, current version, target
  version, platform, endpoint, elapsed time, error message.
- Do not expose signing keys, signatures, secrets, or raw stack traces.

## Automatic Update Checks

Automatic checks are background capability, not automatic popups.

### Timing

Implement these checks:

- On app startup, wait 30-60 seconds before checking.
- Only run startup check when the last automatic check was more than 24 hours
  ago.
- While the app remains open, schedule another check roughly every 24 hours.
- Add 0-2 hours of random jitter to scheduled checks.
- On resume/network recovery, check only if the last automatic check was more
  than 24 hours ago.
- Manual `检查更新...` always runs immediately and ignores the 24-hour throttle.

### Persistence

Store safe local updater metadata:

```text
lastAutoCheckAt
lastManualCheckAt
lastSeenVersion
lastDismissedVersion
lastNotifiedVersion
```

Requirements:

- Per-version dismissal suppresses repeated panel opening.
- A new version may notify again.
- Failed automatic checks should back off and log, but not open UI.

### Notification Behavior

Automatic check result handling:

```text
No update     → silent
Update found  → status bar: 有新版本 1.0.6
Check failed  → log only
```

Do not automatically download by default.

Future setting shape:

```text
自动检查更新    on by default
自动下载更新    off by default
```

Installation/restart always requires user confirmation.

## Native Browser Requirement

`发布页面` and `发布说明` must open in the system default browser.

Do not use `window.open`.

Required implementation shape:

```text
frontend click
→ invoke("open_external_url", { url })
→ Rust validates URL
→ system default browser opens URL
```

Security requirements:

- Accept only `https://` URLs.
- Prefer allowlisting the AIMD GitHub release origin/path.
- Do not allow `file:`, `javascript:`, `tauri:`, `asset:`, or custom schemes.
- On failure, show a compact inline error or copyable URL fallback.

## Visual Design Requirements

Use the existing AIMD desktop visual language:

- Quiet desktop-product UI.
- One compact floating container.
- No nested cards.
- No large tables for About.
- No black/high-emphasis button for secondary actions.
- No long raw URLs in visible UI.
- Stable progress row dimensions.
- Button labels must fit at narrow desktop widths.
- Use primary action only for the single main action:
  - `下载并安装`
  - `关闭` only when it is the sole completion action may remain secondary.
- Secondary actions:
  - `检查更新`
  - `发布页面`
  - `发布说明`
  - `复制版本信息`
  - `后台继续`
  - `稍后提醒`

## State Model Requirements

Keep a centralized updater state, but simplify the visible view model.

Suggested state shape:

```ts
type UpdaterSurface = "closed" | "about" | "update";

type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "downloadingUnknownSize"
  | "installing"
  | "blocked"
  | "installed"
  | "error";

interface UpdateUiState {
  surface: UpdaterSurface;
  phase: UpdatePhase;
  requestId?: string;
  currentVersion: string;
  latestVersion?: string;
  releaseNotesSummary?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
  percent?: number;
  lastAutoCheckAt?: number;
  lastManualCheckAt?: number;
  dismissedVersion?: string;
  statusBarText?: string;
  manual: boolean;
}
```

Rules:

- About and Update are views of the same state/controller.
- Background mode means `surface: "closed"` plus status bar text.
- Reopening from status bar restores `surface: "update"` for the same request.
- Manual checks set `manual: true`; automatic checks set `manual: false`.

## Files To Inspect / Update

- `apps/desktop/src/updater/client.ts`
- `apps/desktop/src/updater/telemetry.ts`
- `apps/desktop/src/updater/release.ts`
- `apps/desktop/src/ui/template.ts`
- `apps/desktop/src/styles/updater.css`
- `apps/desktop/src/core/dom.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src-tauri/src/menu.rs`
- `apps/desktop/src-tauri/src/updater.rs`
- existing external URL/open command code, if present
- `apps/desktop/e2e/51-updater-notification.spec.ts`

## Testing Requirements

### Unit / Helper Tests

Cover:

- byte formatting
- speed smoothing
- ETA omission when unknown/unreliable
- known-size progress formatting
- unknown-size progress formatting
- safe diagnostics copy payload
- automatic-check throttle and per-version dismissal logic

### Rust Tests

Cover:

- external URL validation rejects unsafe schemes.
- external URL validation accepts the AIMD GitHub releases URL.
- macOS PKG progress event payload remains camelCase.
- version comparison remains SemVer triplet based.

### E2E Tests

Required Playwright cases:

1. `关于 AIMD` opens About view only and does not auto-check.
2. About `检查更新` switches the same panel to Update view.
3. Native `检查更新...` opens the same Update view.
4. Manual no-update check shows up-to-date state.
5. Startup no-update check stays quiet.
6. Scheduled update found shows only status bar text first.
7. Clicking status bar opens the available update panel.
8. Available update shows concise notes and actions.
9. `发布页面` / `发布说明` invokes native external open command with safe URL.
10. Known-size download shows determinate progress, speed, and ETA.
11. Unknown-size download shows indeterminate progress, bytes, and speed only.
12. `后台继续` hides panel and preserves status bar progress.
13. Status bar restore does not duplicate download/check.
14. Dirty document blocks install and can focus dirty document.
15. Automatic check failure logs quietly and does not show a panel.
16. Manual failure shows compact error state.
17. Narrow viewport has no clipped button labels or horizontal overflow.

### Visual QA

Capture screenshots for:

- About view
- manual checking
- update available
- known-size downloading
- unknown-size downloading
- background status bar
- dirty document blocked
- install/verifying
- error

Verify:

- only one updater/version panel is visible
- no long raw URL in UI
- no repeated status copy
- no second floating background chip
- status bar text fits
- buttons do not overflow

## Acceptance Criteria

- `关于 AIMD` and `检查更新...` use one unified panel container.
- About does not automatically check for updates.
- Automatic checks run on a throttled schedule.
- Automatic no-update and failure states are quiet.
- Automatic update-found state appears first in the status bar, not as a
  modal/panel.
- Manual checks remain explicit and visible.
- Download progress remains accurate and compact.
- Background mode uses the existing status bar only.
- Reopening update UI never starts duplicate work.
- Dirty document protection remains intact.
- Release links open via system default browser through native code.
- Unsafe external URL schemes are rejected.
- UI is quieter than the previous implementation and does not compete with the
  document.
- Required unit/helper, Rust, E2E, and visual QA checks pass.

## Out Of Scope

- Forced updates.
- Automatic download by default.
- Resumable downloads.
- Release pipeline/signing changes.
- Whole app shell redesign.
- New notification center.

## Completion Notes

The intended product feel:

- AIMD knows when updates exist.
- Users are informed without being interrupted.
- About stays a calm version surface.
- Update work is recoverable but not noisy.
- Installation remains explicit and safe.
