$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Port = 5173
$ServerPort = 5174
$Url = "http://127.0.0.1:$Port/"
$Log = Join-Path $Root ".fairy-vite.log"
$Err = Join-Path $Root ".fairy-vite.err.log"
$ServerLog = Join-Path $Root ".fairy-server.log"
$ServerErr = Join-Path $Root ".fairy-server.err.log"
$ChromeProfile = Join-Path $Root ".chrome-fairy-profile"

function Find-FirstPath {
  param([string[]]$Candidates)
  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path $Candidate)) {
      return $Candidate
    }
  }
  return $null
}

function Test-Port {
  param([int]$PortNumber)
  try {
    $Client = New-Object Net.Sockets.TcpClient
    $Async = $Client.BeginConnect("127.0.0.1", $PortNumber, $null, $null)
    $Connected = $Async.AsyncWaitHandle.WaitOne(400)
    if ($Connected) {
      $Client.EndConnect($Async)
    }
    $Client.Close()
    return $Connected
  } catch {
    return $false
  }
}

$NodeDir = Find-FirstPath @(
  (Join-Path $env:LOCALAPPDATA "Programs\nodejs"),
  "C:\Program Files\nodejs"
)

$Pnpm = Find-FirstPath @(
  (Join-Path $env:LOCALAPPDATA "Programs\nodejs\pnpm.cmd"),
  "C:\Program Files\nodejs\pnpm.cmd",
  "pnpm.cmd"
)

$Chrome = Find-FirstPath @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
)

if (-not $Pnpm) {
  throw "pnpm was not found. Install Node.js and pnpm, or run pnpm commands manually from a terminal where pnpm is available."
}

if (-not $Chrome) {
  throw "Chrome or Edge was not found."
}

New-Item -ItemType Directory -Force -Path $ChromeProfile | Out-Null

if (-not (Test-Port -PortNumber $Port)) {
  $PathPrefix = if ($NodeDir) { "$NodeDir;" } else { "" }
  $Command = "`$env:Path='$PathPrefix' + `$env:Path; & '$Pnpm' dev:web"
  Start-Process -FilePath powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $Command
  ) -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError $Err | Out-Null

  $Deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $Deadline) {
    if (Test-Port -PortNumber $Port) {
      break
    }
    Start-Sleep -Milliseconds 350
  }
}

if (-not (Test-Port -PortNumber $ServerPort)) {
  $PathPrefix = if ($NodeDir) { "$NodeDir;" } else { "" }
  $ServerCommand = "`$env:Path='$PathPrefix' + `$env:Path; & '$Pnpm' dev:server"
  Start-Process -FilePath powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $ServerCommand
  ) -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $ServerLog -RedirectStandardError $ServerErr | Out-Null

  $Deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $Deadline) {
    if (Test-Port -PortNumber $ServerPort) {
      break
    }
    Start-Sleep -Milliseconds 350
  }
}

Start-Process -FilePath $Chrome -ArgumentList @(
  "--app=$Url",
  "--user-data-dir=$ChromeProfile",
  "--window-size=460,760",
  "--disable-features=Translate"
) -WorkingDirectory $Root | Out-Null

Write-Host "fairy web shell opened at $Url"
