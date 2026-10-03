$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packages = @(Get-ChildItem release/store/*.appx)
if ($packages.Count -ne 1) { throw 'Expected exactly one Store package.' }
$package = $packages[0]
$archive = [IO.Compression.ZipFile]::OpenRead($package.FullName)
$preparation = $env:STORE_PREPARATION -eq 'true'
$expectedName = if ($preparation) { 'Webdesign29.CaisseBZH.Preparation' } else { $env:STORE_IDENTITY_NAME.Trim() }
$expectedPublisher = if ($preparation) { 'CN=Webdesign29-Preparation' } else { $env:STORE_PUBLISHER.Trim() }
$metadata = Get-Content package.json -Raw | ConvertFrom-Json
$payload = Join-Path $env:RUNNER_TEMP 'store-payload.asar'
$nativeExecutable = Join-Path $env:RUNNER_TEMP 'store-executable.exe'
try {
  $entry = $archive.GetEntry('AppxManifest.xml')
  if (-not $entry) { throw 'Missing AppxManifest.xml.' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $manifestText = $reader.ReadToEnd() } finally { $reader.Dispose() }
  [xml]$manifest = $manifestText
  $identity = $manifest.Package.Identity
  if ($identity.GetAttribute('Name') -cne $expectedName -or $identity.GetAttribute('Publisher') -cne $expectedPublisher) { throw 'Package identity differs from the requested identity.' }
  if ($identity.ProcessorArchitecture -ne 'x64') { throw 'Expected x64 package.' }
  if ($identity.Version -ne "$($metadata.version).0") { throw 'Store version must end in .0.' }
  if ($manifest.Package.Properties.PublisherDisplayName -ne 'Webdesign29') { throw 'Incorrect publisher display name.' }
  if (@($manifest.Package.Resources.Resource).Language -notcontains 'fr-FR') { throw 'Missing French package language.' }
  $application = $manifest.Package.Applications.Application
  if ($application.Id -ne 'CaisseBZH' -or $application.EntryPoint -ne 'Windows.FullTrustApplication') { throw 'Incorrect desktop entry point.' }
  $executable = $application.Executable.Replace('\', '/')
  if (-not $archive.GetEntry($executable)) { throw "Manifest executable is absent: $executable" }
  [IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry($executable), $nativeExecutable, $true)
  $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
  $manifestTool = Get-ChildItem "$sdk/*/x64/mt.exe" | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $manifestTool) { throw 'Windows SDK mt.exe is required to verify the executable manifest.' }
  & $manifestTool.FullName -nologo "-inputresource:$nativeExecutable;#1" '-out:release/store/executable-manifest.xml'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the executable manifest.' }
  [xml]$executableManifest = Get-Content release/store/executable-manifest.xml -Raw
  $dpi = $executableManifest.SelectSingleNode("//*[local-name()='dpiAwareness']")
  if (-not $dpi -or $dpi.InnerText -ne 'PerMonitorV2, PerMonitor') { throw 'Modern per-monitor DPI declaration missing.' }
  $capabilities = @($manifest.Package.Capabilities.ChildNodes | Where-Object NodeType -eq Element)
  if ($capabilities.Count -ne 1 -or $capabilities[0].GetAttribute('Name') -ne 'runFullTrust') { throw 'Unexpected package capabilities.' }
  if ($manifestText -match 'windows.startupTask') { throw 'Unsupported startup task declared.' }
  foreach ($asset in @('StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png', 'Wide310x150Logo.png')) {
    if (-not $archive.GetEntry("assets/$asset")) { throw "Missing branded asset: $asset" }
  }
  if (-not $archive.GetEntry('AppxBlockMap.xml')) { throw 'Missing package block map.' }
  foreach ($file in $archive.Entries) {
    if ($file.FullName -match '(^|/)app-update\.yml$|\.(p12|pfx|pem|key|password|jks)$') { throw "Unexpected update feed or credential: $($file.FullName)" }
  }
  $asarEntry = $archive.GetEntry('app/resources/app.asar')
  if (-not $asarEntry) { throw 'Missing application payload.' }
  [IO.Compression.ZipFileExtensions]::ExtractToFile($asarEntry, $payload, $true)
  node scripts/validate-store-payload.cjs $payload
  if ($LASTEXITCODE -ne 0) { throw 'Application payload validation failed.' }
  $manifestText | Set-Content release/store/AppxManifest.xml -Encoding utf8
} finally {
  $archive.Dispose()
  Remove-Item $payload -ErrorAction SilentlyContinue
  Remove-Item $nativeExecutable -ErrorAction SilentlyContinue
}
$report = [ordered]@{
  package = $package.Name
  bytes = $package.Length
  sha256 = (Get-FileHash $package.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  identity = $expectedName
  publisher = $expectedPublisher
  version = "$($metadata.version).0"
  architecture = 'x64'
  preparation = $preparation
  validation = 'MakeAppx schema and package payload checks passed'
  certification = 'Microsoft Store certification and installed-package acceptance testing not yet performed'
  submission = if ($preparation) { 'Blocked: replace provisional identity with the exact Partner Center identity before submission' } else { 'Ready for installed-package testing and Partner Center submission; not yet certified' }
}
$report | ConvertTo-Json | Set-Content release/store/package-validation.json -Encoding utf8
$report | ConvertTo-Json
if ($env:GITHUB_STEP_SUMMARY) {
  "## Microsoft Store package`n`n$($report.submission).`n`nPackage: $($package.Name)`n`nSHA-256: $($report.sha256)`n`n$($report.certification)." | Out-File $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
}
