# Windows private storage without interpreter startup

## Evidence and user value

Original PR100 head `984d977393f7ec666a2061a016678135cee1d015` failed Windows source job125369021993/run41467383011/attempt1:3134tests,3099pass,1fail,34existing skips. The first expired-session handoff reached `OwnerPrivateStorage.initialize` and failed before the PowerShell script's first marker. Process spawn took6ms; elapsed15888ms, killed; Node event-loop maximum66ms. The original raw log is retained privately, SHA256 `27f813fa6f0ce2d9dd2c0608ce672d3371fd67fe1c439e0bc7adefd7f7bf7f8b`.

Ten bounded local minimal/actual protection probes succeeded. An earlier separate Windows diagnostic also succeeded, with2282ms first readiness versus approximately170ms later. These observations do not establish why the original Windows interpreter failed to start. No OS/security setting, deadline, test assertion or original run has been changed to hide the failure.

The repair removes that external interpreter dependency from private storage checks and native ordinary-user admission. Users keep the same access restrictions and explicit recovery semantics; secret reads/writes no longer require a new PowerShell engine for each check. This also reduces ordinary Windows storage latency. The expired-credential test and its transactional guarantees remain intact.

## Chosen boundary

A small source-reviewed Windows x64 executable uses Win32 security APIs directly. A committed, hash-pinned executable and build manifest accompany its C source and deterministic build recipe. End users need no compiler, new runtime, account, service or privilege. The executable is unsigned, like the existing native package; no signing or broad OS exception is requested.

The shared loader resolves only the adjacent package asset, validates its regular-file identity and fixed digest, and never accepts an environment-supplied executable or a shell fallback. Source, API/worker/CLI bundles, native setup and the portable setup ZIP must all carry the asset wherever the shared library is bundled. Unix permission checks remain their existing implementation.

The storage invocation retains the15second timeout,16384byte output limit, owned-child cleanup and existing bounded timing schema. Paths remain in the child environment, not command text. The child receives only the environment it needs, emits the existing fixed readiness/success markers, and never reads record contents or prints paths/SIDs/raw helper errors.

The ordinary-user role query separately retains its existing10second/1024byte limit. API failure, malformed output or nonzero exit never becomes ordinary-user admission.

## Permission contract

- Query the current token user; never enable privileges or elevate. A separate read-only token-role mode retains ordinary/admin admission semantics.
- Inspect file/directory security through a handle. Reject reparse points, wrong object type, wrong owner, null/public DACL, non-allow ACEs, any SID except the current owner and SYSTEM, and owner grants that do not actually apply with full control. Directories require protected inheritance.
- Existing objects are verification-only. No ownership, DACL or inheritance repair is allowed.
- Only the caller's exclusively created empty object may be protected. Preserve the current Administrators-to-current-owner exception for newly created objects under an elevated token. Request owner-write access only when that transition is actually needed, preserving the Modify-parent scenario.
- Construct exactly owner/SYSTEM grants, then independently reread the postcondition. Keep identity stable across any handle reopening. No recursive ACL changes, user-folder changes or permissive fallback.
- Keep atomic temporary-file writes, record limits, exclusive locks, stale-lock behavior, realpath/link checks and removal of only an unchanged, still-empty failed new vault.

### Creation and executable authority

Directory initialization must not be a path-only `CREATE=1` repair. The native operation creates a new directory with an owner/SYSTEM protected descriptor at creation and receives its handle atomically. Use the documented `NtCreateFile` directory-create disposition/options with an admitted parent handle and one relative leaf; do not assume unsupported `OBJ_DONT_REPARSE` combinations. Verify the admitted parent's final path, retain the created handle for identity/empty-state/postcondition checks, and return bounded decimal device/inode identifiers. An existing directory is only opened read-only and validated, never repaired. A name collision is not authority to modify an existing object. Node validates the returned identity before continuing; failed cleanup still requires that identity and an empty directory.

New record and lock files already have exclusively created Node handles. Pass their bigint handle-stat identities to the native check; validate the same identity, zero length and object type before any ACL or optional owner change. Preserve identity through any handle reopening. The native checker rejects create/protect mode for pre-existing directories, so a replaced or populated directory cannot receive propagated ACL edits through a caller boolean.

Application/package files are the same owner-trusted code boundary as Node and the JavaScript bundles. A digest is not a claim of protection from a same-owner attacker able to replace application code. Still validate helper type/realpath/digest/identity on every invocation, including before/after reading, without cached success or path overrides. Use a static CRT and only reviewed Windows system DLLs; no current-directory/PATH DLL dependency or runtime compiler/download fallback.

The native manifest/required-file compatibility boundary must distinguish new packages from published0.5.9, which has no checker. Require the checker for new package production/validation while retaining unchanged legacy package inspection and the actual0.5.9 GUI upgrade path. Do not append it unconditionally to the existing unversioned `nativeRequiredFiles()` list.

## Build and verification

First demonstrate the existing checker fails when system PowerShell is unavailable while valid owner-protected storage should work. Preserve a real missing/corrupt-helper failure and explicit-retry cleanup test. Test the executable with actual Windows ACLs, both owner-write and Modify-parent cases, weakened/existing grants, redirected paths, current/incorrect owners and read-only token role. Native asset hash/type failures must stop before a child or secret write.

The explicit matrix includes null/empty/public/deny/callback/object/inherit-only/incomplete DACLs; inherited broad grants; UTF-16/spaced/supported long paths; changed identities and unexpected population; fixed protocol/exit/deadline/output failures; no protected callback after lock protection fails; no mutation of rejected existing objects; and relocation from unrelated working directories for source/API/worker/CLI/bootstrap/native-upgrade/stage-postgres bundles. Unix execution must not require the Windows asset.

Build with the already available Windows compiler. Preserve source/compiler/SDK/executable hashes and original build identity; compare deterministic rebuild bytes with the same toolchain. Review native security code and packaging boundaries independently before integration. Do not treat local or component success as original source/main/release acceptance.

After the actual repair commit: all original PR producers and exact platform source/UI expectations, ordinary protected merge, fresh actual-main qualification, five final archives, genuine archived Windows fresh plus published0.5.9 GUI upgrade, distribution and anonymous13asset readback remain mandatory. Rebind all temporary release consumers to the new head/tree/tested merge/main;984 is rejected and its passing Linux/macOS/package subsets are not transferable.

## Primary references

- [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo): handle-bound owner/DACL inspection, READ_CONTROL and LocalFree lifetime.
- [SetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo): handle-bound updates, inheritance propagation and null-DACL risk.
- [CheckTokenMembership](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-checktokenmembership): enabled group membership under the current effective token.

Routine implementation decisions are authorized by the user's instruction to continue without further routine approval. This design does not authorize paid signing, personal authentication, secret export, history rewriting or branch-protection changes.
