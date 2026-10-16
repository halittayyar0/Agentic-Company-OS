# CI-only proof of the supported ordinary Windows user contract. Never run on
# an operator's workstation. Passwords exist only in this process's memory.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_RUN_ID -notmatch '^\d+$') {
    throw 'windows_native_fixture_requires_github_windows_runner'
}
if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) {
    throw 'windows_native_fixture_requires_64bit_windows_powershell'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'windows_native_fixture_requires_disposable_runner_administrator'
}

function Get-CiFullPath([object]$Candidate, [string]$Category) {
    # Do not stringify an application array into one path, or print its values.
    if ($Candidate -isnot [string] -or [string]::IsNullOrWhiteSpace($Candidate)) {
        throw ('windows_native_fixture_path_invalid:' + $Category)
    }
    try {
        if ($Candidate -notmatch '^[a-zA-Z]:[\\/]') { throw 'not_absolute' }
        return [IO.Path]::GetFullPath($Candidate)
    } catch { throw ('windows_native_fixture_path_invalid:' + $Category) }
}

function Get-CiApplicationPath([string]$Name, [string]$Category) {
    try {
        # Get-Command can enumerate several PATH entries even without -All.
        $application = Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
    } catch { throw ('windows_native_fixture_application_missing:' + $Category) }
    if (-not $application) { throw ('windows_native_fixture_application_missing:' + $Category) }
    return Get-CiFullPath $application.Source $Category
}

$workspace = Get-CiFullPath $env:GITHUB_WORKSPACE 'workspace'
$runnerTemp = Get-CiFullPath $env:RUNNER_TEMP 'runner_temp'
$toolCache = Get-CiFullPath $env:RUNNER_TOOL_CACHE 'tool_cache'
$archive = Get-CiFullPath $env:NATIVE_PACKAGE_ARCHIVE 'archive'
$evidence = Get-CiFullPath $env:NATIVE_PACKAGE_EVIDENCE 'evidence'
$systemPowerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$node = Get-CiApplicationPath 'node.exe' 'node'
$accessSection = [System.Security.AccessControl.AccessControlSections]::Access
$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')

function Assert-CiPath([object]$Candidate, [object[]]$Roots, [string]$Category) {
    $full = Get-CiFullPath $Candidate $Category
    foreach ($root in $Roots) {
        $prefix = (Get-CiFullPath $root ($Category + '_root')).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        if ($full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return }
    }
    throw ('windows_native_fixture_path_outside_ci_directory:' + $Category)
}
Assert-CiPath $workspace @($env:RUNNER_WORKSPACE) 'workspace'
Assert-CiPath $archive @($runnerTemp) 'archive'
Assert-CiPath $evidence @($runnerTemp) 'evidence'
Assert-CiPath $node @($toolCache) 'node'
if (-not (Test-Path -LiteralPath $archive -PathType Leaf) -or (Test-Path -LiteralPath $evidence)) {
    throw 'windows_native_fixture_archive_or_evidence_invalid'
}
if (-not (Test-Path -LiteralPath (Join-Path $workspace 'node_modules/tsx/dist/loader.mjs') -PathType Leaf)) {
    throw 'windows_native_fixture_tsx_loader_missing'
}
$pythonInfo = & $env:PYTHON -c 'import json,sys; print(json.dumps(dict(executable=sys._base_executable,prefix=sys.base_prefix)))'
if ($LASTEXITCODE -ne 0) { throw 'windows_native_fixture_python_lookup_failed' }
try { $pythonInfo = $pythonInfo | ConvertFrom-Json } catch { throw 'windows_native_fixture_python_lookup_invalid' }
Assert-CiPath $pythonInfo.executable @($toolCache) 'python_executable'
Assert-CiPath $pythonInfo.prefix @($toolCache) 'python_prefix'
$secondaryLogon = Get-CimInstance Win32_Service -Filter "Name='seclogon'"
if (-not $secondaryLogon -or $secondaryLogon.StartMode -eq 'Disabled') {
    throw 'windows_native_fixture_secondary_logon_unavailable'
}

$fixture = Join-Path $runnerTemp ('acos-native-user-' + [Guid]::NewGuid().ToString('N'))
$name = 'acos-ci-' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
$account = $null
$credential = $null
$securePassword = $null
$process = $null
$grants = [Collections.Generic.List[object]]::new()
$phase = 'create_fixture'
$result = [ordered]@{
    schemaVersion = 1
    executionContext = 'temporary ordinary Windows user'
    accepted = $false
    cleanupVerified = $false
    timedOut = $false
    smokeExitCode = $null
    processCreated = $false
    contextParsed = $false
    ordinaryUserVerified = $false
    secondaryLogonStartMode = $secondaryLogon.StartMode
}

function Grant-CiRead([string]$Target, [bool]$Directory, $Sid) {
    $item = Get-Item -LiteralPath $Target
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'windows_native_fixture_read_target_redirected'
    }
    $acl = if ($Directory) { [IO.Directory]::GetAccessControl($Target, $accessSection) } else { [IO.File]::GetAccessControl($Target, $accessSection) }
    $grants.Add(@{ path = $Target; directory = $Directory; access = $acl.GetSecurityDescriptorSddlForm($accessSection) })
    $rule = if ($Directory) {
        [System.Security.AccessControl.FileSystemAccessRule]::new($Sid, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    } else { [System.Security.AccessControl.FileSystemAccessRule]::new($Sid, 'ReadAndExecute', 'Allow') }
    $acl.AddAccessRule($rule)
    if ($Directory) { [IO.Directory]::SetAccessControl($Target, $acl) } else { [IO.File]::SetAccessControl($Target, $acl) }
}

function Get-FixtureProcesses($Sid) {
    foreach ($candidate in Get-CimInstance Win32_Process) {
        # A process can exit during enumeration. Never infer ownership from its name.
        $owner = Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid -ErrorAction SilentlyContinue
        if ($owner -and $owner.ReturnValue -eq 0 -and $owner.Sid -eq $Sid.Value) { $candidate }
    }
}

function Get-CiExceptionDiagnostics([Exception]$Exception) {
    # Exception messages, ErrorRecords and stack traces can contain credentials
    # or private paths. Retain only bounded, typed numeric launch diagnostics.
    $current = $Exception
    for ($depth = 0; $current -and $depth -lt 5; $depth++) {
        $entry = [ordered]@{
            exceptionType = $current.GetType().FullName
            hresult = [int]$current.HResult
        }
        if ($current -is [ComponentModel.Win32Exception]) {
            $entry.nativeErrorCode = [int]$current.NativeErrorCode
        }
        [pscustomobject]$entry
        $current = $current.InnerException
    }
}

try {
    $null = New-Item -ItemType Directory -Path $fixture
    $phase = 'create_account'
    $bytes = New-Object byte[] 48
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $securePassword = ConvertTo-SecureString ([Convert]::ToBase64String($bytes) + '!aA9') -AsPlainText -Force
    [Array]::Clear($bytes, 0, $bytes.Length)
    $account = New-LocalUser -Name $name -Password $securePassword -AccountNeverExpires -PasswordNeverExpires -Description 'Disposable native-package CI fixture'
    $users = Get-LocalGroup -SID ([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'))
    if (-not (Get-LocalGroupMember -Group $users | Where-Object { $_.SID.Value -eq $account.SID.Value })) {
        Add-LocalGroupMember -Group $users -Member $account
    }
    if (Get-LocalGroupMember -SID $administrators | Where-Object { $_.SID.Value -eq $account.SID.Value }) {
        throw 'windows_native_fixture_account_is_administrator'
    }
    $credential = [Management.Automation.PSCredential]::new(($env:COMPUTERNAME + '\' + $name), $securePassword)

    $phase = 'prepare_private_fixture'
    $acl = [IO.Directory]::GetAccessControl($fixture, $accessSection)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) { $acl.RemoveAccessRuleSpecific($rule) }
    foreach ($sid in @($account.SID, $administrators, $system)) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    [IO.Directory]::SetAccessControl($fixture, $acl)
    foreach ($directory in @('profile', 'profile/AppData/Roaming', 'profile/AppData/Local', 'temp')) {
        $null = New-Item -ItemType Directory -Path (Join-Path $fixture $directory) -Force
    }
    $phase = 'grant_ci_inputs'
    Grant-CiRead $workspace $true $account.SID
    Grant-CiRead $node $false $account.SID
    Grant-CiRead $pythonInfo.prefix $true $account.SID
    Grant-CiRead $archive $false $account.SID

    $env:ACOS_NATIVE_CI_WORKSPACE = $workspace
    $env:ACOS_NATIVE_CI_NODE = $node
    $env:ACOS_NATIVE_CI_PYTHON = $pythonInfo.executable
    $env:ACOS_NATIVE_CI_ARCHIVE = $archive
    $env:ACOS_NATIVE_CI_FIXTURE = $fixture
    $env:ACOS_NATIVE_CI_SID = $account.SID.Value
    $childScript = @'
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'not_ci' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if ($identity.User.Value -ne $env:ACOS_NATIVE_CI_SID -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'wrong_token' }
    $workspace = $env:ACOS_NATIVE_CI_WORKSPACE
    $node = $env:ACOS_NATIVE_CI_NODE
    $python = $env:ACOS_NATIVE_CI_PYTHON
    $archive = $env:ACOS_NATIVE_CI_ARCHIVE
    $fixture = $env:ACOS_NATIVE_CI_FIXTURE
    $keep = @{}
    foreach ($key in @('SystemRoot', 'SystemDrive', 'WINDIR', 'COMSPEC', 'COMPUTERNAME', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS')) {
        $keep[$key] = [Environment]::GetEnvironmentVariable($key)
    }
    foreach ($key in @([Environment]::GetEnvironmentVariables().Keys)) { [Environment]::SetEnvironmentVariable($key, $null) }
    foreach ($key in $keep.Keys) { [Environment]::SetEnvironmentVariable($key, $keep[$key]) }
    $env:CI = 'true'
    $env:PYTHON = $python
    $env:TEMP = Join-Path $fixture 'temp'
    $env:TMP = $env:TEMP
    $env:USERPROFILE = Join-Path $fixture 'profile'
    $env:HOME = $env:USERPROFILE
    $env:APPDATA = Join-Path $env:USERPROFILE 'AppData/Roaming'
    $env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData/Local'
    $env:PATH = Join-Path $env:SystemRoot 'System32'
    [IO.File]::WriteAllText((Join-Path $fixture 'execution-context.json'), '{"administratorToken":false,"identityVerified":true}', [Text.UTF8Encoding]::new($false))
    Set-Location -LiteralPath $workspace
    & $node --import ./node_modules/tsx/dist/loader.mjs scripts/src/setup/native-package-smoke.ts --archive $archive --evidence (Join-Path $fixture 'evidence.json')
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('ordinary_user_native_fixture_failed')
    exit 1
}
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
    $phase = 'launch_ordinary_user'
    # Start-Process inherits process environment; paths never enter source text.
    # Alternate credentials require Secondary Logon and a loadable user profile.
    $process = Start-Process -FilePath $systemPowerShell -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -Credential $credential -LoadUserProfile -WindowStyle Hidden -WorkingDirectory $workspace -RedirectStandardOutput (Join-Path $fixture 'private-stdout.log') -RedirectStandardError (Join-Path $fixture 'private-stderr.log') -PassThru
    $result.processCreated = $true
    $phase = 'archive_acceptance'
    if (-not $process.WaitForExit(18 * 60 * 1000)) {
        $result.timedOut = $true
        throw 'windows_native_fixture_timeout'
    }
    $process.Refresh()
    $result.smokeExitCode = $process.ExitCode
    $context = Get-Content -LiteralPath (Join-Path $fixture 'execution-context.json') -Raw | ConvertFrom-Json
    $result.contextParsed = $true
    $result.ordinaryUserVerified = $context.administratorToken -eq $false -and $context.identityVerified -eq $true
    if (-not $result.ordinaryUserVerified -or $process.ExitCode -ne 0) {
        throw 'windows_native_fixture_smoke_failed'
    }
    $proof = Get-Content -LiteralPath (Join-Path $fixture 'evidence.json') -Raw | ConvertFrom-Json
    if ($proof.accepted -ne $true -or $proof.cleanupVerified -ne $true -or $proof.target -ne 'win32-x64') { throw 'windows_native_fixture_proof_failed' }
    $result.accepted = $true
} catch {
    # Raw launch logs stay in the owned fixture: they may contain setup URLs.
    $result.failurePhase = $phase
    $result.failureDiagnostics = @(Get-CiExceptionDiagnostics $_.Exception)
} finally {
    $cleanupOkay = $true
    if ($account) {
        try {
            $deadline = [DateTime]::UtcNow.AddSeconds(20)
            do {
                $owned = @(Get-FixtureProcesses $account.SID)
                foreach ($candidate in $owned) { Stop-Process -Id $candidate.ProcessId -Force -ErrorAction SilentlyContinue }
                if ($owned.Count -eq 0) { break }
                Start-Sleep -Milliseconds 200
            } while ([DateTime]::UtcNow -lt $deadline)
            if (@(Get-FixtureProcesses $account.SID).Count -ne 0) { throw 'owned_process_remains' }
        } catch { $cleanupOkay = $false }
    }
    try {
        $privateProof = Join-Path $fixture 'evidence.json'
        if (Test-Path -LiteralPath $privateProof -PathType Leaf) {
            $item = Get-Item -LiteralPath $privateProof
            if ($item.Length -gt 1048576 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'invalid_proof_file' }
            [IO.File]::WriteAllBytes($evidence, [IO.File]::ReadAllBytes($privateProof))
        }
    } catch { $result.accepted = $false; $result.proofCopyFailed = $true }
    foreach ($grant in $grants) {
        try {
            $acl = if ($grant.directory) { [IO.Directory]::GetAccessControl($grant.path, $accessSection) } else { [IO.File]::GetAccessControl($grant.path, $accessSection) }
            $acl.SetSecurityDescriptorSddlForm($grant.access, $accessSection)
            if ($grant.directory) { [IO.Directory]::SetAccessControl($grant.path, $acl) } else { [IO.File]::SetAccessControl($grant.path, $acl) }
        } catch { $cleanupOkay = $false }
    }
    if ($account) {
        try {
            $existing = Get-LocalUser -Name $name
            if ($existing.SID.Value -ne $account.SID.Value) { throw 'account_identity_changed' }
            Remove-LocalUser -SID $account.SID
            if (Get-LocalUser -SID $account.SID -ErrorAction SilentlyContinue) { throw 'account_remains' }
        } catch { $cleanupOkay = $false }
    }
    if ($securePassword) { $securePassword.Dispose() }
    $credential = $null
    foreach ($key in @('ACOS_NATIVE_CI_WORKSPACE', 'ACOS_NATIVE_CI_NODE', 'ACOS_NATIVE_CI_PYTHON', 'ACOS_NATIVE_CI_ARCHIVE', 'ACOS_NATIVE_CI_FIXTURE', 'ACOS_NATIVE_CI_SID')) { [Environment]::SetEnvironmentVariable($key, $null) }
    $result.cleanupVerified = $cleanupOkay
    if (-not $cleanupOkay) { $result.accepted = $false }
    $summary = $result | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText(($evidence + '.windows-fixture.json'), $summary + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    [Console]::WriteLine($summary)
}
if (-not $result.accepted) { exit 1 }
