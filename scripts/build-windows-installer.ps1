param(
    [string]$OutDir = "",
    [switch]$SkipEnv,
    [switch]$SkipNpmInstall,
    [switch]$SkipChecks,
    [switch]$Clean,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$desktop = Join-Path $root "apps\desktop"
$tauri = Join-Path $desktop "src-tauri"
$target = Join-Path $root "target"
$bundle = Join-Path $target "release\bundle\nsis"
$resources = Join-Path $tauri "windows\resources"
$releaseConfig = Join-Path $root "release.config.json"

if (-not $OutDir) {
    $OutDir = Join-Path $root "dist"
}

if ($Help) {
    @"
Usage:
  .\scripts\build-windows-installer.cmd
  .\scripts\build-windows-installer.ps1

Options:
  -SkipEnv         Do not install/check winget-managed prerequisites.
  -SkipNpmInstall Do not run npm install/npm ci.
  -SkipChecks     Do not run npm run check.
  -Clean          Remove target/ before building.
  -OutDir <dir>   Output directory. Defaults to dist/.

Output:
  dist\AIMD-Desktop_<version>_windows_x64-setup.exe

Set AIMD_RELEASE=1 or AIMD_UPDATER_ARTIFACTS=1 to sign the final NSIS installer
for Tauri updater distribution:
  dist\AIMD-Desktop_<version>_windows_x64-setup.exe.sig
"@
    exit 0
}

function Test-UpdaterArtifactsRequired {
    return ($env:AIMD_RELEASE -eq "1" -or $env:AIMD_UPDATER_ARTIFACTS -eq "1")
}

function Ensure-UpdaterSigningEnv {
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and -not $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
        throw "updater signing requires TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH"
    }
    if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
    }
}

function Sign-UpdaterArtifact($ArtifactPath) {
    Ensure-UpdaterSigningEnv
    node (Join-Path $root "scripts\sign-updater-artifact.mjs") $ArtifactPath --cwd $desktop
    if ($LASTEXITCODE -ne 0) { throw "updater artifact signing failed" }
    $sig = "$ArtifactPath.sig"
    if (-not (Test-Path -LiteralPath $sig -PathType Leaf)) {
        throw "updater signature was not produced: $sig"
    }
    Write-Host "signature -> $sig"
}

function Require-Command($Name, $InstallId) {
    if (Get-Command $Name -ErrorAction SilentlyContinue) {
        Write-Host "==> $Name found"
        return
    }
    if ($SkipEnv) {
        throw "$Name is required. Install it or rerun without -SkipEnv."
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget is required to auto-install $Name. Install App Installer, then rerun."
    }
    Write-Host "==> installing $InstallId"
    winget install -e --id $InstallId --accept-source-agreements --accept-package-agreements
}

function Copy-CleanDirectory($Source, $Destination) {
    if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

Write-Host "==> AIMD Windows installer build"
Write-Host "    root: $root"

if ($Clean -and (Test-Path -LiteralPath $target)) {
    Write-Host "==> cleaning target"
    Remove-Item -LiteralPath $target -Recurse -Force
}

$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
Require-Command node OpenJS.NodeJS.LTS
Require-Command npm OpenJS.NodeJS.LTS
Require-Command cargo Rustlang.Rustup

if (-not $SkipEnv) {
    Write-Host "==> ensuring Microsoft Edge WebView2 Runtime"
    winget list -e --id Microsoft.EdgeWebView2Runtime | Out-Null
    if ($LASTEXITCODE -ne 0) {
        winget install -e --id Microsoft.EdgeWebView2Runtime --accept-source-agreements --accept-package-agreements
    }

    Write-Host "==> ensuring Visual Studio Build Tools C++ workload"
    winget list -e --id Microsoft.VisualStudio.2022.BuildTools | Out-Null
    if ($LASTEXITCODE -ne 0) {
        winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    }
}

Write-Host "==> versions"
node -v
if ($LASTEXITCODE -ne 0) { throw "node -v failed" }
npm -v
if ($LASTEXITCODE -ne 0) { throw "npm -v failed" }
cargo --version
if ($LASTEXITCODE -ne 0) { throw "cargo --version failed" }

Write-Host "==> synchronizing release version"
Push-Location $root
try {
    node scripts/sync-version.mjs
    if ($LASTEXITCODE -ne 0) { throw "version sync failed" }
} finally {
    Pop-Location
}

Write-Host "==> building AIMD CLI"
Push-Location $root
try {
    cargo build --release -p aimd-cli
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
} finally {
    Pop-Location
}

$cli = Join-Path $target "release\aimd.exe"
$skill = Join-Path $root "skill"
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
    throw "Missing release CLI: $cli"
}
if (-not (Test-Path -LiteralPath (Join-Path $skill "SKILL.md") -PathType Leaf)) {
    throw "Missing AIMD skill source: $skill"
}

Write-Host "==> staging Windows installer resources"
if (Test-Path -LiteralPath $resources) {
    Remove-Item -LiteralPath $resources -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $resources "aimd-cli") -Force | Out-Null
Copy-Item -LiteralPath $cli -Destination (Join-Path $resources "aimd-cli\aimd.exe") -Force
Copy-CleanDirectory $skill (Join-Path $resources "aimd-skill")

if (-not $SkipNpmInstall) {
    Write-Host "==> installing frontend dependencies"
    Push-Location $desktop
    try {
        if ($env:CI) {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
        } else {
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        }
    } finally {
        Pop-Location
    }
}

if (-not $SkipChecks) {
    Write-Host "==> running frontend checks"
    Push-Location $desktop
    try {
        npm run check
        if ($LASTEXITCODE -ne 0) { throw "npm run check failed" }
    } finally {
        Pop-Location
    }
}

Write-Host "==> building Tauri NSIS installer"
Push-Location $desktop
try {
    npm run build:injector
    if ($LASTEXITCODE -ne 0) { throw "npm run build:injector failed" }
    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "npx tauri build --bundles nsis failed" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$version = (Get-Content -LiteralPath $releaseConfig -Raw | ConvertFrom-Json).version
if (-not $version) {
    throw "Could not read release version from $releaseConfig"
}
$normalized = Join-Path $OutDir "AIMD-Desktop_$($version)_windows_x64-setup.exe"

$setup = Get-ChildItem -LiteralPath $bundle -Filter "*.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $setup) {
    throw "No NSIS setup executable found under $bundle"
}

Copy-Item -LiteralPath $setup.FullName -Destination $normalized -Force
if (Test-Path -LiteralPath "$normalized.sig" -PathType Leaf) {
    Remove-Item -LiteralPath "$normalized.sig" -Force
}

if (Test-UpdaterArtifactsRequired) {
    Sign-UpdaterArtifact $normalized
}

Write-Host "installer -> $normalized"
Get-ChildItem -LiteralPath $OutDir -Filter "AIMD-Desktop_*_windows_x64-setup.exe" | Select-Object Name,Length
