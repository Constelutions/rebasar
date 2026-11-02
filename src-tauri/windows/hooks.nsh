; Puts the install folder on the user's PATH so `rebasar` works from any new terminal, and takes
; it off again on uninstall. The Path value is edited in the registry, keeping its type, rather
; than through the .NET environment API, which would flatten the `%VAR%` entries a user's Path
; often holds. PowerShell is called by its full path because the installer must not depend on PATH.
; Entries are compared without a trailing backslash, so `C:\x\` and `C:\x` are the same folder.
; A failure (PowerShell blocked by policy, for one) does not fail the install: the app still works
; by its full path, and the install log says what to do.

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "REBASAR_DIR", t "$INSTDIR")'
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = $$env:REBASAR_DIR.TrimEnd('\'); $$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $$true); $$p = $$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$kind = 'ExpandString'; try { $$kind = $$k.GetValueKind('Path') } catch {}; $$parts = @($$p -split ';' | Where-Object { $$_ }); if (@($$parts | ForEach-Object { $$_.TrimEnd('\') }) -notcontains $$d) { $$k.SetValue('Path', (($$parts + $$d) -join ';'), $$kind) }"`
  Pop $0
  StrCmp $0 "0" +2
  DetailPrint "Could not add Rebasar to your PATH (exit code $0). Add $INSTDIR to it yourself to use the rebasar command."
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, w "Environment", i 2, i 5000, *i .r0)'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Push $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "REBASAR_DIR", t "$INSTDIR")'
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = $$env:REBASAR_DIR.TrimEnd('\'); $$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $$true); $$p = $$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$kind = 'ExpandString'; try { $$kind = $$k.GetValueKind('Path') } catch {}; $$kept = @($$p -split ';' | Where-Object { $$_ -and $$_.TrimEnd('\') -ne $$d }); $$k.SetValue('Path', ($$kept -join ';'), $$kind)"`
  Pop $0
  StrCmp $0 "0" +2
  DetailPrint "Could not remove Rebasar from your PATH (exit code $0). Remove $INSTDIR from it yourself."
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, w "Environment", i 2, i 5000, *i .r0)'
  Pop $0
!macroend
