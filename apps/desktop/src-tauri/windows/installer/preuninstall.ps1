param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$binDir = Join-Path $InstallDir "bin"
$shareDir = Join-Path $InstallDir "share"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath) {
    $pathParts = $userPath -split ";" | Where-Object {
        $_ -ne "" -and $_.TrimEnd("\") -ine $binDir.TrimEnd("\")
    }
    [Environment]::SetEnvironmentVariable("Path", ($pathParts -join ";"), "User")
}

if (Test-Path -LiteralPath $binDir) {
    Remove-Item -LiteralPath $binDir -Recurse -Force
}
if (Test-Path -LiteralPath $shareDir) {
    Remove-Item -LiteralPath $shareDir -Recurse -Force
}
