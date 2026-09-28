import { LanguagePackStatus } from "../i18n/language-pack-status";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getOperatorRequest,
  type OperatorRequestReceipt,
} from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { loadOperatorCopy } from "@/lib/operator-copy";
import {
  readOperatorReceipt,
  type OperatorScope,
} from "@/lib/operator-request";

const button = "min-h-11 whitespace-normal text-start md:min-h-11";
type Props = {
  scope: OperatorScope | null;
  supported: boolean;
  disabled?: boolean;
  initialReceipt?: OperatorRequestReceipt | null;
  onReceipt?: (receipt: OperatorRequestReceipt) => void;
  prepareReview?: () => (() => boolean) | null;
};
/** Mounted with a key bound to the complete original local request, never just its UUID. */
export function OperatorRecovery({
  scope,
  supported,
  disabled = false,
  initialReceipt,
  onReceipt,
  prepareReview,
}: Props) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["operator-copy", locale],
    queryFn: () => loadOperatorCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const [receipt, setReceipt] = useState<OperatorRequestReceipt | null>(
    initialReceipt ?? null,
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<"missing" | "error" | null>(null);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [changed, setChanged] = useState(false);
  const commit = useRef<(() => boolean) | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (initialReceipt) setReceipt(initialReceipt);
  }, [initialReceipt]);
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        as="div"
        className="space-y-2 text-sm"
        buttonClassName={button}
        onRetry={() => void copy.refetch()}
      />
    );
  const c = copy.data;
  async function check() {
    if (!scope || !supported || disabled || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setError(null);
    try {
      const next = readOperatorReceipt(
        await getOperatorRequest(scope.agentId, scope.requestId, {
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        }),
        scope,
      );
      if (!alive.current) return;
      setReceipt(next);
      onReceipt?.(next);
    } catch (error) {
      if (alive.current)
        setError(
          error &&
            typeof error === "object" &&
            "status" in error &&
            error.status === 404
            ? "missing"
            : "error",
        );
    } finally {
      inFlight.current = false;
      if (alive.current) setChecking(false);
    }
  }
  return (
    <div ref={root} tabIndex={-1} className="space-y-3 text-sm leading-6">
      {scope && !supported && <p>{c.legacy}</p>}
      {scope && supported && (
        <>
          <p>{c.help}</p>
          <Button
            className={button}
            variant="outline"
            disabled={disabled || checking}
            aria-busy={checking}
            onClick={() => void check()}
          >
            {checking ? c.checking : c.check}
          </Button>
          {receipt && (
            <div role="status">
              <p>{c[receipt.state]}</p>
              {receipt.resultAvailability === "unavailable" && (
                <p>{c.unavailable}</p>
              )}
              {scope.kind.startsWith("browser_") && <p>{c.browser}</p>}
            </div>
          )}
          {error && <p role="alert">{c[error]}</p>}
        </>
      )}
      {prepareReview && (
        <>
          <Button
            ref={trigger}
            variant="outline"
            className={button}
            disabled={disabled || checking}
            onClick={() => {
              commit.current = prepareReview();
              setChecked(false);
              setChanged(!commit.current);
              setOpen(true);
            }}
          >
            {c.review}
          </Button>
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogContent
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                cancel.current?.focus();
              }}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                if (trigger.current?.isConnected) trigger.current.focus();
                else root.current?.focus();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>{c.review}</AlertDialogTitle>
                <AlertDialogDescription>{c.reviewHelp}</AlertDialogDescription>
              </AlertDialogHeader>
              <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                {c.reviewCheck}
              </label>
              {changed && (
                <p role="alert" className="text-sm">
                  {c.changed}
                </p>
              )}
              <AlertDialogFooter>
                <Button
                  ref={cancel}
                  variant="outline"
                  className={button}
                  onClick={() => setOpen(false)}
                >
                  {c.cancel}
                </Button>
                <Button
                  className={button}
                  disabled={!checked || disabled}
                  onClick={() => {
                    if (commit.current?.()) setOpen(false);
                    else setChanged(true);
                  }}
                >
                  {c.finish}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
