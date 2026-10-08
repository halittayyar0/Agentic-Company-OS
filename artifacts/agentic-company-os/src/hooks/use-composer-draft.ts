import { useRef, useState } from "react";
import {
  readComposerDraft,
  writeComposerDraft,
  clearComposerDraft,
  type ComposerDraft,
} from "@/lib/composer-draft";
// This tab's SPA navigation can preserve editable input even when browser
// storage refuses it. A full reload cannot; the form reports that distinction.
const editable = new Map<
  ComposerDraft["kind"],
  { draft: ComposerDraft; unsaved: boolean }
>();
export function useComposerDraft<T extends ComposerDraft>(
  fallback: T,
  preferInitial = false,
) {
  const [initial] = useState(() => {
    let saved: ReturnType<typeof readComposerDraft> = {
      draft: null,
      error: true,
    };
    try {
      saved = readComposerDraft(fallback.kind, sessionStorage);
    } catch {
      /* memory only */
    }
    const memory = editable.get(fallback.kind);
    return {
      value: (preferInitial
        ? fallback
        : (memory?.draft ?? saved.draft ?? fallback)) as T,
      error: saved.error || (!preferInitial && !!memory?.unsaved),
    };
  });
  const [value, setValue] = useState<T>(initial.value),
    [error, setError] = useState(initial.error);
  const current = useRef(initial.value),
    completed = useRef(false);
  function change(next: T) {
    if (completed.current) return;
    current.current = next;
    setValue(next);
    let saved = false;
    try {
      saved = writeComposerDraft(next, sessionStorage);
    } catch {
      /* retain editable memory */
    }
    editable.set(next.kind, { draft: next, unsaved: !saved });
    setError(!saved);
  }
  function finish(submitted: T) {
    // Called only after the explicit Start request has a successful receipt.
    completed.current = true;
    if (
      JSON.stringify(editable.get(submitted.kind)?.draft) ===
      JSON.stringify(submitted)
    )
      editable.delete(submitted.kind);
    try {
      clearComposerDraft(submitted, sessionStorage);
    } catch {
      /* do not hide a later draft */
    }
  }
  return { value, error, change, finish, current };
}
