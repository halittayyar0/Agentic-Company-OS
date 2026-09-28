import {
  Component,
  useEffect,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import { recoveryCopy, recoveryLocale } from "@/lib/recovery-copy";

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

export function reportCaughtError(
  error: unknown,
  componentStack?: string | null,
): void {
  if (import.meta.env.DEV) console.error(error, componentStack);
  else console.error("A screen could not render. Use the recovery controls.");
}

function DefaultFallback({ error }: ErrorFallbackProps) {
  const locale = recoveryLocale();
  const c = recoveryCopy[locale];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const buttonClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <section
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      className="flex min-h-[70vh] w-full items-center justify-center bg-background p-4 sm:p-6"
    >
      <div className="w-full max-w-xl rounded-panel border bg-card p-5 sm:p-8">
        <AlertTriangle className="mb-4 text-muted-foreground" aria-hidden />
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight text-foreground"
        >
          {c.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{c.body}</p>
        {import.meta.env.DEV && (
          <details className="mt-5 rounded-control border">
            <summary className="min-h-11 cursor-pointer p-3 text-sm">
              {c.details}
            </summary>
            <pre
              dir="ltr"
              className="max-h-40 overflow-auto whitespace-pre-wrap break-all border-t p-3 text-xs"
            >
              {error.message || String(error)}
            </pre>
          </details>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={
              buttonClass +
              " bg-primary text-primary-foreground hover:bg-primary/90"
            }
          >
            <RotateCcw size={16} aria-hidden />
            {c.reload}
          </button>
          <button
            type="button"
            onClick={() => window.location.assign(import.meta.env.BASE_URL)}
            className={
              buttonClass + " bg-background text-foreground hover:bg-secondary"
            }
          >
            <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden />
            {c.home}
          </button>
        </div>
      </div>
    </section>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown): void {
    reportCaughtError(error);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
