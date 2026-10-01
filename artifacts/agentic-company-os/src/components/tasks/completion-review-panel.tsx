import { useLocale } from "@/components/i18n/locale-provider";
import type { CompletionReviewView } from "@/lib/completion-review-view";
import type { TraceCopy } from "@/lib/trace-copy";
import { studioText } from "@/lib/project-studio-copy";

export function CompletionReviewPanel({
  evidence,
  recordId,
  copy,
}: {
  evidence: CompletionReviewView;
  recordId: number;
  copy: TraceCopy;
}) {
  const { locale } = useLocale();
  const c = copy.reviewEvidence;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const decision = (
    value: "confirmed_applied" | "confirmed_not_applied" | null,
  ) =>
    value === "confirmed_applied"
      ? c.confirmedApplied
      : value === "confirmed_not_applied"
        ? c.confirmedNotApplied
        : null;
  const limited = (shown: number, total: number) =>
    studioText(c.limited, { shown: number(shown), total: number(total) });
  return (
    <section
      aria-label={`${c.title} #${recordId}`}
      className="min-w-0 space-y-4 rounded-xl border border-border bg-secondary/30 p-3 sm:p-4"
    >
      <header className="space-y-2">
        <h5 className="text-base font-semibold">{c.title}</h5>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {c.help}
        </p>
      </header>
      <dl className="grid gap-3 min-[480px]:grid-cols-3">
        {[
          [c.cycle, evidence.cycleNumber],
          [c.operations, evidence.receiptTotal],
          [c.children, evidence.childTotal],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-base font-semibold">
              <bdi>{number(value as number)}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {evidence.receiptTotal === 0 && evidence.childTotal === 0 ? (
        <p className="text-sm text-muted-foreground">{c.empty}</p>
      ) : (
        <div className="space-y-2">
          <h6 className="font-medium">{c.counts}</h6>
          <p className="text-sm text-muted-foreground">{c.countsHelp}</p>
          <dl className="space-y-2">
            {evidence.receiptCounts.map((row) => (
              <div
                key={`${row.state}:${row.reconciliationDecision}`}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <dt>
                  {c.operations} · {c.states[row.state]}
                  {decision(row.reconciliationDecision)
                    ? ` · ${decision(row.reconciliationDecision)}`
                    : ""}
                </dt>
                <dd className="shrink-0 font-medium">
                  <bdi>{number(row.count)}</bdi>
                </dd>
              </div>
            ))}
            {evidence.childCounts.map((row) => (
              <div
                key={row.status}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <dt>
                  {c.children} · {c.states[row.status]}
                </dt>
                <dd className="shrink-0 font-medium">
                  <bdi>{number(row.count)}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {(evidence.receipts.length > 0 || evidence.receiptsTruncated) && (
        <div className="space-y-2">
          <h6 className="font-medium">{c.receipts}</h6>
          {evidence.receiptsTruncated && (
            <p className="text-sm text-muted-foreground">
              {limited(evidence.receipts.length, evidence.receiptTotal)}
            </p>
          )}
          <ul className="space-y-2">
            {evidence.receipts.map((receipt) => (
              <li
                key={receipt.id}
                className="min-w-0 space-y-1 rounded-lg border border-border p-3 text-sm [overflow-wrap:anywhere]"
              >
                <p className="font-medium">
                  <bdi>{receipt.tool}</bdi> · {c.states[receipt.state]}
                </p>
                <p>
                  {receipt.executionKind === "approved_action"
                    ? c.approvedAction
                    : c.taskStep}
                </p>
                {decision(receipt.reconciliationDecision) && (
                  <p>{decision(receipt.reconciliationDecision)}</p>
                )}
                {typeof receipt.ok === "boolean" && (
                  <p>
                    {c.resultFlag}: {receipt.ok ? copy.yes : copy.no}
                  </p>
                )}
                {receipt.exitCode !== undefined && (
                  <p>
                    {copy.fields.exitCode}:{" "}
                    <bdi>{number(receipt.exitCode)}</bdi>
                  </p>
                )}
                <p className="font-mono text-muted-foreground">
                  <bdi>{receipt.id}</bdi>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(evidence.children.length > 0 || evidence.childrenTruncated) && (
        <div className="space-y-2">
          <h6 className="font-medium">{c.childSample}</h6>
          {evidence.childrenTruncated && (
            <p className="text-sm text-muted-foreground">
              {limited(evidence.children.length, evidence.childTotal)}
            </p>
          )}
          <ul className="space-y-2 text-sm">
            {evidence.children.map((child) => (
              <li key={child.id}>
                <bdi>#{child.id}</bdi> · {c.states[child.status]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
