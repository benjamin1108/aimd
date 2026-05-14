# Windows Installer Packaging

AIMD ships one Windows NSIS setup executable that installs the Desktop app, the
`aimd.exe` CLI, and the bundled AIMD skill source in one pass.

Build it on Windows:

```powershell
.\scripts\build-windows-installer.cmd
```

The output is:

```text
dist\AIMD-Desktop_<version>_windows_x64-setup.exe
```

## Install Layout

The installer uses Tauri's NSIS UI. The user chooses the application install
directory, and the postinstall hook installs the CLI and skill under that same
directory:

```text
<InstallDir>\AIMD Desktop.exe
<InstallDir>\bin\aimd.exe
<InstallDir>\share\skill\aimd\
```

The installer adds `<InstallDir>\bin` to the current user's PATH if the entry is
not already present. A new terminal is required before PATH changes are visible
in normal shells.

The CLI discovers the bundled skill from `<InstallDir>\share\skill\aimd`, so
`aimd skill install` and `aimd skill doctor --json` work outside the source
repository.

## Agent Skill Install

The NSIS postinstall hook best-effort installs AIMD into supported user-level
agent skill directories:

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

Individual agent install failures are warnings and do not fail the package
install.

## Uninstall

The NSIS uninstaller removes the installed application. AIMD's preuninstall hook
also removes `<InstallDir>\bin`, `<InstallDir>\share`, and the user PATH entry.
It intentionally leaves agent user skill directories untouched to avoid deleting
user-edited or unrelated agent content.

When the setup executable is launched over the same installed version, Tauri's
default maintenance page offers "reinstall" and "uninstall" choices. The Windows
build script patches the generated NSIS script and rebuilds the setup executable
so choosing "uninstall" exits after the old uninstaller succeeds instead of
continuing into a fresh install.

## Release Checks

The Windows release workflow runs:

```powershell
.\scripts\build-windows-installer.ps1 -SkipEnv
target\release\aimd.exe version
target\release\aimd.exe set-title --help
target\release\aimd.exe skill doctor --json
```

After publishing, verify release assets include the single Windows setup
executable:

```powershell
gh release view <tag> --json assets
```

Installed smoke:

```powershell
Get-Command aimd
aimd version
aimd set-title --help
aimd skill doctor --json
aimd skill list-agents
aimd skill install --agent codex --scope user --force
Test-Path "$env:USERPROFILE\.agents\skills\aimd\SKILL.md"
```
