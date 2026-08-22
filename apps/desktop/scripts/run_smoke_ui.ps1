$ErrorActionPreference = "Stop"

# Where the dev server output is kept, so a failure can be diagnosed.
# Note: $ErrorActionPreference = "Stop" does NOT apply to native commands, so
# failures have to be detected by reading $LASTEXITCODE by hand.
$logDir = Join-Path ([System.IO.Path]::GetTempPath()) "ember-smoke-ui"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$devOutLog = Join-Path $logDir "dev-server.out.log"
$devErrLog = Join-Path $logDir "dev-server.err.log"

# Default to failure so an early throw can never be reported as success.
$exitCode = 1
$failure = "smoke test did not run"

$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev -- --host 127.0.0.1 --port 1420" -WorkingDirectory "." -WindowStyle Hidden -PassThru -RedirectStandardOutput $devOutLog -RedirectStandardError $devErrLog

try {
  $ok = $false
  for ($i = 0; $i -lt 80; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:1420" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -ge 200) {
        $ok = $true
        break
      }
    } catch {
      # retry
    }
    Start-Sleep -Milliseconds 250
  }

  if ($ok) {
    $env:SMOKE_UI_URL = "http://127.0.0.1:1420"
    node scripts/smoke_ui_playwright.mjs
    # Without this check a node crash is reported to npm (and to release.sh)
    # as a success. That is how a crashing smoke test slipped through the
    # v0.0.220 and v0.0.221 releases.
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      $failure = "node scripts/smoke_ui_playwright.mjs exited with $exitCode"
    }
  } else {
    $failure = "dev server startup timeout (20s, http://127.0.0.1:1420)"
  }
} finally {
  # Killing the cmd.exe wrapper leaves the npm / vite node.exe children alive, and
  # they keep the inherited stdout pipe open. To the caller (release.sh, or an agent
  # capturing output) the test then looks hung even though it already finished.
  # So walk the process tree of what we started and kill the descendants too.
  # Enumerate BEFORE killing: once the parent is gone the links can't be followed.
  if ($proc) {
    $tree = @($proc.Id)
    for ($depth = 0; $depth -lt 5; $depth++) {
      $children = @(Get-CimInstance Win32_Process | Where-Object {
        $tree -contains $_.ParentProcessId -and $tree -notcontains $_.ProcessId
      })
      if ($children.Count -eq 0) { break }
      $tree += $children.ProcessId
    }
    # Deepest first: killing a parent first can leave its children reparented.
    # Note: $pid is a PowerShell automatic variable, so it can't be the loop var.
    [array]::Reverse($tree)
    foreach ($treeProcId in $tree) {
      Stop-Process -Id $treeProcId -Force -ErrorAction SilentlyContinue
    }
  }
  # Backstop for anything the tree walk missed. cmd.exe only, so an unrelated
  # process listening on the same port is never touched.
  $leftovers = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -ieq "cmd.exe" -and (
      $_.CommandLine -match "vite --port 1420" -or
      $_.CommandLine -match "vite --host 127\.0\.0\.1 --port 1420" -or
      $_.CommandLine -match "smoke_ui_playwright\.mjs"
    )
  }
  $leftovers | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

if ($exitCode -ne 0) {
  Write-Host "smoke-ui: FAILED - $failure"
  foreach ($log in @($devOutLog, $devErrLog)) {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 0) {
      Write-Host "--- $log (last 20 lines) ---"
      Get-Content $log -Tail 20 | ForEach-Object { Write-Host $_ }
    }
  }
}

# Cmdlets in the finally block reset the exit status, so return it explicitly.
exit $exitCode
