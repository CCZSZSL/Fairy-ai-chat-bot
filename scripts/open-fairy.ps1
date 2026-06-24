$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ElectronExe = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"
$DistIndex = Join-Path $ProjectRoot "dist\index.html"

if (-not (Test-Path $ElectronExe)) {
  [System.Windows.Forms.MessageBox]::Show("Electron is not installed in this project yet.", "fairy") | Out-Null
  exit 1
}

if (-not (Test-Path $DistIndex)) {
  [System.Windows.Forms.MessageBox]::Show("fairy has not been built yet. Run pnpm build once, then open again.", "fairy") | Out-Null
  exit 1
}

$projectElectronProcesses = Get-CimInstance Win32_Process -Filter "name = 'electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.ExecutablePath -like "$ProjectRoot*") -or
    ($_.CommandLine -like "*$ProjectRoot*")
  }

$visibleWindow = Get-Process -Name "electron" -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.Path -like "$ProjectRoot*") -and
    (-not [string]::IsNullOrWhiteSpace($_.MainWindowTitle))
  } |
  Select-Object -First 1

if ($visibleWindow) {
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shell.AppActivate("fairy") | Out-Null
  } catch {
    # Existing process is enough; activation is best-effort.
  }
  exit 0
}

if ($projectElectronProcesses) {
  foreach ($process in $projectElectronProcesses) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
}

$env:FAIRY_LOAD_DIST = "1"
Start-Process -FilePath $ElectronExe -ArgumentList @(".") -WorkingDirectory $ProjectRoot
