# /goal: Windows 安装包补齐 AIMD CLI 与 Agent Skill 能力

## 背景

当前 `v1.0` 远端 release 的 macOS/Windows Desktop App 都来自同一个 tag，
因此 App 内共享的 `aimd-core` 能力是一致的。但今天新增的高效 Agent/CLI
能力并没有随 Windows 安装包交付：

- `aimd set-title`
- `aimd write --title`
- `aimd info --json` 的 `bodyTitle`
- `aimd doctor --json` 的 `title_mismatch`
- `aimd skill install`
- 默认把 AIMD skill 安装到各 Agent 的 user-level skill 目录

macOS 当前已有本地 `dist/AIMD-1.0.0.pkg` 制品脚本，可以安装：

- `/Applications/AIMD Desktop.app`
- `/usr/local/bin/aimd`
- `/usr/local/share/aimd/skill/aimd`
- postinstall 自动刷新 `~/.local/bin/aimd`
- postinstall 自动安装 AIMD skill 到支持的 Agent user 目录

但 GitHub release 现在只上传 Tauri 生成的 DMG/EXE/MSI，不包含 macOS PKG；
Windows EXE/MSI 也没有系统级 CLI 和 skill 安装逻辑。

本 goal 是为 Windows 机器上的下一轮适配准备可执行开发清单：让 Windows
安装后的能力与 macOS PKG 对齐，并补齐 release 验证。

## 产品目标

Windows 用户安装 AIMD 后，应获得与 macOS PKG 等价的能力：

1. 安装 AIMD Desktop App。
2. 安装系统级 `aimd.exe` CLI。
3. `aimd.exe` 包含今天新增的 title/doctor/info/skill 命令。
4. 安装 bundled AIMD skill 源到稳定位置。
5. 默认把 AIMD skill 安装到支持的 Agent user-level skill 目录。
6. 处理 PATH：新终端能直接运行 `aimd`；当前用户可发现或通过稳定路径运行。
7. 卸载或升级时行为可预测，不破坏用户手工安装的 unrelated skill。
8. GitHub release 同时上传 Windows Desktop 安装包和 Windows CLI/skill 安装制品。
9. 建立 Windows smoke 验证，证明安装后的 CLI 与 skill 真实可用。

## 非目标

- 不重做 Desktop App UI。
- 不改变 `.aimd` 文件格式。
- 不把 Windows 适配做成依赖 WSL 的方案。
- 不要求 Windows 安装包静默写入所有 Agent project-level skill 目录。
- 不在本 goal 内实现复杂的 Windows GUI installer 选择页，除非 Tauri/NSIS
  已有低成本扩展点。
- 不回退今天新增的 macOS PKG 能力。

## 需要先确认的 Windows 环境事实

在 Windows 机器上先收集证据，不要先猜：

```powershell
git status --short
git rev-parse --short HEAD
rustc --version
cargo --version
node --version
npm --version
npm run check
npm run build
Get-Command aimd -ErrorAction SilentlyContinue
```

安装后还要确认 Tauri 生成的 NSIS/ MSI 目录结构：

```powershell
Get-ChildItem -Recurse target\release\bundle | Select-Object FullName,Length
```

重点看：

- `target\release\bundle\nsis\*.exe`
- `target\release\bundle\msi\*.msi`
- Desktop App 安装目录
- 是否存在 Tauri installer hook 或 bundle resources 可放置 `aimd.exe`

## 设计要求

### 1. Windows CLI 安装位置

优先选择当前用户可写、升级安全、PATH 可控的位置：

```text
%LOCALAPPDATA%\AIMD\bin\aimd.exe
%LOCALAPPDATA%\AIMD\share\skill\aimd\
```

如果最终选择 machine-wide 安装，也必须明确权限与 UAC 行为：

```text
%ProgramFiles%\AIMD\bin\aimd.exe
%ProgramFiles%\AIMD\share\skill\aimd\
```

验收时必须说明选择理由。默认倾向 user-level，原因：

- 不需要管理员权限。
- 与 Agent user skill 目录天然同一用户上下文。
- 更容易更新 PATH。
- 不会污染其他 Windows 用户。

### 2. PATH 策略

安装后新 PowerShell/CMD 应可运行：

```powershell
aimd version
aimd help
aimd set-title --help
aimd skill doctor --json
```

实现可选路径：

- NSIS/MSI 安装时写入 user PATH。
- 或安装一个 App-provided `aimd.cmd` shim 到已在 PATH 的稳定目录。
- 或提供 `AIMD_HOME\bin` 并在安装后提示用户重开终端。

必须避免：

- 覆盖用户已有 unrelated `aimd.exe` 而不备份。
- 在 PATH 中重复追加同一路径。
- 只在当前 installer process 可见，重开终端不可见。

### 3. Windows Skill 安装源

安装包应包含与 repo `skill/` 同步的 skill 源。

建议稳定源位置：

```text
%LOCALAPPDATA%\AIMD\share\skill\aimd\
```

该目录至少应包含：

- `SKILL.md`
- `agents/openai.yaml`
- `references/cli.md`
- `references/format.md`
- `references/safety.md`
- `references/agent-install.md`
- `examples/*.md`

`SKILL.md` 必须有合法 YAML frontmatter。安装后使用实际文件验证：

```powershell
Get-Content "$env:LOCALAPPDATA\AIMD\share\skill\aimd\SKILL.md" -TotalCount 5
```

### 4. 默认安装到支持的 Agent user skill 目录

Windows postinstall 或首次运行安装步骤应调用：

```powershell
aimd skill install --agent codex --scope user --force
aimd skill install --agent claude-code --scope user --force
aimd skill install --agent github-copilot --scope user --force
aimd skill install --agent gemini --scope user --force
aimd skill install --agent cursor --scope user --force
aimd skill install --agent amp --scope user --force
aimd skill install --agent goose --scope user --force
aimd skill install --agent opencode --scope user --force
aimd skill install --agent windsurf --scope user --force
aimd skill install --agent antigravity --scope user --force
aimd skill install --agent cline --scope user --force
aimd skill install --agent warp --scope user --force
aimd skill install --agent continue --scope user --force
aimd skill install --agent roo --scope user --force
aimd skill install --agent kiro --scope user --force
aimd skill install --agent qwen --scope user --force
aimd skill install --agent openhands --scope user --force
aimd skill install --agent qoderwork --scope user --force
```

若某些 Agent 的 Windows user skill 路径还未覆盖，应更新
`crates/aimd-cli/src/skill.rs` 的平台路径映射，并补测试。

安装失败不应阻断 Desktop App 安装，但必须有诊断：

```powershell
aimd skill doctor --json
```

### 5. Windows installer hook 方案

优先调查 Tauri v2 对 NSIS/MSI 的官方 hook 支持：

- 是否支持 `bundle.windows.nsis.installMode`
- 是否支持 NSIS template / installer hooks
- 是否支持自定义 resources 和 postinstall script
- MSI 是否可用 WiX custom action 安装 CLI/PATH/skill

可选实现路径：

1. **Tauri NSIS hook 优先**
   - 把 `aimd.exe` 和 `skill/aimd` 打入安装包资源。
   - NSIS 安装阶段复制到 `%LOCALAPPDATA%\AIMD\...`。
   - 写 user PATH。
   - 调用 `aimd.exe skill install ...`。

2. **独立 Windows CLI/Skill installer**
   - 新增 `scripts/build-windows-cli-installer.ps1`。
   - 产出 `AIMD-CLI-1.0.0-windows-x64.zip` 或 `.msi`。
   - GitHub release 上传该制品。
   - Desktop EXE/MSI 暂不负责 CLI，但 release 明确提供同版本 CLI installer。

3. **Desktop 首次启动自修复**
   - Desktop App 内嵌 `aimd.exe` 与 skill resources。
   - 首次启动检测 CLI/PATH/skill，不存在则安装到 user-level。
   - 必须做到幂等，且可通过设置页重新修复。

推荐顺序：先评估 1；如果 Tauri installer hook 太重，落地 2；后续再考虑 3。

## Release 工作流要求

`.github/workflows/release.yml` 应在 Windows job 中至少完成：

```powershell
cargo build --release -p aimd-cli
target\release\aimd.exe version
target\release\aimd.exe set-title --help
target\release\aimd.exe skill doctor --json
```

然后把 Windows CLI/skill 制品纳入上传：

- 如果做独立 zip：
  - `AIMD-CLI_1.0.0_x64.zip`
  - 包含 `bin/aimd.exe`
  - 包含 `share/aimd/skill/aimd/**`
  - 包含 install/uninstall PowerShell scripts
- 如果集成到 NSIS/MSI：
  - 展开或安装到临时目录，验证 `aimd.exe` 和 skill 源存在。

Release 验收时必须用 `gh release view v1.0 --json assets` 确认远端资产刷新。

## 测试与验收

### CLI 行为 smoke

在 Windows 上用 release 构建的 `aimd.exe` 跑：

```powershell
$doc = "$env:TEMP\aimd-title-smoke.aimd"
Copy-Item examples\ai-daily-2026-04-30.aimd $doc
target\release\aimd.exe assets list $doc --json | Set-Content "$env:TEMP\before.json"
target\release\aimd.exe set-title $doc "Windows Smoke Metadata Title"
target\release\aimd.exe assets list $doc --json | Set-Content "$env:TEMP\after-set.json"
"# Windows Smoke Body`n`nBody edit." | Set-Content "$env:TEMP\body.md" -Encoding utf8
target\release\aimd.exe write $doc --input "$env:TEMP\body.md" --title "Windows Smoke Body"
target\release\aimd.exe info $doc --json
target\release\aimd.exe doctor $doc --json
```

验收点：

- `set-title` 存在且成功。
- `write --title` 存在且成功。
- asset id/path/hash 未改变。
- `info --json` 输出 `bodyTitle`。
- `doctor --json` 可输出 `title_mismatch` warning，且 warning-only 不失败。

### 安装后 smoke

安装 Windows 制品后，在新的 PowerShell 中验证：

```powershell
Get-Command aimd
aimd version
aimd set-title --help
aimd skill doctor --json
```

验证 skill：

```powershell
aimd skill list-agents
aimd skill install --agent codex --scope user --force
Test-Path "$env:USERPROFILE\.agents\skills\aimd\SKILL.md"
```

如果 Windows Codex 实际使用的是不同目录，应以 `aimd skill doctor --json`
和 Codex 实测加载结果为准，并补路径映射。

### Installer 幂等

连续安装同一版本两次：

- 不重复追加 PATH。
- 不产生坏的半安装状态。
- 不破坏用户已有 unrelated `aimd.exe`；若需要替换，应备份或明确覆盖策略。
- Agent skill 目录保持合法 `SKILL.md`。

升级安装：

- 旧 `aimd.exe` 会被新版本替换。
- 新增 CLI 命令可用。
- skill 内容刷新。
- Desktop App 可正常启动。

卸载：

- 明确哪些内容删除，哪些保留。
- 推荐默认保留 user Agent skill 目录，避免删除用户编辑内容。
- 若提供 uninstall script，应支持删除 `%LOCALAPPDATA%\AIMD\bin` 和 PATH 项。

## 需要提交的文件范围建议

可能涉及：

- `crates/aimd-cli/src/skill.rs`
- `crates/aimd-cli/src/commands.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/package.json`
- `.github/workflows/release.yml`
- `scripts/build-windows-cli-installer.ps1`
- `scripts/install-windows-cli-skill.ps1`
- `scripts/uninstall-windows-cli-skill.ps1`
- `docs/packaging-windows-installer.md`
- `docs/todo/windows-cli-skill-installer-parity-goal.md`

## 完成定义

- Windows release 资产安装后，用户能在新终端运行 `aimd set-title --help`。
- Windows release 资产安装后，至少 Codex 的 user-level AIMD skill 可被安装并加载。
- `aimd skill doctor --json` 在 Windows 上能报告实际安装状态。
- `aimd set-title` / `aimd write --title` / `aimd info --json` / `aimd doctor --json`
  的 smoke 通过。
- GitHub release 包含可证明的 Windows CLI/skill 安装制品，或 Windows EXE/MSI
  本身已包含并安装这些能力。
- 远端 release 资产刷新后，最终用 `gh release view` 和安装后 smoke 作为证据。
