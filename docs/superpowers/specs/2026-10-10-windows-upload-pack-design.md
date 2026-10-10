# Windows reviewed source transfer

## Verified problem

Candidate `5657c542025ca5c5b180a44882c69b98efe47287` passed its original hosted checks but failed two real local source-workspace journeys. A reviewed clone can contain a Git pack whose path crosses the Windows 260-character boundary. Parent `git -c core.longpaths=true fetch` does not give the local upload-pack subprocess that setting. Fetch then reports `not our ref` for a commit that the reviewed clone actually contains. An owned real Git reproduction failed without an explicit upload-pack setting and succeeded with it. Preserve those failures as failures.

## Required behavior

Users must be able to check, apply and roll back the exact reviewed source snapshot under long Windows installation paths. Existing policy, ownership, link, revision, original-base and candidate-cleanliness fences remain mandatory. No global or repository configuration change, path shortening, different snapshot, retry or permission expansion is permitted.

Use a static Windows-only Git upload-pack command on the existing managed local fetch. No user/browser value may supply that command. Non-Windows argv remain unchanged. The real seven-case fixture must cross both branch-ref lock and pack-file boundaries even on short hosted temporary roots.

## Evidence and limits

Observe RED in unchanged production after strengthening the fixture, then GREEN in all seven existing journeys. Verify adjacent native source/coding authority tests, types, formatting and staged secrets. Review the whole corrective branch before publication. This fix has no UI, language, mobile, authentication or billing change. Complete fresh candidate release checks remain necessary before protected merge; previous green hosted checks cannot establish acceptance of this change.
