param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($Destination)
$parent = [System.IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if (-not $root.StartsWith($parent, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Owned runner input directory required' }
if (Test-Path -LiteralPath $root) { throw 'Fresh runtime input directory required' }
New-Item -ItemType Directory -Path $root | Out-Null
Set-Content -LiteralPath (Join-Path $root '.owned-real-first-task-inputs') -Value 'Pinned synthetic first-task inputs' -Encoding utf8
$inputs = @(
  @{Name='ollama';Url='https://github.com/ollama/ollama/releases/download/v0.40.3/ollama-windows-amd64.zip';Bytes=1468053171;Sha='e5ecff02dfc7cae8ddf6d6b7a7ac5f727ffeedf4491f44ae75ff5b0820dbbbd5'},
  @{Name='postgres';Url='https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip';Bytes=340719294;Sha='6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3'}
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($inputRuntime in $inputs) {
  $archive = Join-Path $root ($inputRuntime.Name + '.zip')
  & curl.exe --fail --location --max-time 900 --output $archive $inputRuntime.Url
  if ($LASTEXITCODE -ne 0) { throw 'Pinned runtime download failed' }
  if ((Get-Item -LiteralPath $archive).Length -ne $inputRuntime.Bytes) { throw 'Pinned runtime size mismatch' }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $inputRuntime.Sha) { throw 'Pinned runtime digest mismatch' }
  $outputRoot = Join-Path $root $inputRuntime.Name
  New-Item -ItemType Directory -Path $outputRoot | Out-Null
  $bundle = [System.IO.Compression.ZipFile]::OpenRead($archive)
  $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $extracted = 0
  try {
    foreach ($entry in $bundle.Entries) {
      $name = $entry.FullName
      if ($name -match '(^/|\\|:|(^|/)\.\.(/|$))' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe pinned archive entry' }
      if ($name.EndsWith('/')) { continue }
      $selected = if ($inputRuntime.Name -eq 'ollama') { $name -ceq 'ollama.exe' -or $name -cmatch '^lib/ollama/[A-Za-z0-9+_.-]+$' } else { $name -cmatch '^pgsql/(bin|lib|share)/' }
      if (-not $selected) { continue }
      if (-not $names.Add($name)) { throw 'Duplicate runtime entry' }
      $file = [System.IO.Path]::GetFullPath((Join-Path $outputRoot $name))
      if (-not $file.StartsWith($outputRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime extraction escaped owned root' }
      [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($file)) | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $file, $false)
      $extracted++
    }
  } finally { $bundle.Dispose() }
  $expected = if ($inputRuntime.Name -eq 'ollama') { 44 } else { 1563 }
  if ($extracted -ne $expected) { throw 'Pinned runtime file census mismatch' }
  Write-Output ($inputRuntime.Name + ': verified complete archive and extracted ' + $extracted + ' runtime files')
}
$pgVersion = & (Join-Path $root 'postgres\pgsql\bin\postgres.exe') --version
if ($LASTEXITCODE -ne 0 -or $pgVersion -notmatch '17\.11$') { throw 'Pinned PostgreSQL version mismatch' }
