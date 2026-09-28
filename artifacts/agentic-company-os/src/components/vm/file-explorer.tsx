import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4-mini";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetVmStatusQueryKey,
  type VmEntry,
  type VmFileContent,
} from "@workspace/api-client-react";
import { FileText, FolderClosed, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ValidatedForm } from "@/components/ui/validated-form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { adaptivePollingInterval } from "@/lib/adaptive-polling";
import { FileCopyBoundary } from "./file-copy-boundary";
import { ReviewedFileDeletion } from "./reviewed-file-deletion";
import type { FileCopy } from "@/lib/file-copy";
import type { Locale } from "@/lib/i18n";
import {
  applyFileTextEdit,
  fileErrorCode,
  readFileListing,
  readSnapshot,
  writeReviewedFile,
} from "@/lib/workspace-files";
import {
  editableFileText,
  emptyFileSession,
  settleFileWrite,
  validFilePath,
  type FileDraft,
  type FileWriteRecord,
} from "@/lib/file-session";
import {
  getFileSession,
  putFileSession,
  subscribeFileSession,
} from "@/lib/file-session-store";

const control = "min-h-11 min-w-11 whitespace-normal text-start md:min-h-11";
const source = "min-w-0 break-all font-mono text-base md:text-base";
type View = {
  path: string;
  snapshot: VmFileContent | null;
  loading: boolean;
  error: boolean;
};

export function FileExplorer(props: { agentId: number; active?: boolean }) {
  return (
    <FileCopyBoundary>
      {(copy, locale) => (
        <FileExplorerContent
          key={props.agentId}
          {...props}
          c={copy}
          locale={locale}
        />
      )}
    </FileCopyBoundary>
  );
}

function FileExplorerContent({
  agentId,
  active = true,
  c,
  locale,
}: {
  agentId: number;
  active?: boolean;
  c: FileCopy;
  locale: Locale;
}) {
  const client = useQueryClient();
  const id = useId();
  const documentVisible = useDocumentVisible();
  const { isScopeBlocked } = useOpsControl();
  const blocked = isScopeBlocked("agent_tools");
  const [state, setState] = useState(() => getFileSession(agentId));
  const { session, storageError, damaged } = state;
  const [cwd, setCwd] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [creating, setCreating] = useState(false);
  const [discardPath, setDiscardPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VmEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "fileCreated" | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const draft = session.drafts.find((item) => item.path === view?.path);
  const content = draft?.content ?? view?.snapshot?.content ?? "";
  const readonly = !draft && !view?.snapshot?.editable;
  const unavailable =
    blocked || damaged || storageError || !!session.request || busy || !active;
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });

  useEffect(
    () =>
      subscribeFileSession(agentId, (next, saved) => {
        setState(next);
        if (saved)
          setView((current) =>
            current?.path === saved.path
              ? {
                  ...current,
                  snapshot: { ...saved, editable: true, truncated: false },
                  loading: false,
                  error: false,
                }
              : current,
          );
      }),
    [agentId],
  );
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const listing = useQuery({
    queryKey: ["vm", "files", agentId, cwd],
    queryFn: () => readFileListing(agentId, cwd),
    enabled: active,
    refetchInterval: adaptivePollingInterval({
      active,
      documentVisible,
      live: false,
    }),
  });
  function invalidate() {
    void client.invalidateQueries({
      queryKey: getGetVmStatusQueryKey(agentId),
    });
    void client.invalidateQueries({ queryKey: ["vm", "files", agentId] });
  }
  function rememberFocus() {
    focusOrigin.current = document.activeElement as HTMLElement;
  }
  function returnFocus(event: Event) {
    event.preventDefault();
    const target = focusOrigin.current;
    if (
      target?.isConnected &&
      target.offsetParent &&
      !target.matches(":disabled")
    )
      target.focus();
    else if (refreshButton.current?.offsetParent) refreshButton.current.focus();
  }
  function closeEditor() {
    generation.current++;
    setView(null);
  }
  async function openPath(path: string) {
    rememberFocus();
    setNotice(null);
    const sequence = ++generation.current;
    const latest = getFileSession(agentId).session;
    const restored = latest.drafts.find((item) => item.path === path);
    if (restored) {
      putFileSession({
        ...latest,
        drafts: latest.drafts.map((item) =>
          item.path === path ? { ...item, needsReview: true } : item,
        ),
      });
      setView({ path, snapshot: null, loading: false, error: false });
      return;
    }
    setView({ path, snapshot: null, loading: true, error: false });
    try {
      const snapshot = await readSnapshot(agentId, path);
      if (sequence === generation.current)
        setView({ path, snapshot, loading: false, error: false });
    } catch {
      if (sequence === generation.current)
        setView({ path, snapshot: null, loading: false, error: true });
    }
  }
  function changeContent(value: string) {
    if (!view || readonly) return;
    const latest = getFileSession(agentId).session;
    const previous = latest.drafts.find((item) => item.path === view.path);
    const baseline =
      previous ??
      (view.snapshot && {
        path: view.path,
        content: view.snapshot.content,
        baseContent: view.snapshot.content,
        version: view.snapshot.version,
        needsReview: false,
      });
    if (!baseline) return;
    const next = {
      ...baseline,
      content: applyFileTextEdit(
        previous?.content ?? view.snapshot?.content ?? "",
        value,
      ),
    };
    // Keep even a reverted draft while a write is unresolved; its source version
    // may already have changed on the server.
    const drafts = latest.drafts.filter((item) => item.path !== view.path);
    if (next.content !== next.baseContent || latest.request?.path === view.path)
      drafts.push(next);
    putFileSession({ ...latest, drafts });
    setNotice(null);
  }
  async function send(kind: "edit" | "create") {
    const latest = getFileSession(agentId);
    if (
      sending.current ||
      !active ||
      blocked ||
      latest.damaged ||
      latest.storageError ||
      latest.session.request
    )
      return;
    const current = latest.session.drafts.find(
      (item) => item.path === view?.path,
    );
    const path = kind === "edit" ? current?.path : latest.session.newPath;
    const text = kind === "edit" ? current?.content : "";
    if (
      !path ||
      !validFilePath(path) ||
      path.trim() !== path ||
      !editableFileText(text) ||
      (kind === "edit" &&
        (!current ||
          current.needsReview ||
          current.content === current.baseContent))
    )
      return;
    const request: FileWriteRecord = {
      id: crypto.randomUUID(),
      agentId,
      kind,
      path,
      content: text,
      expectedVersion: kind === "edit" ? current!.version : "missing",
      status: "pending",
      startedAt: new Date().toISOString(),
    };
    // Persist the exact request before the first network side effect.
    const admitted = putFileSession({ ...latest.session, request });
    if (admitted.storageError) {
      putFileSession({ ...admitted.session, request: null });
      return;
    }
    sending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await writeReviewedFile(agentId, {
        path,
        content: text,
        expectedVersion: request.expectedVersion,
      });
      const currentState = getFileSession(agentId).session;
      if (currentState.request?.id === request.id) {
        const saved = putFileSession(
          settleFileWrite(currentState, request, result),
          { saved: { ...result, content: text } },
        );
        if (saved.storageError)
          putFileSession(settleFileWrite(currentState, request));
        else setNotice(kind === "edit" ? "saved" : "fileCreated");
      }
      invalidate();
    } catch {
      const currentState = getFileSession(agentId).session;
      if (currentState.request?.id === request.id)
        putFileSession(settleFileWrite(currentState, request));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const createForm = useForm<{ path: string }>({
    resolver: zodResolver(
      z.object({
        path: z
          .string()
          .check(
            z.refine(
              (value) => validFilePath(value) && value.trim() === value,
              c.pathInvalid,
            ),
          ),
      }),
    ),
    values: { path: session.newPath },
  });
  const editForm = useForm<{ content: string }>({
    resolver: zodResolver(
      z.object({
        content: z.string().check(z.refine(editableFileText, c.contentInvalid)),
      }),
    ),
    values: { content },
  });
  const pathField = createForm.register("path");
  const contentField = editForm.register("content");
  const pathError = createForm.formState.errors.path;
  const contentError = editForm.formState.errors.content;
  const reviewPath =
    draft?.needsReview || session.request?.path === view?.path
      ? view?.path
      : undefined;

  function acceptReview(path: string, snapshot: VmFileContent | null) {
    const latest = getFileSession(agentId).session;
    const drafts = latest.drafts.flatMap((item) => {
      if (item.path !== path || !snapshot?.editable || snapshot.truncated)
        return [item];
      return item.content === snapshot.content
        ? []
        : [
            {
              ...item,
              version: snapshot.version,
              baseContent: snapshot.content,
              needsReview: false,
            },
          ];
    });
    putFileSession({
      ...latest,
      drafts,
      request: latest.request?.path === path ? null : latest.request,
    });
    if (snapshot)
      setView((current) =>
        current?.path === path ? { ...current, snapshot } : current,
      );
    invalidate();
  }

  return (
    <section
      dir={locale === "ar" ? "rtl" : "ltr"}
      aria-label={c.filesTitle}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background text-foreground"
    >
      <header className="space-y-2 border-b p-[16px] sm:p-4">
        <h3 className="font-semibold">{c.filesTitle}</h3>
        <p className="text-sm text-muted-foreground">{c.filesHelp}</p>
        <div className="flex flex-wrap items-center gap-2">
          <nav
            aria-label={c.pathLabel}
            className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-1 sm:basis-0"
          >
            <Button
              type="button"
              variant="ghost"
              className={control}
              onClick={() => setCwd("")}
              aria-current={!cwd ? "location" : undefined}
            >
              {c.root}
            </Button>
            {cwd
              .split("/")
              .filter(Boolean)
              .map((segment, index, segments) => {
                const path = segments.slice(0, index + 1).join("/");
                return (
                  <Button
                    key={path}
                    type="button"
                    variant="ghost"
                    className={`${control} max-w-full break-all font-mono`}
                    aria-label={`${c.openFolder}: ${path}`}
                    aria-current={path === cwd ? "location" : undefined}
                    onClick={() => setCwd(path)}
                  >
                    <bdi dir="auto">{segment}</bdi>
                  </Button>
                );
              })}
          </nav>
          <Button
            type="button"
            variant="outline"
            className={control}
            aria-label={c.refreshFiles}
            ref={refreshButton}
            onClick={() => void listing.refetch()}
          >
            <RefreshCw size={16} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            className={control}
            onClick={() => {
              rememberFocus();
              if (!session.newPath && cwd)
                putFileSession({
                  ...getFileSession(agentId).session,
                  newPath: `${cwd}/`,
                });
              setCreating(true);
            }}
            disabled={blocked}
          >
            {c.newFile}
          </Button>
        </div>
        {listing.data && (
          <p className="text-sm text-muted-foreground">
            {c.entriesLabel}: {number.format(listing.data.entries.length)}
          </p>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-[12px] sm:p-3">
        {blocked && (
          <p role="status" className="text-sm">
            {c.fileBlocked}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {c[notice]}
          </p>
        )}
        {storageError && (
          <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm">
            <p>{c.fileStorageError}</p>
            {!damaged && (
              <Button
                type="button"
                variant="outline"
                className={control}
                onClick={() => putFileSession(getFileSession(agentId).session)}
              >
                {c.storageRetry}
              </Button>
            )}
          </div>
        )}
        {damaged && (
          <div className="space-y-2 rounded-lg border p-3">
            <p role="alert" className="text-sm">
              {c.fileDamaged}
            </p>
            <Consent
              c={c}
              label={c.fileResetCheck}
              submit={c.fileReset}
              onConfirm={() => {
                putFileSession(emptyFileSession(agentId), { reset: true });
                closeEditor();
              }}
            />
          </div>
        )}
        {session.request && (
          <div
            role="status"
            className="space-y-2 rounded-lg border p-3 text-sm"
          >
            <p className="font-medium">
              {busy ? c.writePending : c.writeUnknown}
            </p>
            <p>{c.writeUnknownHelp}</p>
            <p dir="ltr" className={source}>
              {session.request.path}
            </p>
            <Button
              type="button"
              variant="outline"
              className={control}
              disabled={busy}
              onClick={() => void openPath(session.request!.path)}
            >
              {c.reviewRequest}
            </Button>
          </div>
        )}
        {session.drafts.length > 0 && (
          <section
            aria-label={c.draftsTitle}
            className="space-y-2 rounded-lg border p-3"
          >
            <h4 className="text-sm font-medium">{c.draftsTitle}</h4>
            <p className="text-sm text-muted-foreground">{c.fileLocalOnly}</p>
            <ul className="space-y-2">
              {session.drafts.map((item) => (
                <li key={item.path} className="flex min-w-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className={`${control} min-w-0 flex-1 break-all`}
                    aria-label={`${c.resumeDraft}: ${item.path}`}
                    onClick={() => void openPath(item.path)}
                  >
                    <bdi dir="ltr" className="min-w-0 break-all">
                      {item.path}
                    </bdi>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className={control}
                    aria-label={`${c.discardDraft}: ${item.path}`}
                    disabled={session.request?.path === item.path}
                    onClick={() => {
                      rememberFocus();
                      setDiscardPath(item.path);
                    }}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {listing.isLoading && (
          <p role="status" className="p-3 text-sm">
            {c.loadingFiles}
          </p>
        )}
        {listing.isError && (
          <p role="alert" className="p-3 text-sm">
            {listing.data ? c.listStale : c.listError}
          </p>
        )}
        {listing.data && !listing.data.complete && (
          <p role="status" className="p-3 text-sm">
            {c.partialList}
          </p>
        )}
        {listing.data?.complete && !listing.data.entries.length && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {c.emptyList}
          </p>
        )}
        <ul className="divide-y">
          {listing.data?.entries.map((entry) => (
            <li
              key={entry.path}
              className="flex min-w-0 items-center gap-1 py-1"
            >
              <button
                type="button"
                className="flex min-h-11 min-w-0 flex-1 items-start gap-[8px] rounded-md p-[8px] text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${entry.type === "directory" ? c.openFolder : c.openFile}: ${entry.name}`}
                onClick={() =>
                  entry.type === "directory"
                    ? setCwd(entry.path)
                    : void openPath(entry.path)
                }
              >
                {entry.type === "directory" ? (
                  <FolderClosed
                    size={18}
                    className="mt-1 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <FileText
                    size={18}
                    className="mt-1 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">
                  <bdi dir="auto" className="block break-all text-base">
                    {entry.name}
                  </bdi>
                  <span className="block text-sm text-muted-foreground">
                    {date.format(new Date(entry.updatedAt))}
                    {entry.type === "file" && (
                      <>
                        {" "}
                        · {c.bytes}: {number.format(entry.sizeBytes)}
                      </>
                    )}
                  </span>
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-[44px] min-w-[44px] shrink-0 text-muted-foreground hover:text-destructive md:min-h-11"
                aria-label={`${c.remove}: ${entry.name}`}
                disabled={
                  blocked || !!session.request || storageError || damaged
                }
                onClick={() => setDeleteTarget(entry)}
              >
                <Trash2 size={16} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <ReviewedFileDeletion
        agentId={agentId}
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onChange={invalidate}
        onReturnFocus={() => {
          if (refreshButton.current?.offsetParent)
            refreshButton.current.focus();
        }}
        blocked={blocked || !!session.request || storageError || damaged}
        copy={c}
        locale={locale}
      />

      <Dialog
        open={creating && active}
        onOpenChange={(open) => !open && setCreating(false)}
      >
        <DialogContent
          dir={locale === "ar" ? "rtl" : "ltr"}
          onCloseAutoFocus={returnFocus}
        >
          <DialogHeader>
            <DialogTitle>{c.newFile}</DialogTitle>
            <DialogDescription>{c.pathHelp}</DialogDescription>
          </DialogHeader>
          <ValidatedForm
            form={createForm}
            onSubmit={() => send("create")}
            className="space-y-3"
          >
            <label htmlFor={`${id}-path`} className="text-sm font-medium">
              {c.pathLabel}
            </label>
            <Input
              {...pathField}
              id={`${id}-path`}
              value={session.newPath}
              dir="ltr"
              className={`${source} min-h-11`}
              aria-describedby={`${id}-path-help${pathError ? ` ${id}-path-error` : ""}`}
              aria-invalid={!!pathError}
              onChange={(event) => {
                void pathField.onChange(event);
                putFileSession({
                  ...getFileSession(agentId).session,
                  newPath: event.target.value,
                });
                setNotice(null);
              }}
            />
            <p id={`${id}-path-help`} className="text-sm text-muted-foreground">
              {c.fileLocalOnly}
            </p>
            {pathError && (
              <p id={`${id}-path-error`} role="alert" className="text-sm">
                {c.pathInvalid}
              </p>
            )}
            {session.request && (
              <p role="status" className="text-sm">
                {busy ? c.writePending : c.writeUnknownHelp}
              </p>
            )}
            {storageError && (
              <p role="alert" className="text-sm">
                {c.fileStorageError}
              </p>
            )}
            {blocked && (
              <p role="status" className="text-sm">
                {c.fileBlocked}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm">
                {c[notice]}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                className={control}
                onClick={() => setCreating(false)}
              >
                {c.close}
              </Button>
              <Button type="submit" className={control} disabled={unavailable}>
                {c.create}
              </Button>
            </DialogFooter>
          </ValidatedForm>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!view && active}
        onOpenChange={(open) => !open && closeEditor()}
      >
        <DialogContent
          dir={locale === "ar" ? "rtl" : "ltr"}
          className="max-w-3xl"
          onCloseAutoFocus={returnFocus}
        >
          <DialogHeader>
            <DialogTitle dir="ltr" className={source}>
              {view?.path}
            </DialogTitle>
            <DialogDescription>{c.snapshotHint}</DialogDescription>
          </DialogHeader>
          {view?.loading ? (
            <p role="status">{c.reading}</p>
          ) : view?.error && !draft ? (
            <div className="space-y-2">
              <p role="alert">{c.readError}</p>
              <Button
                type="button"
                variant="outline"
                className={control}
                onClick={() => void openPath(view.path)}
              >
                {c.compare}
              </Button>
            </div>
          ) : (
            (draft || view?.snapshot) && (
              <ValidatedForm
                form={editForm}
                onSubmit={() => send("edit")}
                className="space-y-3"
              >
                <label
                  htmlFor={`${id}-content`}
                  className="block text-sm font-medium"
                >
                  {c.contentLabel.replace(
                    "{name}",
                    view?.path.split("/").at(-1) ?? "",
                  )}
                </label>
                <Textarea
                  {...contentField}
                  id={`${id}-content`}
                  value={content}
                  readOnly={readonly}
                  aria-readonly={readonly}
                  aria-invalid={!!contentError}
                  aria-describedby={`${id}-content-help${contentError ? ` ${id}-content-error` : ""}`}
                  dir="auto"
                  spellCheck={false}
                  className={`${source} min-h-60 leading-relaxed`}
                  onChange={(event) => {
                    void contentField.onChange(event);
                    changeContent(event.target.value);
                  }}
                />
                <p
                  id={`${id}-content-help`}
                  className="text-sm text-muted-foreground"
                >
                  {readonly ? c.readonly : c.fileLocalOnly}
                </p>
                {contentError && (
                  <p
                    id={`${id}-content-error`}
                    role="alert"
                    className="text-sm"
                  >
                    {c.contentInvalid}
                  </p>
                )}
                {storageError && (
                  <p role="alert" className="text-sm">
                    {c.fileStorageError}
                  </p>
                )}
                {blocked && (
                  <p role="status" className="text-sm">
                    {c.fileBlocked}
                  </p>
                )}
                {busy && (
                  <p role="status" className="text-sm">
                    {c.writePending}
                  </p>
                )}
                {notice && (
                  <p role="status" className="text-sm">
                    {c[notice]}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    className={control}
                    onClick={closeEditor}
                  >
                    {c.close}
                  </Button>
                  <Button
                    type="submit"
                    className={control}
                    disabled={
                      unavailable ||
                      readonly ||
                      !draft ||
                      draft.needsReview ||
                      draft.content === draft.baseContent
                    }
                  >
                    {c.save}
                  </Button>
                </DialogFooter>
              </ValidatedForm>
            )
          )}
          {reviewPath && (
            <FileReview
              key={reviewPath}
              agentId={agentId}
              path={reviewPath}
              draft={draft}
              request={
                session.request?.path === reviewPath ? session.request : null
              }
              c={c}
              disabled={busy || damaged}
              onAccept={(snapshot) => acceptReview(reviewPath, snapshot)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!discardPath && active}
        onOpenChange={(open) => !open && setDiscardPath(null)}
      >
        <DialogContent
          dir={locale === "ar" ? "rtl" : "ltr"}
          onCloseAutoFocus={returnFocus}
        >
          <DialogHeader>
            <DialogTitle>{c.discardTitle}</DialogTitle>
            <DialogDescription>{c.discardBody}</DialogDescription>
          </DialogHeader>
          <p dir="ltr" className={source}>
            {discardPath}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className={control}
              onClick={() => setDiscardPath(null)}
            >
              {c.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className={control}
              onClick={() => {
                const latest = getFileSession(agentId).session;
                if (latest.request?.path === discardPath) return;
                putFileSession({
                  ...latest,
                  drafts: latest.drafts.filter(
                    (item) => item.path !== discardPath,
                  ),
                });
                setDiscardPath(null);
              }}
            >
              {c.discardConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Consent({
  c,
  label,
  submit,
  disabled,
  onConfirm,
}: {
  c: FileCopy;
  label: string;
  submit: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const id = useId();
  const form = useForm<{ confirmed: boolean }>({
    defaultValues: { confirmed: false },
    resolver: zodResolver(
      z.object({ confirmed: z.boolean().check(z.refine(Boolean, label)) }),
    ),
  });
  const confirmed = form.watch("confirmed");
  return (
    <ValidatedForm
      form={form}
      className="space-y-3"
      onSubmit={() => {
        onConfirm();
        form.reset();
      }}
    >
      <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-sm">
        <input
          {...form.register("confirmed")}
          id={id}
          type="checkbox"
          aria-describedby={`${id}-help`}
          className="size-5 shrink-0"
        />
        {label}
      </label>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        {c.clearConfirm}
      </p>
      <Button
        type="submit"
        variant="outline"
        className={control}
        disabled={!confirmed || disabled}
      >
        {submit}
      </Button>
    </ValidatedForm>
  );
}

function FileReview({
  agentId,
  path,
  draft,
  request,
  c,
  disabled,
  onAccept,
}: {
  agentId: number;
  path: string;
  draft?: FileDraft;
  request: FileWriteRecord | null;
  c: FileCopy;
  disabled: boolean;
  onAccept: (snapshot: VmFileContent | null) => void;
}) {
  const [snapshot, setSnapshot] = useState<VmFileContent | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "loaded" | "missing" | "error"
  >("idle");
  const sequence = useRef(0);
  const id = useId();
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function compare() {
    const current = ++sequence.current;
    setStatus("loading");
    setSnapshot(null);
    try {
      const result = await readSnapshot(agentId, path);
      if (current === sequence.current) {
        setSnapshot(result);
        setStatus("loaded");
      }
    } catch (error) {
      if (current === sequence.current)
        setStatus(
          fileErrorCode(error) === "VM_FILE_MISSING" ? "missing" : "error",
        );
    }
  }
  const canRebase = !!draft && !!snapshot?.editable && !snapshot.truncated;
  return (
    <section
      aria-label={c.reviewTitle}
      className="space-y-3 rounded-lg border p-3"
    >
      <h4 className="font-medium">{c.reviewTitle}</h4>
      <p className="text-sm">{c.reviewHelp}</p>
      {request && (
        <>
          <p className="text-sm">{c.writeUnknownHelp}</p>
          <label htmlFor={`${id}-sent`} className="block text-sm font-medium">
            {c.writeUnknown}
          </label>
          <Textarea
            id={`${id}-sent`}
            value={request.content}
            readOnly
            dir="auto"
            className={`${source} min-h-24`}
          />
        </>
      )}
      <Button
        type="button"
        variant="outline"
        className={control}
        disabled={disabled || status === "loading"}
        onClick={() => void compare()}
      >
        {status === "loading" ? c.reading : c.compare}
      </Button>
      {status === "error" && (
        <p role="alert" className="text-sm">
          {c.comparisonError}
        </p>
      )}
      {status === "missing" && (
        <p role="status" className="text-sm">
          {c.missingFile}
        </p>
      )}
      {snapshot && (
        <>
          <label
            htmlFor={`${id}-compare`}
            className="block text-sm font-medium"
          >
            {c.comparisonLabel}
          </label>
          <Textarea
            id={`${id}-compare`}
            value={snapshot.content}
            readOnly
            dir="auto"
            className={`${source} max-h-60 min-h-24`}
          />
          {!snapshot.editable && <p className="text-sm">{c.readonly}</p>}
        </>
      )}
      {(canRebase || request) && (
        <Consent
          key={`${status}-${snapshot?.version ?? ""}`}
          c={c}
          label={canRebase ? c.reviewCheck : c.clearConfirm}
          submit={canRebase ? c.reviewDone : c.clear}
          disabled={disabled || status === "loading"}
          onConfirm={() => onAccept(canRebase ? snapshot : null)}
        />
      )}
    </section>
  );
}
