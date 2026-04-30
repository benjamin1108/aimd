@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "DESKTOP=%ROOT%\apps\desktop"
rem Cargo workspace lives at %ROOT%\Cargo.toml, so all crate target/ output
rem (including the Tauri bundle) lands at %ROOT%\target, NOT under
rem %DESKTOP%\src-tauri\target. The latter only exists as stale leftovers
rem from a pre-workspace build and would silently ship outdated bundles.
set "BUNDLE=%ROOT%\target\release\bundle"
set "DIST=%ROOT%\dist"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo ==^> AIMD Windows desktop build
echo     root: %ROOT%

if not exist "%DESKTOP%\package.json" (
  echo error: desktop project not found: %DESKTOP%
  exit /b 1
)

where winget >nul 2>nul
if errorlevel 1 (
  echo error: winget is required. Install App Installer from Microsoft Store, then rerun this file.
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ==^> installing Node.js LTS
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 exit /b 1
) else (
  echo ==^> node found
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ==^> installing Node.js LTS for npm
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 exit /b 1
) else (
  echo ==^> npm found
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo ==^> installing Rustup
  winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
  if errorlevel 1 exit /b 1
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
  where rustup >nul 2>nul
  if errorlevel 1 (
    echo error: rustup was installed but is not available in PATH. Close this terminal and rerun build-windows.bat.
    exit /b 1
  )
  rustup default stable
  if errorlevel 1 exit /b 1
) else (
  echo ==^> cargo found
)

echo ==^> ensuring Microsoft.EdgeWebView2Runtime
winget list -e --id Microsoft.EdgeWebView2Runtime >nul 2>nul
if errorlevel 1 (
  winget install -e --id Microsoft.EdgeWebView2Runtime --accept-source-agreements --accept-package-agreements
  if errorlevel 1 exit /b 1
) else (
  echo ==^> Microsoft.EdgeWebView2Runtime found
)

echo ==^> ensuring Visual Studio Build Tools C++ workload
winget list -e --id Microsoft.VisualStudio.2022.BuildTools >nul 2>nul
if errorlevel 1 (
  winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  if errorlevel 1 exit /b 1
) else (
  echo ==^> Visual Studio Build Tools found
)

echo ==^> versions
node -v
if errorlevel 1 (
  echo error: node is not available. Close this terminal and rerun build-windows.bat.
  exit /b 1
)
call npm -v
if errorlevel 1 (
  echo error: npm is not available. Close this terminal and rerun build-windows.bat.
  exit /b 1
)
call cargo --version
if errorlevel 1 (
  echo error: cargo is not available. Close this terminal and rerun build-windows.bat.
  exit /b 1
)

echo ==^> installing npm dependencies
cd /d "%DESKTOP%" || exit /b 1
call npm install
if errorlevel 1 exit /b 1

echo ==^> building AIMD Desktop
call npm run build
if errorlevel 1 exit /b 1

echo ==^> copying build artifacts to %DIST%
if not exist "%DIST%" mkdir "%DIST%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$bundle='%BUNDLE%'; $dist='%DIST%';" ^
  "if (-not (Test-Path -LiteralPath $bundle)) { throw 'bundle directory not found: ' + $bundle }" ^
  "$patterns=@('*.exe','*.msi','*.msix','*.zip');" ^
  "$files=foreach($p in $patterns){ Get-ChildItem -LiteralPath $bundle -Recurse -File -Filter $p -ErrorAction SilentlyContinue };" ^
  "if (-not $files) { throw 'no Windows artifacts found under: ' + $bundle }" ^
  "foreach($f in $files){ Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $dist $f.Name) -Force; Write-Host ('  ' + $f.FullName + ' -> ' + (Join-Path $dist $f.Name)) }"
if errorlevel 1 exit /b 1

echo ==^> done
dir "%DIST%"
exit /b 0
