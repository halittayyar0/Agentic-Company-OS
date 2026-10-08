import { useCustomizationCopy } from "@/lib/customization-copy";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, listAgents } from "@workspace/api-client-react";
import { useLocale } from "../i18n/locale-provider";
import { Button } from "../ui/button";
import { Link } from "wouter";

type Change = {
  id: string;
  taskId?: number | null;
  agentId: number;
  sourcePath: string;
  request: string;
  state: string;
  revision: number;
  baseCommit: string;
  candidateCommit: string | null;
  error: string | null;
  check: {
    output: string;
    passed: boolean;
    command: string[];
    commands?: string[][];
  } | null;
  diff?: string;
  status?: string;
};
const states = [
  "draft",
  "checking",
  "verified",
  "applying",
  "applied",
  "rolling_back",
  "rolled_back",
  "failed",
  "unknown",
  "preparing",
];
const initialCommands = JSON.stringify(
  [
    ["pnpm", "--dir", "{workspace}", "install", "--frozen-lockfile"],
    ["pnpm", "--dir", "{workspace}", "run", "typecheck"],
    ["pnpm", "--dir", "{workspace}", "test"],
  ],
  null,
  2,
);
const inputClass =
  "w-full min-h-11 rounded-lg border bg-background px-3 py-2 text-sm";
const sourceUrl = "/api/source-changes";
export function SourceWorkspaceSettings() {
  const { locale } = useLocale();
  const pack = useCustomizationCopy(locale);
  if (!pack.data) return <LanguagePackStatus error={pack.isError} />;
  return <SourceWorkspaceSettingsBody c={pack.data.source} />;
}
function SourceWorkspaceSettingsBody({ c }: { c: readonly string[] }) {
  const [opened, setOpened] = useState(false),
    [sourcePath, setSource] = useState(""),
    [agentId, setAgent] = useState(""),
    [request, setRequest] = useState("");
  const [selected, setSelected] = useState<Change | null>(null),
    [commands, setCommands] = useState(initialCommands),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<14 | 15 | 32 | null>(null);
  const active = useRef(false),
    requestId = useRef<string | null>(null);
  const changes = useQuery({
    queryKey: ["source-changes"],
    queryFn: () => customFetch<Change[]>(sourceUrl),
    enabled: opened,
    retry: false,
  });
  const agents = useQuery({
    queryKey: ["source-change-agents"],
    queryFn: () => listAgents(),
    enabled: opened,
    retry: false,
  });
  async function act(action: () => Promise<Change>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const row = await action();
      setSelected(row);
      setNotice(14);
      await changes.refetch();
    } catch (error) {
      const failure = error as {
        status?: unknown;
        data?: { code?: unknown } | null;
      } | null;
      setNotice(
        failure?.status === 409 && failure.data?.code === "SOURCE_CODING_ACTIVE"
          ? 32
          : 15,
      );
      await changes.refetch();
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const post = (url: string, body: unknown) =>
    customFetch<Change>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const status = (row: Change) =>
    c[states.includes(row.state) ? 22 + states.indexOf(row.state) : 30];
  const inspect = (id: string) =>
    act(() => customFetch<Change>(`${sourceUrl}/${id}`));
  const mutate = (action: "check" | "apply" | "rollback") =>
    act(() =>
      post(`${sourceUrl}/${selected!.id}/${action}`, {
        expectedRevision: selected!.revision,
        command: action === "check" ? JSON.parse(commands) : undefined,
      }),
    );
  function field(
    index: number,
    value: string,
    change: (value: string) => void,
    maxLength: number,
    Tag: "input" | "textarea",
    dir?: "ltr",
  ) {
    return (
      <label className="block space-y-1">
        <span>{c[index]}</span>
        <Tag
          className={inputClass}
          value={value}
          required
          maxLength={maxLength}
          dir={dir}
          disabled={busy}
          onChange={(event) => {
            change(event.target.value);
            requestId.current = null;
          }}
        />
      </label>
    );
  }
  const taskId = selected?.taskId ?? 0;
  return (
    <details
      className="space-y-4 rounded-panel border bg-card p-4 sm:p-6"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary className="cursor-pointer py-2 text-lg font-semibold">
        {c[0]}
      </summary>
      <p className="text-sm text-muted-foreground">{c[1]}</p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          requestId.current ??= crypto.randomUUID();
          void act(() =>
            post(sourceUrl, {
              id: requestId.current,
              agentId: Number(agentId),
              sourcePath,
              request,
            }),
          );
        }}
      >
        {field(2, sourcePath, setSource, 2048, "input", "ltr")}
        <label className="block space-y-1">
          <span>{c[3]}</span>
          <select
            className={inputClass}
            value={agentId}
            required
            disabled={busy}
            onChange={(event) => {
              setAgent(event.target.value);
              requestId.current = null;
            }}
          >
            <option value="">{c[21]}</option>
            {agents.data
              ?.filter(
                (agent) => agent.isActive && agent.permissions?.canUseTerminal,
              )
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
          </select>
        </label>
        {field(4, request, setRequest, 4000, "textarea")}
        <Button disabled={busy || !agentId} type="submit">
          {busy ? c[13] : c[5]}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{c[6]}</h3>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void (selected ? inspect(selected.id) : changes.refetch())
          }
        >
          {c[12]}
        </Button>
      </div>
      {(changes.isError || agents.isError) && <p role="alert">{c[15]}</p>}
      {changes.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">{c[16]}</p>
      )}
      <ul className="space-y-2">
        {changes.data?.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm">{row.request}</p>
              <p className="text-xs text-muted-foreground">{status(row)}</p>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void inspect(row.id)}
            >
              {c[7]}
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">
            {c[20]}: {status(selected)}
          </p>
          <p className="text-xs break-all" dir="ltr">
            {selected.sourcePath}
          </p>
          {selected.error && (
            <code className="block text-xs" dir="ltr">
              {selected.error}
            </code>
          )}
          {selected.diff !== undefined && (
            <pre
              className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs"
              dir="ltr"
            >
              {selected.diff || selected.status}
            </pre>
          )}
          {["draft", "verified"].includes(selected.state) && (
            <>
              <label className="block space-y-1">
                <span>{c[8]}</span>
                <textarea
                  className={inputClass + " min-h-40 font-mono"}
                  dir="ltr"
                  value={commands}
                  disabled={busy}
                  onChange={(event) => setCommands(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">{c[18]}</p>
              <Button disabled={busy} onClick={() => void mutate("check")}>
                {c[9]}
              </Button>
            </>
          )}
          {selected.check && (
            <details>
              <summary className="cursor-pointer py-2 text-sm">{c[19]}</summary>
              <pre
                dir="ltr"
                className="max-h-72 overflow-auto whitespace-pre-wrap bg-muted p-3 text-xs"
              >
                {JSON.stringify(
                  selected.check.commands ?? [selected.check.command],
                ) +
                  "\n" +
                  selected.check.output}
              </pre>
            </details>
          )}
          <p className="text-xs text-muted-foreground">{c[17]}</p>
          {["verified", "applied"].includes(selected.state) && (
            <Button
              variant={selected.state === "applied" ? "outline" : "default"}
              disabled={busy}
              onClick={() =>
                void mutate(selected.state === "applied" ? "rollback" : "apply")
              }
            >
              {c[selected.state === "applied" ? 11 : 10]}
            </Button>
          )}
        </div>
      )}
      {notice !== null && (
        <p role={notice === 14 ? "status" : "alert"} className="text-sm">
          {c[notice]}
          {Number.isSafeInteger(taskId) && taskId > 0 && (
            <Link
              href={`/tasks/${taskId}`}
              className="ms-2 inline-flex min-h-11 underline"
            >
              {c[33]}
            </Link>
          )}
        </p>
      )}
    </details>
  );
}
