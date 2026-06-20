$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$MemoryDir = Join-Path $Root "fairy-memory"
$SecretsPath = Join-Path $MemoryDir "secrets.json"

New-Item -ItemType Directory -Force -Path $MemoryDir | Out-Null

$SecureKey = Read-Host "Paste MiMo API key" -AsSecureString
$Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)

try {
  $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr)
}

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  throw "MiMo API key cannot be empty."
}

$Secrets = [ordered]@{
  providers = [ordered]@{
    mimo = [ordered]@{
      apiKey = $ApiKey
    }
  }
}

$Json = $Secrets | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($SecretsPath, $Json, [System.Text.UTF8Encoding]::new($false))
Write-Host "Saved MiMo API key to $SecretsPath"
