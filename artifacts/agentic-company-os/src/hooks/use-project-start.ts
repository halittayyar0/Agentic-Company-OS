import { useEffect, useRef, useState } from "react";
import {
  createTask,
  getTaskCreationRequest,
  type TaskCreationReceipt,
} from "@workspace/api-client-react";
import {
  acceptProjectReceipt,
  beginProjectStart,
  clearProjectStart,
  readProjectStart,
  type ProjectDraft,
  type ProjectStartRequest,
} from "@/lib/project-start-request";
export function useProjectStart(
  onOpen: (taskId: number, submitted: ProjectDraft | null) => void,
) {
  const [initial] = useState(() => {
    try {
      return readProjectStart(sessionStorage);
    } catch {
      return { request: null, error: true };
    }
  });
  const [request, setRequest] = useState(initial.request),
    current = useRef(initial.request);
  const [storageError, setStorageError] = useState(initial.error);
  const [receipt, setReceipt] = useState<TaskCreationReceipt | null>(null);
  const [outcome, setOutcome] = useState<"uncertain" | "missing">("uncertain");
  const [busy, setBusy] = useState<"sending" | "checking" | null>(null),
    running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const matches = (saved: ProjectStartRequest) =>
    mounted.current && current.current?.requestId === saved.requestId;
  function clear(saved: ProjectStartRequest) {
    let cleared = false;
    try {
      cleared = clearProjectStart(saved, sessionStorage);
    } catch {
      /* keep recovery record */
    }
    if (cleared) {
      current.current = null;
      setRequest(null);
    } else setStorageError(true);
    return cleared;
  }
  function open(saved = request, confirmed = receipt) {
    if (
      !saved ||
      !confirmed ||
      !matches(saved) ||
      confirmed.requestId !== saved.requestId ||
      confirmed.state !== "created" ||
      confirmed.taskId === null
    )
      return;
    const cleared = clear(saved);
    onOpen(confirmed.taskId, cleared ? saved.submittedDraft : null);
  }
  async function inspect(saved: ProjectStartRequest) {
    try {
      const value = await getTaskCreationRequest(saved.requestId, {
        cache: "no-store",
      });
      const confirmed = acceptProjectReceipt(value, saved.requestId);
      if (!confirmed) throw Error("invalid_receipt");
      if (matches(saved)) {
        setReceipt(confirmed);
        setOutcome("uncertain");
      }
      return confirmed;
    } catch (error) {
      if (matches(saved)) {
        setReceipt(null);
        setOutcome(
          error &&
            typeof error === "object" &&
            "status" in error &&
            error.status === 404
            ? "missing"
            : "uncertain",
        );
      }
      return null;
    }
  }
  async function send(saved: ProjectStartRequest) {
    if (running.current || !matches(saved)) return;
    running.current = true;
    setBusy("sending");
    setReceipt(null);
    setOutcome("uncertain");
    try {
      const task = await createTask(saved.input);
      if (!matches(saved)) return;
      if (!Number.isInteger(task?.id) || task.id <= 0 || task.id > 2147483647)
        throw Error("invalid_creation_response");
      // Bind the POST acknowledgement to the saved identity through a read-only receipt.
      const confirmed = await inspect(saved);
      if (confirmed?.state === "created" && confirmed.taskId === task.id)
        open(saved, confirmed);
      else if (matches(saved)) {
        setReceipt(null);
        setOutcome("uncertain");
      }
    } catch {
      if (matches(saved)) {
        setReceipt(null);
        setOutcome("uncertain");
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  function start(submitted: ProjectDraft) {
    if (running.current || current.current) return;
    let saved: ProjectStartRequest | null = null;
    try {
      saved = beginProjectStart(submitted, crypto.randomUUID(), sessionStorage);
    } catch {
      /* no verified save, no dispatch */
    }
    if (!saved) {
      setStorageError(true);
      try {
        const prior = readProjectStart(sessionStorage);
        if (prior.request) {
          current.current = prior.request;
          setRequest(prior.request);
        }
      } catch {}
      return;
    }
    current.current = saved;
    setRequest(saved);
    setReceipt(null);
    setStorageError(false);
    void send(saved);
  }
  async function check() {
    if (running.current || !request) return;
    running.current = true;
    setBusy("checking");
    try {
      await inspect(request);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  function prepare() {
    if (
      running.current ||
      !request ||
      receipt?.state !== "rejected" ||
      receipt.requestId !== request.requestId
    )
      return;
    if (!clear(request)) return;
    setReceipt(null);
    setStorageError(false);
    setOutcome("uncertain");
  }
  return {
    request,
    receipt,
    outcome,
    busy,
    storageError,
    start,
    check,
    open: () => open(),
    prepare,
    retry: () => {
      if (request && outcome === "missing" && !receipt) void send(request);
    },
  };
}
