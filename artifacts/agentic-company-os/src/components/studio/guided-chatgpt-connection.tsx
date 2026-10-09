import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetModelCatalogQueryKey,
  type ChatGPTAccount,
} from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import type { ConnectionCopy } from "@/lib/connection-copy";
import { connectionError } from "@/lib/connection-api";
import {
  readChatGPTConnection,
  beginChatGPTConnection,
  readChatGPTAttempt,
  cancelChatGPTAttempt,
  confirmChatGPTAttempt,
  selectChatGPTConnection,
} from "@/lib/chatgpt-connection-api";

// This reference contains no authorization URL or credential. It survives
// closing/navigating in this tab so a pending attempt is inspected, not replaced.
let ownedAttempt: { id: string; expiresAt: number } | null = null;
let unknownBeginUntil = 0;
const accountsKey = ["guided-chatgpt-accounts"] as const;
const handoffGuide =
  "https://github.com/halittayyar0/Agentic-Company-OS/blob/main/docs/chatgpt-connection.md";
export default function GuidedChatGPTConnection({ c }: { c: ConnectionCopy }) {
  const { t } = useLocale();
  const id = useId(),
    client = useQueryClient(),
    guard = useRef(false);
  const [attempt, setAttempt] = useState(ownedAttempt);
  const [authorization, setAuthorization] = useState<string | null>(null);
  const [sameComputer, setSameComputer] = useState(false),
    [handoff, setHandoff] = useState(false);
  const [busy, setBusy] = useState(false),
    [needsReview, setNeedsReview] = useState(false);
  const [notice, setNotice] = useState<
    "unknown" | "connected" | "ended" | null
  >(unknownBeginUntil > Date.now() ? "unknown" : null);
  const accounts = useQuery({
    queryKey: accountsKey,
    queryFn: ({ signal }) => readChatGPTConnection(signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const status = useQuery({
    queryKey: ["guided-chatgpt-attempt", attempt?.id],
    queryFn: ({ signal }) => readChatGPTAttempt(attempt!.id, signal),
    enabled: !!attempt,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      attempt &&
      Date.now() < attempt.expiresAt &&
      ["pending", "exchanging"].includes(query.state.data?.state ?? "") &&
      !busy
        ? 3000
        : false,
  });
  const blocked =
    busy ||
    needsReview ||
    accounts.isError ||
    accounts.isFetching ||
    !accounts.data ||
    (!!attempt && (status.isError || status.isFetching));
  const s = status.data;
  const activeAttempt =
    !!attempt &&
    (!s || ["pending", "exchanging", "review", "confirming"].includes(s.state));
  const refresh = async () => {
    if (guard.current) return;
    const current = await accounts.refetch();
    const inspected = attempt ? await status.refetch() : null;
    if (!current.isError && (!inspected || !inspected.isError)) {
      setNeedsReview(false);
      if (notice === "unknown" && unknownBeginUntil <= Date.now())
        setNotice(null);
    }
    await client.invalidateQueries({ queryKey: getGetModelCatalogQueryKey() });
  };
  const perform = async (action: () => Promise<void>) => {
    if (guard.current || blocked) return;
    guard.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch {
      setNotice("unknown");
      setNeedsReview(true);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const begin = (account?: ChatGPTAccount, requestPlanPermission = false) =>
    void perform(async () => {
      if (!sameComputer || activeAttempt || unknownBeginUntil > Date.now())
        return;
      setAuthorization(null);
      unknownBeginUntil = Date.now() + 10 * 60_000;
      try {
        const result = await beginChatGPTConnection({
          callbackLocation: "same-computer",
          ...(account
            ? {
                registrationId: account.id,
                ...(requestPlanPermission
                  ? { requestPlanPermission: true }
                  : {}),
              }
            : {}),
        });
        ownedAttempt = { id: result.attemptId, expiresAt: result.expiresAt };
        setAttempt(ownedAttempt);
        unknownBeginUntil = 0;
        setAuthorization(result.authorizeUrl);
      } catch (error) {
        if (connectionError(error) === 422) {
          unknownBeginUntil = 0;
          setHandoff(true);
          return;
        }
        throw error;
      }
    });
  const select = (account: ChatGPTAccount) =>
    void perform(async () => {
      await selectChatGPTConnection(account);
      const current = await accounts.refetch();
      if (current.isError || current.data?.activeRegistrationId !== account.id)
        throw new Error("Unconfirmed account selection");
      await client.invalidateQueries({
        queryKey: getGetModelCatalogQueryKey(),
      });
    });
  return (
    <section
      className="min-w-0 space-y-4"
      aria-busy={busy || accounts.isFetching}
    >
      <h3 className="font-semibold">{c.accounts}</h3>
      {accounts.isPending ? <p role="status">{t("loadingScreen")}</p> : null}
      {accounts.isError || status.isError ? (
        <p role="alert">{c.unknown}</p>
      ) : null}
      {accounts.data?.registrations.length === 0 ? (
        <p className="text-sm text-muted-foreground">{c.noAccounts}</p>
      ) : null}
      <ul className="space-y-3">
        {accounts.data?.registrations.map((account) => (
          <li
            key={account.id}
            className="min-w-0 space-y-2 rounded-control border p-3"
          >
            <p className="text-sm font-medium [overflow-wrap:anywhere]">
              <bdi>{account.email ?? account.displayName ?? account.id}</bdi>
            </p>
            {accounts.data.activeRegistrationId === account.id ? (
              <p className="text-sm font-semibold">{c.selected}</p>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={blocked || !account.signedIn}
                onClick={() => select(account)}
              >
                {c.select}
              </Button>
            )}
            <p className="text-sm leading-6 text-muted-foreground">
              {!account.signedIn
                ? c.signedOut
                : account.planPause
                  ? c.paused
                  : account.canUsePlan
                    ? c.planReady
                    : c.identityOnly}
            </p>
            {!account.signedIn ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={
                  blocked ||
                  !sameComputer ||
                  activeAttempt ||
                  unknownBeginUntil > Date.now()
                }
                onClick={() => begin(account)}
              >
                {c.signInAgain}
              </Button>
            ) : !account.canUsePlan ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={
                  blocked ||
                  !sameComputer ||
                  activeAttempt ||
                  unknownBeginUntil > Date.now()
                }
                onClick={() => begin(account, true)}
              >
                {c.enablePlan}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <label
        htmlFor={id}
        className="flex min-h-11 items-center gap-3 text-sm leading-6"
      >
        <input
          id={id}
          type="checkbox"
          className="size-5 shrink-0 accent-primary"
          checked={sameComputer}
          disabled={busy}
          onChange={(event) => setSameComputer(event.target.checked)}
        />
        {c.sameComputer}
      </label>
      <Button
        type="button"
        className="min-h-11"
        disabled={
          blocked ||
          !sameComputer ||
          activeAttempt ||
          unknownBeginUntil > Date.now()
        }
        onClick={() => begin()}
      >
        {c.signIn}
      </Button>
      {authorization && (!s || ["pending", "exchanging"].includes(s.state)) ? (
        <a
          href={authorization}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {c.officialLink}
        </a>
      ) : null}
      {attempt ? (
        <div className="space-y-3 rounded-control border p-3 text-sm leading-6">
          <p role="status">
            {s?.state === "review"
              ? c.review
              : s?.state === "connected"
                ? c.connected
                : s &&
                    ["denied", "expired", "cancelled", "failed"].includes(
                      s.state,
                    )
                  ? c.ended
                  : c.pending}
          </p>
          {s?.state === "review" && s.proposedAccount ? (
            <>
              <p className="[overflow-wrap:anywhere]">
                <bdi>
                  {s.proposedAccount.email ??
                    s.proposedAccount.displayName ??
                    s.proposedAccount.id}
                </bdi>
              </p>
              <p>
                {s.proposedAccount.canUsePlan ? c.planReady : c.identityOnly}
              </p>
              <Button
                type="button"
                className="min-h-11"
                disabled={blocked}
                onClick={() =>
                  void perform(async () => {
                    await confirmChatGPTAttempt(
                      attempt.id,
                      s.expectedRevision!,
                      s.proposedAccount!,
                    );
                    ownedAttempt = null;
                    setAttempt(null);
                    setAuthorization(null);
                    setNotice("connected");
                    const current = await accounts.refetch();
                    if (current.isError) setNeedsReview(true);
                  })
                }
              >
                {c.confirm}
              </Button>
            </>
          ) : null}
          {activeAttempt ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy || status.isFetching}
              onClick={() =>
                void perform(async () => {
                  await cancelChatGPTAttempt(attempt.id);
                  ownedAttempt = null;
                  setAttempt(null);
                  setAuthorization(null);
                  setNotice("ended");
                })
              }
            >
              {c.cancel}
            </Button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p
          role={notice === "unknown" ? "alert" : "status"}
          className="text-sm leading-6"
        >
          {c[notice]}
        </p>
      ) : null}
      {attempt &&
      ((s &&
        ["denied", "cancelled", "expired", "failed", "connected"].includes(
          s.state,
        )) ||
        (connectionError(status.error) === 404 &&
          Date.now() >= attempt.expiresAt)) ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy || status.isFetching}
          onClick={() => {
            ownedAttempt = null;
            setAttempt(null);
            setAuthorization(null);
            setNeedsReview(false);
            setNotice(null);
          }}
        >
          {c.clearAttempt}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={busy || accounts.isFetching || status.isFetching}
        onClick={() => void refresh()}
      >
        {c.refresh}
      </Button>
      <details
        open={handoff || !sameComputer}
        className="min-w-0 rounded-control border p-3 text-sm leading-6"
      >
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          {c.handoffTitle}
        </summary>
        <p>{c.handoffText}</p>
        <a
          href={handoffGuide}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          {c.handoffGuide}
        </a>
        <pre
          dir="ltr"
          className="mt-2 overflow-x-auto rounded-control bg-muted p-3 text-xs"
        >
          pnpm connect:chatgpt prepare-target
        </pre>
      </details>
    </section>
  );
}
