; Puts the install folder on the user's PATH so `rebasar` works from any new terminal, and takes
; it off again on uninstall. The Path value is edited in the registry, keeping its type, rather
; than through the .NET environment API, which would flatten the `%VAR%` entries a user's Path
; often holds. PowerShell is called by its full path because the installer must not depend on PATH.

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "REBASAR_DIR", t "$INSTDIR")'
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $$true); $$p = $$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$kind = 'ExpandString'; try { $$kind = $$k.GetValueKind('Path') } catch {}; $$parts = @($$p -split ';' | Where-Object { $$_ }); if ($$parts -notcontains $$env:REBASAR_DIR) { $$k.SetValue('Path', (($$parts + $$env:REBASAR_DIR) -join ';'), $$kind) }"`
  Pop $0
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, w "Environment", i 2, i 5000, *i .r0)'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Push $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "REBASAR_DIR", t "$INSTDIR")'
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $$true); $$p = $$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$kind = 'ExpandString'; try { $$kind = $$k.GetValueKind('Path') } catch {}; $$kept = @($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$env:REBASAR_DIR }); $$k.SetValue('Path', ($$kept -join ';'), $$kind)"`
  Pop $0
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, w "Environment", i 2, i 5000, *i .r0)'
  Pop $0
!macroend
