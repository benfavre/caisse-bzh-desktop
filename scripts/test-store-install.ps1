# Run only on an isolated Windows test machine/runner. The certificate and signed
# copy are temporary; the unsigned Store submission artifact is never modified.
$ErrorActionPreference = 'Stop'
if ($env:STORE_PREPARATION -ne 'true') { throw 'Use a preparation build for the isolated installation test.' }
$reportPath = 'release/store/package-validation.json'
$report = Get-Content $reportPath -Raw | ConvertFrom-Json
$testPackage = Join-Path $env:RUNNER_TEMP 'caisse-store-install-test.appx'
$publicCertificate = Join-Path $env:RUNNER_TEMP 'caisse-store-install-test.cer'
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
$signTool = Get-ChildItem "$sdk/bin/*/x64/signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signTool) { throw 'Windows SDK SignTool is required for the installation test.' }
$certificate = $null
$installed = $null
$report | Add-Member -NotePropertyName installedPackage -NotePropertyValue 'not-run'
$report | Add-Member -NotePropertyName installedLaunch -NotePropertyValue 'not-run'
try {
  Copy-Item "release/store/$($report.package)" $testPackage
  $certificate = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -Subject $report.publisher -CertStoreLocation 'Cert:/CurrentUser/My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') -FriendlyName 'caisse.bzh isolated CI test' -NotAfter (Get-Date).AddDays(1)
  Export-Certificate -Cert $certificate -FilePath $publicCertificate | Out-Null
  Import-Certificate -CertStoreLocation 'Cert:/LocalMachine/TrustedPeople' -FilePath $publicCertificate | Out-Null
  & $signTool.FullName sign /fd SHA256 /sha1 $certificate.Thumbprint /s My $testPackage
  if ($LASTEXITCODE -ne 0) { throw 'Could not sign the isolated test copy.' }
  Add-AppxPackage -Path $testPackage
  $installed = Get-AppxPackage -Name $report.identity
  if (-not $installed -or $installed.Status -ne 'Ok') { throw 'Installed package registration is not healthy.' }
  $report.installedPackage = 'passed: temporary signed copy installed and registered successfully'
  $sessionId = (Get-Process -Id $PID).SessionId
  if ($sessionId -eq 0) {
    $report.installedLaunch = 'not-run: runner has no active desktop session'
  } else {
    Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$($installed.PackageFamilyName)!CaisseBZH"
    $deadline = (Get-Date).AddSeconds(45)
    $window = $null
    do {
      Start-Sleep -Seconds 2
      $window = Get-Process -Name 'caisse.bzh' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installed.InstallLocation, [StringComparison]::OrdinalIgnoreCase) -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    } while (-not $window -and (Get-Date) -lt $deadline)
    if (-not $window) { throw 'Installed package did not create an application window.' }
    Start-Sleep -Seconds 5
    if ($window.HasExited) { throw 'Installed package exited immediately after launch.' }
    $report.installedLaunch = 'passed: package activation created a persistent application window'
  }
  $kit = Join-Path $sdk 'App Certification Kit/appcert.exe'
  if ($env:STORE_RUN_WACK -eq 'true' -and (Test-Path $kit) -and $sessionId -ne 0) {
    Get-Process -Name 'caisse.bzh' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installed.InstallLocation, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
    & $kit reset
    $wackPath = Join-Path (Resolve-Path 'release/store') 'wack-report.xml'
    $wack = Start-Process $kit -ArgumentList "test -packagefullname $($installed.PackageFullName) -reportoutputpath `"$wackPath`"" -PassThru
    if (-not $wack.WaitForExit(480000)) {
      Stop-Process -Id $wack.Id -Force
      throw 'Windows App Certification Kit exceeded eight minutes.'
    }
    if (-not (Test-Path $wackPath)) { throw 'Windows App Certification Kit produced no report.' }
    [xml]$wackReport = Get-Content $wackPath -Raw
    $results = @($wackReport.SelectNodes('//TEST') | ForEach-Object {
      [ordered]@{ name = $_.GetAttribute('NAME'); optional = $_.GetAttribute('OPTIONAL'); result = $_.SelectSingleNode('RESULT').InnerText }
    })
    $overall = $wackReport.DocumentElement.GetAttribute('OVERALL_RESULT')
    $report | Add-Member -NotePropertyName wack -NotePropertyValue ([ordered]@{ overall = $overall; tests = $results })
    $report.certification = "Windows App Certification Kit: $overall (exit $($wack.ExitCode)). Inspect warnings and optional failures; Microsoft Store certification is still pending."
    if (@($results | Where-Object { $_.optional -eq 'FALSE' -and $_.result -eq 'FAIL' }).Count -gt 0) { throw 'A required Windows App Certification Kit test failed.' }
  } else {
    $report.certification = 'Windows App Certification Kit not run: not requested or kit/interactive session unavailable; Microsoft Store certification pending'
  }
} catch {
  $report | Add-Member -NotePropertyName installationTestError -NotePropertyValue $_.Exception.Message -Force
  throw
} finally {
  if ($installed) {
    Get-Process -Name 'caisse.bzh' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installed.InstallLocation, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-AppxPackage -Package $installed.PackageFullName -ErrorAction Continue
  }
  if ($certificate) {
    Remove-Item "Cert:/CurrentUser/My/$($certificate.Thumbprint)" -ErrorAction SilentlyContinue
    Remove-Item "Cert:/LocalMachine/TrustedPeople/$($certificate.Thumbprint)" -ErrorAction SilentlyContinue
  }
  Remove-Item $testPackage, $publicCertificate -ErrorAction SilentlyContinue
  $report | ConvertTo-Json | Set-Content $reportPath -Encoding utf8
  $report | ConvertTo-Json
  if ($env:GITHUB_STEP_SUMMARY) {
    "`nInstalled package: $($report.installedPackage).`n`nLaunch: $($report.installedLaunch).`n`n$($report.certification)." | Out-File $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
  }
}
