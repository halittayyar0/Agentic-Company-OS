import { useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { Button } from "@/components/ui/button";
import { loadResultFormatCopy } from "@/lib/task-result-format-copy";
import {
  resultFormatInputSchema,
  type ResultFormat,
} from "@/lib/task-result-format-input";

export default function ResultFormatChoice({
  value,
  onChange,
  onBlockedChange,
  onReload,
}: {
  value: ResultFormat;
  onChange?: (value: ResultFormat) => void;
  onBlockedChange?: (blocked: boolean) => void;
  onReload: () => void;
}) {
  const { locale } = useLocale();
  const id = useId();
  const copy = useQuery({
    queryKey: ["result-format-copy", locale],
    queryFn: () => loadResultFormatCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const valid = resultFormatInputSchema.safeParse(value).success;
  useEffect(
    () => onBlockedChange?.(!copy.data || !valid),
    [copy.data, valid, onBlockedChange],
  );
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        className="mt-4"
        onRetry={onReload}
      />
    );
  const c = copy.data;
  return (
    <section
      aria-label={onChange ? c.title : c.saved}
      className="mt-4 min-w-0 space-y-3 rounded-panel border border-border bg-card p-4 text-sm [overflow-wrap:anywhere]"
    >
      <h3 className="font-semibold">{onChange ? c.title : c.saved}</h3>
      <p className="text-muted-foreground">{c.help}</p>
      {onChange && (
        <label className="flex min-h-11 flex-wrap items-center gap-3">
          <span>{c.title}</span>
          <select
            value={value ? "table" : "plain"}
            onChange={(event) =>
              onChange(
                event.target.value === "table"
                  ? { kind: "table", columns: [...c.defaults] }
                  : null,
              )
            }
            className="min-h-11 min-w-0 max-w-full rounded-control border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="plain">{c.plain}</option>
            <option value="table">{c.table}</option>
          </select>
        </label>
      )}
      {value && (
        <fieldset className="min-w-0 space-y-2">
          <legend className="mb-2 font-medium">{c.columns}</legend>
          {value.columns.map((heading, index) => (
            <div
              key={index}
              className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-end"
            >
              {onChange ? (
                <label htmlFor={`${id}-${index}`} className="min-w-0 flex-1">
                  <span className="mb-1 block">
                    {c.columns}{" "}
                    {new Intl.NumberFormat(locale).format(index + 1)}
                  </span>
                  <input
                    id={`${id}-${index}`}
                    value={heading}
                    maxLength={80}
                    aria-invalid={!valid}
                    aria-describedby={!valid ? `${id}-error` : undefined}
                    onChange={(event) =>
                      onChange({
                        kind: "table",
                        columns: value.columns.map((old, position) =>
                          position === index ? event.target.value : old,
                        ),
                      })
                    }
                    className="min-h-11 w-full min-w-0 rounded-control border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
              ) : (
                <bdi className="min-w-0 flex-1 rounded-control border border-border p-3">
                  {heading}
                </bdi>
              )}
              {onChange && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 h-auto w-full max-w-full whitespace-normal sm:w-auto sm:max-w-[45%]"
                  disabled={value.columns.length <= 2}
                  aria-label={`${c.remove} ${index + 1}`}
                  onClick={() =>
                    onChange({
                      kind: "table",
                      columns: value.columns.filter(
                        (_, position) => position !== index,
                      ),
                    })
                  }
                >
                  {c.remove}
                </Button>
              )}
            </div>
          ))}
          {onChange && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 h-auto max-w-full whitespace-normal"
              disabled={value.columns.length >= 8}
              onClick={() =>
                onChange({ kind: "table", columns: [...value.columns, ""] })
              }
            >
              {c.add}
            </Button>
          )}
        </fieldset>
      )}
      {value && (
        <pre
          dir="ltr"
          aria-label={c.table}
          className="whitespace-pre-wrap break-all rounded-control border border-border bg-background p-3 text-xs"
        >
          <code>{`| ${value.columns.map((heading) => heading.replaceAll("\\", "\\\\").replaceAll("|", "\\|")).join(" | ")} |\n| ${value.columns.map(() => "---").join(" | ")} |`}</code>
        </pre>
      )}
      {!valid && (
        <p id={`${id}-error`} role="alert" className="text-attention">
          {c.invalid}
        </p>
      )}
    </section>
  );
}
