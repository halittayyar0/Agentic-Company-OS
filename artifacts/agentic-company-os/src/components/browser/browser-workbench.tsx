import { LanguagePackStatus } from "../i18n/language-pack-status";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4-mini";
import { Globe2 } from "lucide-react";
import { OperatorRecovery } from "@/components/computer/operator-recovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ValidatedForm } from "@/components/ui/validated-form";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n";
import { loadBrowserCopy, type BrowserCopy } from "@/lib/browser-copy";
import {
  browserLocalState,
  type BrowserReviewSnapshot,
  browserPoint,
  browserUrl,
  validBrowserText,
} from "@/lib/browser-workbench";
import { useBrowserWorkbench } from "./use-browser-workbench";

const button = "min-h-11 min-w-11 whitespace-normal text-start md:min-h-11";
type Props = {
  agentId: number;
  agentName: string;
  active?: boolean;
  agentWorking?: boolean;
};
export function BrowserWorkbench(props: Props) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["browser-copy", locale],
    queryFn: () => loadBrowserCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        className="rounded-xl border bg-card p-5"
        buttonClassName={button}
      />
    );
  return (
    <BrowserWorkbenchContent
      key={props.agentId}
      {...props}
      c={copy.data}
      locale={locale}
    />
  );
}

function BrowserWorkbenchContent({
  agentId,
  agentName,
  active = true,
  agentWorking = false,
  c,
  locale,
}: Props & { c: BrowserCopy; locale: Locale }) {
  const h = useBrowserWorkbench(agentId, active, agentWorking);
  const id = useId();
  const section = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const takeButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [dialog, setDialog] = useState<"close" | "review" | null>(null);
  const reviewSnapshot = useRef<BrowserReviewSnapshot | null>(null);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(false);
  const address = useForm({
    defaultValues: { address: h.local.address },
    resolver: zodResolver(
      z.object({
        address: z
          .string()
          .check(z.refine((v) => !!browserUrl(v), c.addressInvalid)),
      }),
    ),
  });
  const text = useForm({
    defaultValues: { text: h.local.text },
    resolver: zodResolver(
      z.object({
        text: z.string().check(z.refine(validBrowserText, c.textInvalid)),
      }),
    ),
  });
  const review = useForm({
    defaultValues: { checked: false },
    resolver: zodResolver(
      z.object({
        checked: z.boolean().check(z.refine((v) => v, c.reviewRequired)),
      }),
    ),
  });
  useEffect(() => {
    address.setValue("address", h.local.address);
    text.setValue("text", h.local.text);
  }, [h.local.address, h.local.text, address, text]);
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === section.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    },
    [active, h.canInput],
  );
  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  const other = h.control?.owner === "operator" && !h.owned;
  const owner = !h.control
    ? c.loading
    : h.owned
      ? c.ownerOperator
      : other
        ? c.ownerOther
        : c.ownerAgent;
  const pending = h.busy || h.local.request?.status === "pending";
  const uncertain = h.local.request?.status === "unknown" || h.local.damaged;
  const resolvedRecord =
    h.receipt && ["complete", "not_dispatched"].includes(h.receipt.state);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === section.current)
        await document.exitFullscreen();
      else if (section.current?.requestFullscreen)
        await section.current.requestFullscreen();
      else throw new Error("unsupported");
      setFullscreenError(false);
    } catch {
      setFullscreenError(true);
    }
  }
  const remoteKey = (key: string) => void h.input({ action: "keydown", key });
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") return;
    if (event.key === "Escape") {
      event.preventDefault();
      takeButton.current?.focus();
      return;
    }
    if (event.nativeEvent.isComposing || event.repeat || !h.canInput) return;
    if (
      [
        "Enter",
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    ) {
      event.preventDefault();
      remoteKey(event.key);
    }
  }
  function point(event: MouseEvent<HTMLDivElement>) {
    return h.view && frame.current
      ? browserPoint(
          event.clientX,
          event.clientY,
          frame.current.getBoundingClientRect(),
          h.view.width,
          h.view.height,
        )
      : null;
  }
  function click(event: MouseEvent<HTMLDivElement>, double = false) {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    if (!h.canInput) return;
    const p = point(event);
    if (!p) return;
    frame.current?.focus();
    if (double) void h.input({ action: "dblclick", ...p });
    else
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        void h.input({ action: "click", ...p });
      }, 300);
  }
  async function openReview() {
    if (!(await h.refresh())) return;
    reviewSnapshot.current = h.reviewSnapshot();
    focusOrigin.current = reviewButton.current;
    review.reset({ checked: false });
    setDialog("review");
  }

  return (
    <section
      ref={section}
      aria-label={`${c.title}: ${agentName}`}
      className="flex min-w-0 flex-col overflow-auto rounded-2xl border bg-card text-card-foreground fullscreen:rounded-none"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <header className="space-y-3 border-b p-[16px] sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="min-w-0 text-lg font-semibold">
            <span className="flex items-center gap-[8px]">
              <Globe2 className="size-[20px] shrink-0" aria-hidden="true" />
              <span>{c.title}</span>
            </span>
            <span
              className="block text-sm font-normal text-muted-foreground"
              dir="auto"
            >
              {agentName}
            </span>
          </h2>
          <Button
            className={button}
            variant="outline"
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? c.exitFullscreen : c.fullscreen}
          </Button>
          <Button
            className={button}
            variant="outline"
            disabled={!h.view?.pngBase64}
            onClick={() => setZoom((value) => !value)}
            aria-pressed={zoom}
          >
            {zoom ? c.zoomOut : c.zoomIn}
          </Button>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {c.help}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={takeButton}
            className={button}
            disabled={
              h.unavailable ||
              (!h.owned &&
                (h.blocked ||
                  other ||
                  !h.fresh ||
                  h.control?.agentActionInFlight))
            }
            onClick={() => void (h.owned ? h.release() : h.take())}
          >
            {h.owned ? c.release : c.take}
          </Button>
          <Button
            className={button}
            variant="outline"
            disabled={pending || h.reading || !active}
            onClick={() => void h.refresh()}
          >
            {c.refresh}
          </Button>
          <Button
            className={button}
            variant="outline"
            onClick={() => h.setLive(!h.live)}
            aria-pressed={!h.live}
          >
            {h.live ? c.pause : c.resume}
          </Button>
          <Button
            ref={closeButton}
            className={button}
            variant="outline"
            disabled={h.unavailable || !h.owned}
            onClick={() => {
              focusOrigin.current = closeButton.current;
              setDialog("close");
            }}
          >
            {c.close}
          </Button>
        </div>
        <p className="text-sm font-medium" role="status">
          {pending ? c.busy : owner}
        </p>
        {h.control?.agentActionInFlight && (
          <p className="text-sm text-muted-foreground">{c.agentBusy}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {h.live ? c.polling : c.paused}
          {h.received && (
            <>
              {" "}
              · {c.received}:{" "}
              <time dateTime={new Date(h.received).toISOString()}>
                {date.format(h.received)}
              </time>
            </>
          )}
        </p>
      </header>

      <div className="space-y-3 p-[16px] sm:p-4">
        {h.blocked && (
          <p
            className="rounded-lg border border-attention/30 bg-attention/10 p-3 text-sm"
            role="status"
          >
            {c.blocked}
          </p>
        )}
        {h.lost && (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
            role="alert"
          >
            {c.syncLost}
          </p>
        )}
        {h.notice && (
          <p
            role={h.notice === "error" ? "alert" : "status"}
            className="text-sm"
          >
            {c[h.notice]}
          </p>
        )}
        {fullscreenError && (
          <p role="alert" className="text-sm">
            {c.fullscreenError}
          </p>
        )}
        {h.local.storageError && (
          <div role="alert" className="space-y-2 rounded-lg border p-3">
            <p>{c.storageError}</p>
            <Button
              className={button}
              variant="outline"
              onClick={h.retryStorage}
            >
              {c.retryStorage}
            </Button>
          </div>
        )}
        {uncertain && (
          <div
            className="space-y-3 rounded-xl border border-attention/40 bg-attention/10 p-4"
            role="alert"
          >
            <h3 className="font-semibold">
              {h.local.damaged
                ? c.damaged
                : resolvedRecord
                  ? c.review
                  : c.unknown}
            </h3>
            {!resolvedRecord && (
              <p className="text-sm leading-relaxed">{c.unknownHelp}</p>
            )}
            <OperatorRecovery
              key={JSON.stringify(
                h.local.request
                  ? [
                      h.local.request.id,
                      h.local.request.agentId,
                      h.local.request.kind,
                      h.local.request.startedAt,
                      h.local.request.protocolVersion,
                    ]
                  : null,
              )}
              scope={
                h.local.request
                  ? {
                      agentId,
                      requestId: h.local.request.id,
                      kind: `browser_${h.local.request.kind}`,
                    }
                  : null
              }
              supported={h.local.request?.protocolVersion === 1}
              disabled={pending || !active}
              initialReceipt={h.receipt}
              onReceipt={(receipt) => {
                if (h.local.request) h.recordReceipt(h.local.request, receipt);
              }}
            />
            <Button
              ref={reviewButton}
              className={button}
              disabled={pending || h.reading || !active}
              onClick={() => void openReview()}
            >
              {c.review}
            </Button>
          </div>
        )}
        <ValidatedForm
          form={address}
          onSubmit={async (value) => {
            const target = browserUrl(value.address);
            if (!target) return;
            if (
              (await h.navigate(target)) &&
              browserLocalState(agentId).address === value.address
            )
              h.draft({ address: "" });
          }}
          className="space-y-2"
        >
          <label htmlFor={`${id}-address`} className="text-sm font-medium">
            {c.address}
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              {...address.register("address", {
                onChange: (event) => h.draft({ address: event.target.value }),
              })}
              id={`${id}-address`}
              aria-describedby={`${id}-address-error`}
              aria-invalid={!!address.formState.errors.address}
              className="min-h-11 min-w-0 flex-1 basis-44 text-base md:text-base"
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={h.view?.url || "https://"}
            />
            <Button className={button} type="submit" disabled={!h.canNavigate}>
              {c.go}
            </Button>
          </div>
          <p
            id={`${id}-address-error`}
            className="text-sm text-destructive"
            role={address.formState.errors.address ? "alert" : undefined}
          >
            {address.formState.errors.address?.message}
          </p>
        </ValidatedForm>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["back", "Alt+ArrowLeft"],
              ["forward", "Alt+ArrowRight"],
              ["reload", "F5"],
            ] as const
          ).map(([label, key]) => (
            <Button
              key={label}
              className={button}
              variant="outline"
              disabled={!h.canInput}
              onClick={() => remoteKey(key)}
            >
              {c[label]}
            </Button>
          ))}
        </div>
      </div>

      <figure className="min-w-0 border-y bg-muted/30">
        <div className="max-h-[70dvh] overflow-auto" dir="ltr">
          <div
            ref={frame}
            role="group"
            tabIndex={0}
            aria-label={`${c.imageLabel}: ${agentName}`}
            aria-describedby={`${id}-frame-help`}
            aria-disabled={!h.canInput}
            onClick={(event) => click(event)}
            onDoubleClick={(event) => click(event, true)}
            onKeyDown={key}
            className="relative flex min-h-52 w-full items-center justify-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            style={{
              width: zoom && h.view ? `${h.view.width}px` : "100%",
              aspectRatio: h.view
                ? `${h.view.width}/${h.view.height}`
                : "16/10",
            }}
          >
            {h.view?.pngBase64 ? (
              <img
                src={`data:image/png;base64,${h.view.pngBase64}`}
                alt={`${c.imageLabel}: ${agentName}`}
                draggable={false}
                className="absolute inset-0 h-full w-full select-none object-contain"
              />
            ) : (
              <p
                className="max-w-md p-6 text-center text-sm leading-relaxed text-muted-foreground"
                role="status"
              >
                {h.view ? c.empty : c.loading}
              </p>
            )}
          </div>
        </div>
        {h.view?.url && (
          <figcaption
            className="break-all border-t p-3 font-mono text-sm"
            dir="ltr"
          >
            {h.view.url}
          </figcaption>
        )}
      </figure>

      <div className="space-y-4 p-[16px] sm:p-4">
        <p
          id={`${id}-frame-help`}
          className="text-sm leading-relaxed text-muted-foreground"
        >
          {c.frameHelp}
        </p>
        <ValidatedForm
          form={text}
          onSubmit={async (value) => {
            if (composing.current) return;
            if (
              (await h.input({ action: "type_text", text: value.text })) &&
              browserLocalState(agentId).text === value.text
            )
              h.draft({ text: "" });
          }}
          className="space-y-2"
        >
          <label htmlFor={`${id}-text`} className="text-sm font-medium">
            {c.textLabel}
          </label>
          <Textarea
            {...text.register("text", {
              onChange: (event) => h.draft({ text: event.target.value }),
            })}
            id={`${id}-text`}
            dir="auto"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!text.formState.errors.text}
            aria-describedby={`${id}-text-help ${id}-text-error`}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            className="min-h-28 text-base md:text-base"
          />
          <p
            id={`${id}-text-help`}
            className="text-sm leading-relaxed text-muted-foreground"
          >
            {c.textHelp}
          </p>
          <p
            id={`${id}-text-error`}
            className="text-sm text-destructive"
            role={text.formState.errors.text ? "alert" : undefined}
          >
            {text.formState.errors.text?.message}
          </p>
          <Button className={button} type="submit" disabled={!h.canInput}>
            {c.send}
          </Button>
        </ValidatedForm>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["shiftTab", "Shift+Tab"],
              ["tab", "Tab"],
              ["enter", "Enter"],
              ["backspace", "Backspace"],
              ["escape", "Escape"],
              ["left", "ArrowLeft"],
              ["right", "ArrowRight"],
              ["up", "ArrowUp"],
              ["down", "ArrowDown"],
            ] as const
          ).map(([label, key]) => (
            <Button
              key={label}
              className={button}
              variant="outline"
              disabled={!h.canInput}
              onClick={() => remoteKey(key)}
            >
              {c[label]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["scrollUp", "scrollDown"] as const).map((label) => (
            <Button
              key={label}
              className={button}
              variant="outline"
              disabled={!h.canInput}
              onClick={() =>
                void h.input({
                  action: "wheel",
                  deltaX: 0,
                  deltaY: label === "scrollUp" ? -500 : 500,
                })
              }
            >
              {c[label]}
            </Button>
          ))}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {c.draftsHint}
        </p>
        {h.view && (
          <p className="text-sm text-muted-foreground">
            {h.view.visible ? c.windowVisible : c.windowHidden} ·{" "}
            <bdi>
              {h.view.width} × {h.view.height}
            </bdi>
          </p>
        )}
      </div>

      <AlertDialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null);
        }}
      >
        <AlertDialogContent
          portalContainer={fullscreen ? section.current : undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelButton.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const origin = focusOrigin.current;
            if (origin?.isConnected && !origin.hasAttribute("disabled"))
              origin.focus();
            else frame.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === "close" ? c.closeTitle : c.unknown}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "close" ? c.closeHelp : c.unknownHelp}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog === "review" ? (
            <ValidatedForm
              form={review}
              onSubmit={() => {
                if (h.finishReview(reviewSnapshot.current)) setDialog(null);
                else review.setError("checked", { message: c.reviewRequired });
              }}
              className="space-y-3"
            >
              <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed">
                <input
                  {...review.register("checked")}
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  aria-invalid={!!review.formState.errors.checked}
                  aria-describedby={`${id}-review-error`}
                />
                {c.reviewCheck}
              </label>
              <p
                id={`${id}-review-error`}
                className="text-sm text-destructive"
                role={review.formState.errors.checked ? "alert" : undefined}
              >
                {review.formState.errors.checked?.message}
              </p>
              <AlertDialogFooter>
                <Button
                  ref={cancelButton}
                  type="button"
                  className={button}
                  variant="outline"
                  onClick={() => setDialog(null)}
                >
                  {c.cancel}
                </Button>
                <Button type="submit" className={button}>
                  {c.reviewDone}
                </Button>
              </AlertDialogFooter>
            </ValidatedForm>
          ) : (
            <AlertDialogFooter>
              <Button
                ref={cancelButton}
                type="button"
                className={button}
                variant="outline"
                disabled={pending}
                onClick={() => setDialog(null)}
              >
                {c.cancel}
              </Button>
              <Button
                type="button"
                className={button}
                variant="destructive"
                disabled={pending || !h.owned}
                onClick={async () => {
                  if (await h.close()) setDialog(null);
                }}
              >
                {c.confirm}
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
