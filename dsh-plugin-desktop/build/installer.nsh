; Check both app filenames before launching the quit handoff. This preserves
; the #469 fix: unrelated helpers under $INSTDIR must never block an upgrade.
Var pid
Var dshInstallerExecutable

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE

  dsh_installer_detect_app:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      StrCpy $dshInstallerExecutable "${APP_EXECUTABLE_FILENAME}"
      Goto dsh_installer_request_quit
    ${endIf}
    ; Renamed releases retain the AppId and install location of older releases.
    !insertmacro FIND_PROCESS "易宝工坊.exe" $R0
    ${if} $R0 != 0
      Goto dsh_installer_app_stopped
    ${endIf}
    StrCpy $dshInstallerExecutable "易宝工坊.exe"

  dsh_installer_request_quit:
    IfFileExists "$INSTDIR\$dshInstallerExecutable" 0 dsh_installer_scoped_fallback
      ; Newer versions receive this through Electron's single-instance channel.
      ; 2.0.2 ignores it, so the scoped builder fallback remains necessary for
      ; the first upgrade to a version that supports orderly shutdown.
      ExecWait '"$INSTDIR\$dshInstallerExecutable" --dsh-installer-quit'
      StrCpy $R1 0

  dsh_installer_wait_for_exit:
    !insertmacro FIND_PROCESS "$dshInstallerExecutable" $R0
    ${if} $R0 != 0
      ; Check the other filename too if both generations were running.
      Goto dsh_installer_detect_app
    ${endIf}
    IntOp $R1 $R1 + 1
    ; Slow disks, antivirus hooks, and a large physical runtime can keep the
    ; process alive after Cordis disposal begins. Give the orderly handoff a
    ; full 30 seconds before escalating to the scoped forced-close path.
    ${if} $R1 < 60
      Sleep 500
      Goto dsh_installer_wait_for_exit
    ${endIf}

  dsh_installer_scoped_fallback:
    ; The patched builder macros match only the selected app filename, never
    ; every executable below $INSTDIR. They also handle pre-handoff releases.
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK dsh_installer_stop_app
    Quit

  dsh_installer_stop_app:
    DetailPrint "$(appClosing)"
    ; KILL_PROCESS's tasklist fallback excludes $pid. The installer never has
    ; the application executable name, so zero is a safe sentinel here.
    StrCpy $pid 0
    !insertmacro KILL_PROCESS "$dshInstallerExecutable" 0
    Sleep 500
    StrCpy $R1 0

  dsh_installer_wait_for_fallback:
    !insertmacro FIND_PROCESS "$dshInstallerExecutable" $R0
    ${if} $R0 != 0
      Goto dsh_installer_detect_app
    ${endIf}
    IntOp $R1 $R1 + 1
    ${if} $R1 > 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY dsh_installer_wait_for_fallback
      Quit
    ${endIf}
    Sleep 1000
    !insertmacro KILL_PROCESS "$dshInstallerExecutable" 1
    Sleep 500
    Goto dsh_installer_wait_for_fallback

  dsh_installer_app_stopped:
!macroend
