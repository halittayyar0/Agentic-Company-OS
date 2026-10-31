import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const inspected =
  "4a7d165fe7391ba08d597dabd23e0320fa42bf53c562f6dabdfd680c7b32d595";

/** Extend the existing CI-only ordinary account fixture, never product setup. */
export function deriveOrdinaryWindowsWrapper(text) {
  let source = text.replaceAll("\r\n", "\n");
  assert.equal(hash(source), inspected, "inspected_windows_wrapper_required");
  const changes = [];
  const replace = (before, after, label) => {
    assert.equal(
      source.split(before).length - 1,
      1,
      "unique_windows_fixture_anchor_required:" + label,
    );
    source = source.replace(before, after);
    changes.push(label);
  };
  replace(
    "$workspace = Get-CiFullPath $env:GITHUB_WORKSPACE 'workspace'",
    "$workspace = Get-CiFullPath $env:ACOS_APPLICATION_ROOT 'workspace'",
    "actual_application_checkout",
  );
  replace(
    "$evidence = Get-CiFullPath $env:NATIVE_PACKAGE_EVIDENCE 'evidence'",
    [
      "$evidence = Get-CiFullPath $env:NATIVE_PACKAGE_EVIDENCE 'evidence'",
      "$driverRoot = Get-CiFullPath $env:ACOS_DRIVER_ROOT 'driver'",
      "$inputRoot = Get-CiFullPath $env:ACOS_RELEASE_INPUT_ROOT 'release_inputs'",
      "$browserRoot = Get-CiFullPath $env:PLAYWRIGHT_BROWSERS_PATH 'browser'",
      "$git = Get-CiApplicationPath 'git.exe' 'git'",
      "$gitRoot = Split-Path (Split-Path $git -Parent) -Parent",
      "$publicRoot = [IO.Path]::GetDirectoryName($evidence)",
    ].join("\n"),
    "explicit_readonly_sources_and_public_output",
  );
  replace(
    "Assert-CiPath $node @($toolCache) 'node'",
    [
      "Assert-CiPath $node @($toolCache) 'node'",
      "Assert-CiPath $driverRoot @($env:RUNNER_WORKSPACE) 'driver'",
      "Assert-CiPath $inputRoot @($runnerTemp) 'release_inputs'",
      "Assert-CiPath $browserRoot @($runnerTemp) 'browser'",
      "Assert-CiPath $git @($env:ProgramFiles) 'git'",
      "Assert-CiPath $publicRoot @($runnerTemp) 'public_output'",
      "if ((Split-Path $inputRoot -Leaf) -notlike 'acos-native-release-host-*') { throw 'invalid_owned_release_input_root' }",
      "if ((Get-Content -LiteralPath (Join-Path $inputRoot '.owned-native-release-host') -Raw).Trim() -cne 'Private synthetic native release proof') { throw 'owned_release_input_marker_required' }",
      "if ((Split-Path $publicRoot -Leaf) -cne 'native-release-host-public' -or @(Get-ChildItem -LiteralPath $publicRoot -Force).Count -ne 0) { throw 'fresh_explicit_public_root_required' }",
      "$releaseContextFile = Get-Item -LiteralPath (Join-Path $inputRoot 'context.json')",
      "if ($releaseContextFile.Length -gt 1048576 -or ($releaseContextFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'release_context_invalid' }",
      "$releaseContext = Get-Content -LiteralPath $releaseContextFile.FullName -Raw | ConvertFrom-Json",
      "if ($releaseContext.schema -cne 'native-release-host-private-inputs@1' -or $releaseContext.accepted -ne $true -or $releaseContext.identity.driverCommit -cne $env:GITHUB_SHA) { throw 'release_context_identity_invalid' }",
      "if ($env:GITHUB_RUN_ATTEMPT -cne '1' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or $env:GITHUB_REF -notmatch '^refs/heads/codex/') { throw 'original_explicit_external_workflow_required' }",
    ].join("\n"),
    "source_and_output_boundaries_before_account_creation",
  );
  replace(
    "function Grant-CiRead([string]$Target, [bool]$Directory, $Sid) {",
    "function Grant-CiRead([string]$Target, [bool]$Directory, $Sid, [bool]$Writable = $false) {",
    "allow_only_declared_public_output_write_grant",
  );
  replace(
    "    $rule = if ($Directory) {",
    [
      "    $rights = if ($Writable) { 'FullControl' } else { 'ReadAndExecute' }",
      "    $rule = if ($Directory) {",
    ].join("\n"),
    "separate_read_and_public_write_rights",
  );
  assert.equal(source.split("'ReadAndExecute'").length - 1, 3);
  // Keep the rights initializer literal; replace exactly the two ACL constructors.
  source = source.replace(
    "::new($Sid, 'ReadAndExecute', 'ContainerInherit,ObjectInherit'",
    "::new($Sid, $rights, 'ContainerInherit,ObjectInherit'",
  );
  source = source.replace(
    "::new($Sid, 'ReadAndExecute', 'Allow')",
    "::new($Sid, $rights, 'Allow')",
  );
  changes.push("retain_source_readonly_and_scope_public_write_acl");
  replace(
    "    Grant-CiRead $archive $false $account.SID",
    [
      "    Grant-CiRead $archive $false $account.SID",
      "    Grant-CiRead $driverRoot $true $account.SID",
      "    Grant-CiRead $inputRoot $true $account.SID",
      "    Grant-CiRead $browserRoot $true $account.SID",
      "    Grant-CiRead $gitRoot $true $account.SID",
      "    Grant-CiRead $publicRoot $true $account.SID $true",
      "    $phase = 'deny_control_mutation'",
      "    . ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $workspace '.tmp/native-release-host/windows-acl.ps1'))))",
      "    Assert-DisposableReadonlyAclHost",
      "    $readonlyRoots = @($workspace, $driverRoot, $inputRoot, $browserRoot, (Split-Path $node -Parent), $pythonInfo.prefix, $gitRoot)",
      "    $aclBackupRoot = Join-Path $runnerTemp ('acos-native-acl-' + [Guid]::NewGuid().ToString('N'))",
      "    $null = New-Item -ItemType Directory -Path $aclBackupRoot",
      "    $backupAcl = [IO.Directory]::GetAccessControl($aclBackupRoot, $accessSection)",
      "    $backupAcl.SetAccessRuleProtection($true, $false)",
      "    foreach ($rule in $backupAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) { $backupAcl.RemoveAccessRuleSpecific($rule) }",
      "    foreach ($sid in @($administrators, $system)) { $backupAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')) }",
      "    [IO.Directory]::SetAccessControl($aclBackupRoot, $backupAcl)",
      "    $aclBackup = Join-Path $aclBackupRoot 'controls.bin'",
      "    $protectedControlCount = [NativeReleaseReadonlyAcl]::Protect($readonlyRoots, $account.SID.Value, $aclBackup)",
      "    $protectedJournalCount = [NativeReleaseReadonlyAcl]::JournalEntries",
    ].join("\n"),
    "read_inputs_without_granting_control_code_write_access",
  );
  replace(
    "$phase = 'create_fixture'",
    [
      "$phase = 'create_fixture'",
      "$aclBackup = $null",
      "$protectedControlCount = $null",
      "$protectedJournalCount = $null",
    ].join("\n"),
    "parent_only_acl_journal_state",
  );
  replace(
    "    $env:PATH = Join-Path $env:SystemRoot 'System32'",
    [
      "    $env:PATH = Join-Path $env:SystemRoot 'System32'",
      "    $env:GITHUB_ACTIONS = $i.githubActions",
      "    $env:RUNNER_OS = $i.runnerOs",
      "    $env:RUNNER_TEMP = $i.runnerTemp",
      "    $env:GITHUB_RUN_ID = $i.runId",
      "    $env:GITHUB_RUN_ATTEMPT = $i.runAttempt",
      "    $env:GITHUB_EVENT_NAME = $i.eventName",
      "    $env:GITHUB_REF = $i.ref",
      "    $env:GITHUB_SHA = $i.githubSha",
      "    $env:GITHUB_REPOSITORY = $i.repository",
      "    $env:GITHUB_REPOSITORY_ID = $i.repositoryId",
      "    $env:ACOS_GIT_EXECUTABLE = $i.git",
      "    $env:GIT_CONFIG_COUNT = '2'",
      "    $env:GIT_CONFIG_KEY_0 = 'safe.directory'",
      "    $env:GIT_CONFIG_VALUE_0 = $workspace",
      "    $env:GIT_CONFIG_KEY_1 = 'safe.directory'",
      "    $env:GIT_CONFIG_VALUE_1 = $i.driverRoot",
      "    $env:GIT_OPTIONAL_LOCKS = '0'",
      "    $env:PYTHONDONTWRITEBYTECODE = '1'",
      "    $env:PLAYWRIGHT_BROWSERS_PATH = $i.browserRoot",
      "    $env:ACOS_PRIVATE_EXECUTION_ROOT = $fixture",
      "    $env:ACOS_PRIVATE_EVIDENCE_PATH = Join-Path $fixture 'evidence.json'",
      "    $env:ACOS_PUBLIC_OUTPUT_ROOT = $i.publicRoot",
      "    $env:ACOS_EXECUTION_CONTEXT_PATH = Join-Path $fixture 'execution-context.json'",
    ].join("\n"),
    "restore_only_public_identity_and_owned_paths_after_environment_clear",
  );
  replace(
    "    [IO.File]::WriteAllText((Join-Path $fixture 'execution-context.json'), '{\"administratorToken\":false,\"identityVerified\":true}', [Text.UTF8Encoding]::new($false))",
    [
      "    . ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $workspace '.tmp/native-release-host/windows-acl.ps1'))))",
      "    $verifiedControlCount = [NativeReleaseReadonlyAcl]::Verify([string[]]$i.readonlyRoots)",
      "    if ($verifiedControlCount -ne $i.protectedControlCount -or $verifiedControlCount -lt 1) { throw 'effective_readonly_inventory_mismatch' }",
      '    [IO.File]::WriteAllText((Join-Path $fixture \'execution-context.json\'), \'{"administratorToken":false,"identityVerified":true,"readonlyControlsVerified":true}\', [Text.UTF8Encoding]::new($false))',
    ].join("\n"),
    "effective_access_of_actual_ordinary_token_before_execution",
  );
  replace(
    "    & $node --import ./node_modules/tsx/dist/loader.mjs scripts/src/setup/native-package-smoke.ts --archive $archive --evidence (Join-Path $fixture 'evidence.json')",
    "    & $node --import ./node_modules/tsx/dist/loader.mjs .tmp/native-release-host/run.mts",
    "complete_host_controller_under_ordinary_identity",
  );
  replace(
    "            fixture = $fixture",
    [
      "            fixture = $fixture",
      "            driverRoot = $driverRoot",
      "            browserRoot = $browserRoot",
      "            publicRoot = $publicRoot",
      "            git = $git",
      "            runnerTemp = $runnerTemp",
      "            githubSha = $env:GITHUB_SHA",
      "            repository = $env:GITHUB_REPOSITORY",
      "            repositoryId = $env:GITHUB_REPOSITORY_ID",
      "            runAttempt = $env:GITHUB_RUN_ATTEMPT",
      "            eventName = $env:GITHUB_EVENT_NAME",
      "            ref = $env:GITHUB_REF",
      "            readonlyRoots = $readonlyRoots",
      "            protectedControlCount = $protectedControlCount",
    ].join("\n"),
    "hash_bind_public_child_inputs_without_workflow_credentials",
  );
  replace(
    "    foreach ($grant in $grants) {",
    [
      "    if ($aclBackup -and (Test-Path -LiteralPath $aclBackup -PathType Leaf)) {",
      "        try {",
      "            $restoredControlCount = [NativeReleaseReadonlyAcl]::Restore($aclBackup)",
      "            if ($null -ne $protectedJournalCount -and $restoredControlCount -ne $protectedJournalCount) { throw 'readonly_acl_restore_inventory_mismatch' }",
      "        } catch { $cleanupOkay = $false }",
      "    }",
      "    for ($grantIndex = $grants.Count - 1; $grantIndex -ge 0; $grantIndex--) {",
      "        $grant = $grants[$grantIndex]",
    ].join("\n"),
    "restore_parent_only_recursive_journal_then_reverse_original_grants",
  );
  replace(
    "$result.ordinaryUserVerified = $context.administratorToken -eq $false -and $context.identityVerified -eq $true",
    "$result.ordinaryUserVerified = $context.administratorToken -eq $false -and $context.identityVerified -eq $true -and $context.readonlyControlsVerified -eq $true",
    "parent_requires_actual_effective_access_verification",
  );
  replace(
    "18 * 60 * 1000",
    "170 * 60 * 1000",
    "reserve_outer_time_for_two_unchanged_finite_model_cases_and_upgrade",
  );
  replace(
    "    $phase = 'archive_acceptance'",
    "    $phase = 'native_release_acceptance'",
    "accurate_composite_proof_phase",
  );
  replace(
    "    $result.accepted = $true",
    [
      "    if ($proof.applicationCommit -cne $releaseContext.config.applicationCommit -or $proof.applicationTree -cne $releaseContext.config.applicationTree -or $proof.driverCommit -cne $env:GITHUB_SHA) { throw 'public_proof_source_identity_mismatch' }",
      "    $result.accepted = $true",
    ].join("\n"),
    "bind_exported_proof_to_application_and_external_driver",
  );
  return {
    source,
    inputSha256: inspected,
    outputSha256: hash(source),
    changes,
  };
}
