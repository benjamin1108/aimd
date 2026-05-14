!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing AIMD CLI and skills..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\aimd-installer\postinstall.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "AIMD Desktop was installed, but AIMD CLI/skill setup failed. Run aimd skill doctor --json from a new terminal for diagnostics."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing AIMD CLI install metadata..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\aimd-installer\preuninstall.ps1" -InstallDir "$INSTDIR"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Clean up files left by early Windows packages and hook logs that are not
  ; tracked as Tauri resources.
  Delete "$INSTDIR\aimd.exe"
  Delete "$INSTDIR\aimd"
  Delete "$INSTDIR\aimd-installer\postinstall.log"
  Delete "$INSTDIR\aimd-installer\preuninstall.log"
  RMDir "$INSTDIR\aimd-installer"
  Delete /REBOOTOK "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
!macroend
