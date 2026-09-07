$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$orderFile = Join-Path $projectRoot 'SOURCE_ORDER.txt'
$outputDirectory = Join-Path $projectRoot 'build'
$outputFile = Join-Path $outputDirectory 'app.js'

if (-not (Test-Path -LiteralPath $orderFile)) {
  throw "Missing build order file: $orderFile"
}

$sourceFiles = [System.IO.File]::ReadAllLines($orderFile, [System.Text.Encoding]::UTF8) |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and -not $_.StartsWith('#') }

if ($sourceFiles.Count -eq 0) {
  throw 'SOURCE_ORDER.txt does not contain any source files.'
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$stream = [System.IO.FileStream]::new($outputFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  foreach ($relativePath in $sourceFiles) {
    $sourcePath = Join-Path $projectRoot ($relativePath -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "Missing source fragment: $relativePath"
    }
    $bytes = [System.IO.File]::ReadAllBytes($sourcePath)
    $stream.Write($bytes, 0, $bytes.Length)
  }
}
finally {
  $stream.Dispose()
}

$buildHash = (Get-FileHash -LiteralPath $outputFile -Algorithm SHA256).Hash
Write-Output "Built $outputFile"
Write-Output "SHA256 $buildHash"
