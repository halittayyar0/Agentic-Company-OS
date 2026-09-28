import { useCustomizationCopy } from "@/lib/customization-copy";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getExecutionPolicy,
  updateExecutionPolicy,
  type ExecutionPolicy,
  type CustomExecutionPermissions,
} from "@workspace/api-client-react";
import { useLocale } from "../i18n/locale-provider";
import { Button } from "../ui/button";

const queryKey = ["settings", "execution-policy"];
const customKeys = [
  "files",
  "terminal",
  "browser",
  "delegation",
  "sudo",
] as const;
const emptyCustom: CustomExecutionPermissions = {
  files: false,
  terminal: false,
  browser: false,
  delegation: false,
  sudo: false,
};

export function ExecutionPolicySettings() {
  const { locale } = useLocale();
  const pack = useCustomizationCopy(locale);
  if (!pack.data) return <LanguagePackStatus error={pack.isError} />;
  return <ExecutionPolicySettingsBody c={pack.data.policy} />;
}
function ExecutionPolicySettingsBody({ c }: { c: readonly string[] }) {
  const client = useQueryClient();
  const policy = useQuery({
    queryKey,
    queryFn: () => getExecutionPolicy(),
    retry: false,
  });
  const [mode, setMode] = useState<ExecutionPolicy["mode"]>("approval");
  const [custom, setCustom] = useState<CustomExecutionPermissions>(emptyCustom);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "error" | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (policy.data) {
      setMode(policy.data.mode);
      setCustom(policy.data.custom ?? emptyCustom);
    }
  }, [policy.data]);
  async function save() {
    if (inFlight.current || !policy.data) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await updateExecutionPolicy({
        mode,
        expectedRevision: policy.data.revision,
        ...(mode === "custom" ? { custom } : {}),
      });
      client.setQueryData(queryKey, saved);
      setNotice("saved");
    } catch {
      setNotice("error");
      await policy.refetch();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-4 rounded-panel border bg-card p-4 sm:p-6"
      aria-labelledby="execution-policy-title"
    >
      <h2 id="execution-policy-title" className="text-lg font-semibold">
        {c[0]}
      </h2>
      {policy.data ? (
        <>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{c[0]}</legend>
            {(["read_only", "approval", "full_access", "custom"] as const).map(
              (value, index) => (
                <label
                  key={value}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="execution-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      setNotice(null);
                    }}
                    className="size-4 accent-primary"
                  />
                  <span>{c[index + 1]}</span>
                </label>
              ),
            )}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            {mode === "full_access"
              ? c[15]
              : mode === "read_only"
                ? c[16]
                : c[17]}
          </p>
          {mode === "custom" && (
            <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">{c[4]}</legend>
              {customKeys.map((key, index) => (
                <label key={key} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={custom[key]}
                    onChange={(event) =>
                      setCustom({ ...custom, [key]: event.target.checked })
                    }
                    className="size-4 accent-primary"
                  />
                  {c[index + 5]}
                </label>
              ))}
            </fieldset>
          )}
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? c[11] : c[10]}
          </Button>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {policy.isError ? c[13] : c[11]}
        </p>
      )}
      {(notice || policy.isError) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <span>{notice === "saved" ? c[12] : c[13]}</span>
          {notice !== "saved" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void policy.refetch()}
            >
              {c[14]}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
