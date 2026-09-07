param([string]$ProjectRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$issues = [System.Collections.Generic.List[string]]::new()
$orderPath = Join-Path $ProjectRoot 'SOURCE_ORDER.txt'
$governancePath = Join-Path $ProjectRoot 'MODULE_GOVERNANCE.md'
$apiPath = Join-Path $ProjectRoot 'MODULE_API.md'
$dependencyPath = Join-Path $ProjectRoot 'DEPENDENCY_GRAPH.md'

if (!(Test-Path -LiteralPath $orderPath)) { $issues.Add('Missing SOURCE_ORDER.txt') }
if (!(Test-Path -LiteralPath $governancePath)) { $issues.Add('Missing MODULE_GOVERNANCE.md') }
if (!(Test-Path -LiteralPath $apiPath)) { $issues.Add('Missing MODULE_API.md') }

if ($issues.Count -eq 0) {
  $sources = @(Get-Content -LiteralPath $orderPath -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $governance = Get-Content -LiteralPath $governancePath -Raw -Encoding UTF8
  foreach ($source in $sources) {
    if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot $source))) { $issues.Add("SOURCE_ORDER missing file: $source") }
    $count = ([regex]::Matches($governance, [regex]::Escape($source))).Count
    if ($count -ne 1) { $issues.Add("Source ownership must occur once: $source (found $count)") }
  }
  $owned = @([regex]::Matches($governance, '(?m)^- (src/[A-Za-z0-9_./-]+\.js)$') | ForEach-Object { $_.Groups[1].Value })
  foreach ($source in $owned) {
    if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot $source))) { $issues.Add("Governance references missing file: $source") }
    if ($source -notin $sources) { $issues.Add("Governed source not in SOURCE_ORDER: $source") }
  }
  foreach ($duplicate in @($owned | Group-Object | Where-Object Count -gt 1)) { $issues.Add("Duplicate primary ownership: $($duplicate.Name)") }

  $required = @('Purpose:','Owned files:','Owned responsibilities:','May write:','May read:','Public interfaces:','Allowed dependencies:','Forbidden dependencies:','Last verified:')
  $blocks = [regex]::Split($governance, '(?m)(?=^## Module: )') | Where-Object { $_ -match '^## Module:' }
  foreach ($block in $blocks) {
    $name = ([regex]::Match($block, '^## Module: ([^\r\n]+)')).Groups[1].Value
    foreach ($field in $required) { if ($block -notmatch [regex]::Escape($field)) { $issues.Add("Module $name missing $field") } }
  }

  $api = Get-Content -LiteralPath $apiPath -Raw -Encoding UTF8
  foreach ($field in @('Level','Parameters / return','Errors','Side effects','Callers','Contract test / compatibility')) { if ($api -notmatch [regex]::Escape($field)) { $issues.Add("MODULE_API missing field: $field") } }
  if ($api -match '\| Stable \|' -and $api -notmatch 'Contract test') { $issues.Add('Stable API lacks contract test record') }
  if (!(Test-Path -LiteralPath $dependencyPath) -or (Get-Content -LiteralPath $dependencyPath -Raw -Encoding UTF8) -notmatch 'No known cycle') { $issues.Add('DEPENDENCY_GRAPH does not record cycle result') }
  if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'src/js')) { $issues.Add('Legacy src/js directory still exists') }
  if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'src/modules')) { $issues.Add('Legacy src/modules directory still exists') }
}

if ($issues.Count) {
  'FAIL'
  $issues | ForEach-Object { "- $_" }
  exit 1
}
'PASS'
"Sources: $($sources.Count)"
"Modules: $($blocks.Count)"
exit 0
