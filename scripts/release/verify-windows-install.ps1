# Installs the built Windows installer the way a first-time user would (silent, no folder argument),
# checks it landed in the per-user default folder, then uninstalls and checks nothing is left.
# Runs in CI on a throwaway runner only: it writes to that machine's user PATH. See docs/releasing.md.

[CmdletBinding()]
param(
    [string] $InstallerDirectory = 'target/release/bundle/nsis',
    [int] $TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'

function Fail([string] $message) {
    Write-Host "::error::$message"
    exit 1
}

function Get-UserPathEntries {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
    $path = $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
    @($path -split ';' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') })
}

function Test-UserPathContains([string] $folder) {
    (Get-UserPathEntries) -contains $folder.TrimEnd('\')
}

function Wait-Until([scriptblock] $condition) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $condition) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

$installers = @(Get-ChildItem -Path $InstallerDirectory -Filter 'Rebasar_*_x64-setup.exe')
if ($installers.Count -ne 1) {
    Fail "Expected exactly one installer in $InstallerDirectory, found $($installers.Count)."
}

$expectedFolder = Join-Path $env:LOCALAPPDATA 'Rebasar'
if (Test-Path $expectedFolder) {
    Fail "$expectedFolder exists before the install, so the check would not be about a fresh install."
}

Write-Host "Installing $($installers[0].Name) silently with no folder argument"
Start-Process -FilePath $installers[0].FullName -ArgumentList '/S' -Wait

# NSIS silent installs can return before the last files are written.
$installed = Wait-Until { Test-Path (Join-Path $expectedFolder 'uninstall.exe') }
if (-not $installed) {
    $found = Get-ChildItem -Path $env:LOCALAPPDATA, $env:TEMP -Filter 'rebasar-app.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    $where = if ($found) { $found.DirectoryName } else { 'nowhere we could find' }
    Fail "The silent install did not put Rebasar in the per-user default folder $expectedFolder; it ended up in $where."
}

foreach ($executable in 'rebasar-app.exe', 'rebasar.exe') {
    if (-not (Test-Path (Join-Path $expectedFolder $executable))) {
        Fail "$executable is missing from $expectedFolder after the install."
    }
}

if (-not (Test-UserPathContains $expectedFolder)) {
    Fail "$expectedFolder is not on the user PATH after the install."
}

Write-Host "Installed in $expectedFolder and on the PATH. Uninstalling silently"
# The uninstaller copies itself to the temp folder and carries on from there, so waiting for the
# process is not enough; the folder disappearing is the sign that it finished.
Start-Process -FilePath (Join-Path $expectedFolder 'uninstall.exe') -ArgumentList '/S' -Wait

$removed = Wait-Until { -not (Test-Path $expectedFolder) }
if (-not $removed) {
    $leftovers = (Get-ChildItem -Path $expectedFolder -Recurse -Force | ForEach-Object FullName) -join ', '
    Fail "The uninstall left $expectedFolder behind: $leftovers"
}

if (Test-UserPathContains $expectedFolder) {
    Fail "The uninstall left $expectedFolder on the user PATH."
}

Write-Host 'The default install and the uninstall both behave.'
