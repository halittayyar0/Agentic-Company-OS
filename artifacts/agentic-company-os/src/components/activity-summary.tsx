import { useLocale } from "./i18n/locale-provider";
import {
  activityOperationsEventKind,
  operationsEventMessageKeys,
  type OperationsEventKind,
} from "../lib/activity-summary";

type Props =
  | {
      event: { summary: string; type: string; detail?: unknown };
    }
  | {
      summary: string;
      kind: OperationsEventKind | null;
    };

/** Translate presentation only; the immutable source summary remains exportable. */
export function ActivitySummary(props: Props) {
  const { t } = useLocale();
  const summary = "event" in props ? props.event.summary : props.summary;
  const kind =
    "event" in props ? activityOperationsEventKind(props.event) : props.kind;
  return kind ? t(operationsEventMessageKeys[kind]) : summary;
}
