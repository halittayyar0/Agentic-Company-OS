# User-authored executable tools

The **Skills → Personal skills and tools → Create new → Executable tool** editor saves a local Node program in the operator's database. It can be edited, enabled/disabled, exported and imported as a JSON package. Nothing is downloaded or executed during import. The package declares `permissions: ["terminal"]`; caller-supplied executables, credentials and environment fields are rejected.

The code is the body of an async function receiving `input`. Return a JSON result. Node standard-library `require()` is available. Example:

```javascript
return { total: input.units * input.price };
```

An exported package looks like this:

```json
{
  "schemaVersion": 1,
  "id": "user-invoice",
  "kind": "program",
  "title": "Invoice total",
  "description": "Accept units and price; return their product as total.",
  "code": "return { total: input.units * input.price };",
  "permissions": ["terminal"]
}
```

## Agent invocation

The agent discovers the installed revision through `list_extensions`. It calls the existing `vm_run_command` tool with an exact command such as:

```text
extension user-invoice@1 {"units":3,"price":8}
```

The current revision is mandatory. An exact, single-use `other` approval is required. Full-access mode can approve eligible queued requests through its existing recorded approval worker. Read-only policy, revoked terminal permission, disabled process execution and emergency stop still prevent execution. A disabled or changed package fails fresh validation before process launch; request a new revision-bound action after editing.

Execution uses fixed Node, structured arguments, no command shell, a minimal environment, a 30-second process limit and bounded output. Provider/operator secrets are not inherited in environment variables. A completed approval has one durable operation receipt and is not replayed on retry. A lost acknowledgement follows the existing unknown-outcome rules.

Programs can use the service account's actual filesystem and network authority. Native execution is not an OS isolation boundary; container execution has the container's mounted paths and OS permissions. Install only code you trust, and do not put credentials in package code. Arbitrary MCP servers and automatic third-party package installation are not part of this format.

## Verified behavior

A real approved-action test installs a user program, rejects an unapproved call, executes Node, checks its JSON result and minimal environment, verifies one durable receipt and proves retry does not append a second output file entry. Additional checks cover malformed declarations, fixed executable selection, revision changes and disablement. Browser coverage creates and reloads a program from the mobile layout.
