# Windows fixture compilation preparation

## Evidence and scope

The original main CI run `38034192624`, attempt 1, job `114161123193`
failed at main `20243d418fd7e886f3358a1ec8036b53ed58d0f9`. All three
Windows Job lifecycle tests inherited a failure in their shared before hook:
the fixed, credential-free C# fixture compilation was killed at its 30-second
deadline, with empty stdout/stderr. The helper preparation succeeded first.
The full source summary was 2,331 tests, 2,296 passed, three failed and 32
reviewed skips. No native Windows endurance artifact was produced.

The production helper already allows 60 seconds for the same fixed OS
PowerShell/.NET compilation path, following an earlier measured 31.05-second
cold compilation. The fixture retained the previous 30-second setting. A local
unchanged three-case run passed in 15.27 seconds; it does not reproduce or erase
the hosted failure. The cause of the hosted compiler delay itself is unknown.

## Decision

Share the existing 60-second compiler allowance between the helper and the
trusted test fixture. Preserve the three lifecycle assertions and their names,
all launch/cleanup deadlines, private storage and hash checks, source counts,
reviewed skips, permissions and required branch protection. Do not retry a
failed compiler automatically or rerun the original failed workflow.

Record bounded, credential-free preparation phase durations/outcomes in the
existing fixture scope receipt. Upload that receipt even when the preparation
fails, so a future failure identifies helper preparation versus fixture
compilation. Explicitly set the Windows source step's TEMP/TMP to `runner.temp`,
as the native installation steps already do, so its receipt is actually under
the upload glob. The test launcher still canonicalizes that OS-selected root.
Do not collect process environments, raw compiler logs, credentials, or the
generated executable.

## Acceptance

The unchanged runtime cases must prove UTF-8 relay, emergency descendant cleanup
while an unrelated fixture continues, cleanup after natural parent exit, and
failed-start cleanup. The new candidate must pass the complete original source,
UI, native, coding, security and platform gates before ordinary integration.
Retain the failed main evidence separately; no new installed runtime, real
ChatGPT account, physical phone or 24-hour result is implied by this fix.
