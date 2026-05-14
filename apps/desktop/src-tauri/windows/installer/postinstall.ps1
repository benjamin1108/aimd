param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,
    [switch]$SkipAgentInstall
)

$ErrorActionPreference = "Stop"

$resources = $InstallDir
$binSource = Join-Path $resources "aimd-cli\aimd.exe"
$skillSource = Join-Path $resources "aimd-skill"
$binDir = Join-Path $InstallDir "bin"
$skillTarget = Join-Path $InstallDir "share\skill\aimd"
$aimdTarget = Join-Path $binDir "aimd.exe"
$logPath = Join-Path $InstallDir "aimd-installer\postinstall.log"

function Write-InstallLog([string]$Message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message"
}

Write-InstallLog "Starting AIMD CLI/skill postinstall for $InstallDir"

if (-not (Test-Path -LiteralPath $binSource -PathType Leaf)) {
    throw "Missing bundled CLI: $binSource"
}
if (-not (Test-Path -LiteralPath (Join-Path $skillSource "SKILL.md") -PathType Leaf)) {
    throw "Missing bundled AIMD skill: $skillSource"
}

New-Item -ItemType Directory -Path $binDir -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $skillTarget) -Force | Out-Null

Copy-Item -LiteralPath $binSource -Destination $aimdTarget -Force
if (Test-Path -LiteralPath $skillTarget) {
    Remove-Item -LiteralPath $skillTarget -Recurse -Force
}
Copy-Item -LiteralPath $skillSource -Destination $skillTarget -Recurse -Force
Write-InstallLog "Copied CLI to $aimdTarget"
Write-InstallLog "Copied skill to $skillTarget"

try {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathParts = @()
    if ($userPath) {
        $pathParts = $userPath -split ";" | Where-Object { $_ -ne "" }
    }
    $hasBinDir = $pathParts | Where-Object { $_.TrimEnd("\") -ieq $binDir.TrimEnd("\") } | Select-Object -First 1
    if (-not $hasBinDir) {
        [Environment]::SetEnvironmentVariable("Path", ((@($pathParts) + $binDir) -join ";"), "User")
        Write-InstallLog "Added $binDir to the user PATH"
    } else {
        Write-InstallLog "$binDir is already in the user PATH"
    }
} catch {
    Write-Warning "Could not update user PATH: $($_.Exception.Message)"
    Write-InstallLog "WARNING: Could not update user PATH: $($_.Exception.Message)"
}

$env:Path = (@($binDir) + ($env:Path -split ";")) -join ";"
$env:AIMD_SKILL_SOURCE = $skillTarget

& $aimdTarget version | Out-Null
& $aimdTarget set-title --help | Out-Null
& $aimdTarget skill doctor --json | Out-Null
Write-InstallLog "CLI smoke checks passed"

if (-not $SkipAgentInstall) {
    $agents = @(
        "codex",
        "claude-code",
        "github-copilot",
        "gemini",
        "cursor",
        "amp",
        "goose",
        "opencode",
        "windsurf",
        "antigravity",
        "cline",
        "warp",
        "continue",
        "roo",
        "kiro",
        "qwen",
        "openhands",
        "qoderwork"
    )

    foreach ($agent in $agents) {
        try {
            & $aimdTarget skill install --agent $agent --scope user --force | Out-Null
            Write-InstallLog "Installed AIMD skill for $agent"
        } catch {
            Write-Warning "AIMD skill install failed for ${agent}: $($_.Exception.Message)"
            Write-InstallLog "WARNING: AIMD skill install failed for ${agent}: $($_.Exception.Message)"
        }
    }
}

Write-InstallLog "AIMD CLI/skill postinstall completed"
