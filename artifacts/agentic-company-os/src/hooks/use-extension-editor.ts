import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  beginExtensionSave,
  classifyExtensionSave,
  clearExtensionEditor,
  clearExtensionSave,
  prepareExtensionSave,
  readExtensionEditor,
  readExtensionSave,
  rejectExtensionSave,
  isExtensionSaveRejection,
  writeExtensionEditor,
  type EditableManifest,
  type ExtensionEditorDraft,
  type ExtensionSaveRequest,
} from "@/lib/extension-editor-draft";

let editableMemory: { draft: ExtensionEditorDraft; error: boolean } | null =
  null;
let pendingMemory: ExtensionSaveRequest | null = null;
type Status =
  ReturnType<typeof classifyExtensionSave> | "uncertain" | "rejected";
type Observed = {
  revision: number;
  enabled: boolean;
  manifest: EditableManifest;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function retainExtensionEditorBeforeReload() {
  try {
    if (
      editableMemory &&
      !writeExtensionEditor(editableMemory.draft, sessionStorage)
    )
      return false;
    if (pendingMemory && !beginExtensionSave(pendingMemory, sessionStorage))
      return false;
    return (
      !readExtensionEditor(sessionStorage).error &&
      !readExtensionSave(sessionStorage).error
    );
  } catch {
    return false;
  }
}

export function useExtensionEditor(onSaved: () => void) {
  const [initial] = useState(() => {
    try {
      const saved = readExtensionEditor(sessionStorage),
        pending = readExtensionSave(sessionStorage);
      return {
        draft: editableMemory?.draft ?? saved.draft,
        pending: pendingMemory ?? pending.request,
        error: saved.error || pending.error || !!editableMemory?.error,
        pendingError: pending.error,
      };
    } catch {
      return {
        draft: editableMemory?.draft ?? null,
        pending: pendingMemory,
        error: true,
        pendingError: true,
      };
    }
  });
  const [draft, setDraft] = useState(initial.draft),
    [pending, setPending] = useState(initial.pending),
    [storageError, setStorageError] = useState(initial.error),
    [status, setStatus] = useState<Status>(
      initial.pending?.rejected ? "rejected" : "uncertain",
    ),
    [busy, setBusy] = useState<"saving" | "checking" | null>(null),
    [invalid, setInvalid] = useState(false),
    [incoming, setIncoming] = useState<ExtensionEditorDraft | null>(null);
  const [observed, setObserved] = useState<Observed | null>(null);
  const current = useRef(initial.draft),
    request = useRef(initial.pending),
    rejected = useRef(!!initial.pending?.rejected),
    flight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function change(next: ExtensionEditorDraft) {
    if (!mounted.current) return false;
    current.current = next;
    setDraft(next);
    let saved = false;
    try {
      saved = writeExtensionEditor(next, sessionStorage);
    } catch {
      /* editable memory only */
    }
    editableMemory = { draft: next, error: !saved };
    setStorageError(!saved || initial.pendingError);
    setInvalid(false);
    return saved;
  }
  function prepare(candidate: ExtensionEditorDraft) {
    if (!mounted.current || flight.current || request.current) return false;
    if (current.current && !same(current.current, candidate)) {
      setIncoming(candidate);
      return false;
    }
    return change(candidate);
  }
  function edit(value?: EditableManifest, revision = 0, enabled = true) {
    if (!mounted.current || flight.current || request.current) return false;
    const candidate: ExtensionEditorDraft = {
      version: 1,
      revision,
      enabled,
      defaults: JSON.stringify(
        value?.kind === "tool" ? value.defaults : {},
        null,
        2,
      ),
      manifest: value ?? {
        schemaVersion: 1,
        id: `user-${crypto.randomUUID()}`,
        title: "",
        description: "",
        kind: "skill",
        instructions: "",
      },
    };
    return prepare(candidate);
  }
  function resolveIncoming(use: boolean) {
    if (!incoming || flight.current || request.current) return false;
    const retained = use
      ? change(incoming)
      : !!current.current && change(current.current);
    if (retained) setIncoming(null);
    return retained;
  }
  function finish(expected: ExtensionSaveRequest) {
    if (!mounted.current || !same(request.current, expected)) return;
    let cleared = false;
    try {
      cleared = clearExtensionSave(expected, sessionStorage);
    } catch {
      /* preserve request */
    }
    if (!cleared) {
      setStorageError(true);
      return;
    }
    request.current = null;
    pendingMemory = null;
    setPending(null);
    const latest = current.current;
    if (latest && same(latest, expected.submittedDraft)) {
      let removed = false;
      try {
        removed = clearExtensionEditor(latest, sessionStorage);
      } catch {
        /* preserve editable state */
      }
      if (removed) {
        current.current = null;
        editableMemory = null;
        setDraft(null);
      } else {
        change({ ...latest, revision: expected.expectedRevision + 1 });
        setStorageError(true);
      }
    } else if (
      latest?.manifest.id === expected.manifest.id &&
      latest.revision === expected.expectedRevision
    ) {
      change({ ...latest, revision: expected.expectedRevision + 1 });
    }
    onSaved();
  }
  async function send(expected: ExtensionSaveRequest) {
    if (flight.current) return;
    flight.current = true;
    setBusy("saving");
    setStatus("uncertain");
    setObserved(null);
    try {
      const row = await customFetch<unknown>("/api/skills/extensions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest: expected.manifest,
          expectedRevision: expected.expectedRevision,
          enabled: expected.enabled,
        }),
      });
      if (!mounted.current || !same(request.current, expected)) return;
      const observed = classifyExtensionSave(expected, [row]);
      setStatus(observed);
      if (observed === "matching") finish(expected);
    } catch (error) {
      if (mounted.current && same(request.current, expected)) {
        if (isExtensionSaveRejection(error)) {
          rejected.current = true;
          const retained = rejectExtensionSave(expected, sessionStorage);
          if (retained) {
            request.current = pendingMemory = retained;
            setPending(retained);
          } else setStorageError(true);
          setStatus("rejected");
        } else setStatus("uncertain");
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  function save() {
    if (flight.current || request.current || incoming || !current.current)
      return;
    const expected = prepareExtensionSave(current.current);
    if (!expected) {
      setInvalid(true);
      return;
    }
    let retained = false;
    try {
      retained =
        writeExtensionEditor(current.current, sessionStorage) &&
        beginExtensionSave(expected, sessionStorage);
    } catch {
      /* no dispatch */
    }
    if (!retained) {
      setStorageError(true);
      return;
    }
    request.current = expected;
    rejected.current = false;
    pendingMemory = expected;
    setPending(expected);
    void send(expected);
  }
  async function check() {
    const expected = request.current;
    if (!expected || flight.current) return;
    flight.current = true;
    setBusy("checking");
    try {
      const rows = await customFetch<unknown>("/api/skills/extensions", {
        cache: "no-store",
      });
      if (mounted.current && same(request.current, expected)) {
        const result = classifyExtensionSave(expected, rows);
        setStatus(
          result === "missing" && rejected.current ? "rejected" : result,
        );
        // The classifier validates the complete list before it reports a change.
        setObserved(
          result === "changed" && Array.isArray(rows)
            ? ((rows.find(
                (row: { id: string }) => row.id === expected.manifest.id,
              ) as Observed | undefined) ?? null)
            : null,
        );
      }
    } catch {
      if (mounted.current && same(request.current, expected))
        setStatus("invalid");
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  function retry() {
    const expected = request.current;
    if (!expected || status !== "missing" || flight.current) return;
    let retained = false;
    try {
      retained = beginExtensionSave(expected, sessionStorage);
    } catch {
      /* no dispatch */
    }
    if (!retained) {
      setStorageError(true);
      return;
    }
    void send(expected);
  }
  function discard() {
    if (flight.current || request.current) return;
    const latest = current.current;
    if (!latest) return;
    let removed = false;
    try {
      removed = clearExtensionEditor(latest, sessionStorage);
    } catch {
      /* preserve text */
    }
    if (!removed) {
      setStorageError(true);
      return;
    }
    current.current = null;
    editableMemory = null;
    setDraft(null);
    setIncoming(null);
  }
  function reviewCurrent() {
    const expected = request.current,
      latest = current.current;
    if (
      !(status === "rejected" || (status === "changed" && observed)) ||
      !expected ||
      flight.current ||
      !latest ||
      latest.manifest.id !== expected.manifest.id
    )
      return;
    let cleared = false;
    try {
      cleared =
        change(
          status === "changed"
            ? { ...latest, revision: observed!.revision }
            : latest,
        ) && clearExtensionSave(expected, sessionStorage);
    } catch {
      /* preserve identity */
    }
    if (!cleared) {
      setStorageError(true);
      return;
    }
    request.current = null;
    pendingMemory = null;
    setPending(null);
    setObserved(null);
  }
  return {
    draft,
    current,
    pending,
    storageError,
    status,
    busy,
    invalid,
    incoming,
    observed,
    dirty: !!draft,
    change,
    edit,
    prepare,
    resolveIncoming,
    save,
    check,
    retry,
    discard,
    reviewCurrent,
    continue: () => {
      if (status === "matching" && request.current) finish(request.current);
      if (status === "rejected") reviewCurrent();
    },
  };
}
