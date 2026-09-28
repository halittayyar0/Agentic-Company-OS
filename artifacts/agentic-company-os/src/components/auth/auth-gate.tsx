import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/i18n/locale-provider";
import { loadAuthCopy, type AuthCopy } from "@/lib/auth-copy";
import {
  ControlPlaneError,
  getAuthStatus,
  login,
  logout,
  type AuthStatus,
} from "@/lib/auth";

const AUTH_QUERY_KEY = ["auth-status"] as const;

interface AuthContextValue {
  enabled: boolean;
  sessionExpiresAt: string | null;
  logout: () => Promise<void>;
  logoutPending: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthGate");
  return value;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: getAuthStatus,
    retry: false,
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      removeProtectedQueries(queryClient);
      queryClient.setQueryData<AuthStatus>(AUTH_QUERY_KEY, {
        enabled: true,
        authenticated: false,
        sessionExpiresAt: null,
      });
    },
  });

  const status = statusQuery.data;

  useEffect(() => {
    const onUnauthorized = () => {
      removeProtectedQueries(queryClient);
      queryClient.setQueryData<AuthStatus>(AUTH_QUERY_KEY, {
        enabled: true,
        authenticated: false,
        sessionExpiresAt: null,
      });
    };
    window.addEventListener("agenticos:unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("agenticos:unauthorized", onUnauthorized);
  }, [queryClient]);

  useEffect(() => {
    if (!status?.enabled || !status.authenticated || !status.sessionExpiresAt)
      return;
    const expiresAt = Date.parse(status.sessionExpiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const delay = Math.max(
      0,
      Math.min(expiresAt - Date.now() + 250, 2_147_000_000),
    );
    const timer = window.setTimeout(() => void statusQuery.refetch(), delay);
    return () => window.clearTimeout(timer);
  }, [status?.authenticated, status?.enabled, status?.sessionExpiresAt]);

  useEffect(() => {
    if (status?.enabled && !status.authenticated) {
      removeProtectedQueries(queryClient);
    }
  }, [queryClient, status?.authenticated, status?.enabled]);

  if (statusQuery.isPending) return <AuthLoading />;
  if (statusQuery.isError || !status) {
    return (
      <AuthCopyBoundary>
        {(copy) => (
          <AuthUnavailable
            copy={copy}
            retry={() => void statusQuery.refetch()}
            retrying={statusQuery.isFetching}
          />
        )}
      </AuthCopyBoundary>
    );
  }
  if (status.enabled && !status.authenticated) {
    return (
      <AuthCopyBoundary>
        {(copy) => (
          <LoginScreen
            copy={copy}
            onAuthenticated={(next) =>
              queryClient.setQueryData(AUTH_QUERY_KEY, next)
            }
          />
        )}
      </AuthCopyBoundary>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        enabled: status.enabled,
        sessionExpiresAt: status.sessionExpiresAt,
        logout: async () => logoutMutation.mutateAsync(),
        logoutPending: logoutMutation.isPending,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function removeProtectedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  queryClient.removeQueries({
    // Language files contain public UI text, and must survive a 401 so the
    // mounted sign-in screen can explain it without losing its loading query.
    predicate: (query) =>
      query.queryKey[0] !== AUTH_QUERY_KEY[0] &&
      query.queryKey[0] !== "auth-copy",
  });
}

function LoginScreen({
  onAuthenticated,
  copy,
}: {
  onAuthenticated: (status: AuthStatus) => void;
  copy: AuthCopy;
}) {
  const [token, setToken] = useState("");
  const loginMutation = useMutation({ mutationFn: login });
  const errorId = loginMutation.isError ? "login-error" : undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = token.trim();
    if (!normalized || loginMutation.isPending) return;
    // Keep the operator secret only long enough to build this one request.
    // Clearing before the await also removes it from the DOM on failed login.
    setToken("");
    try {
      const status = await loginMutation.mutateAsync(normalized);
      if (!status.authenticated) {
        throw new Error(copy.invalidSession);
      }
      onAuthenticated(status);
    } catch {
      // The mutation exposes only the safe server error below.
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background p-[16px] [overflow-wrap:anywhere] sm:p-8">
      <section
        className="relative z-10 min-w-0 w-full max-w-md overflow-hidden rounded-md border border-border bg-card px-[24px] py-6 sm:p-9"
        aria-labelledby="login-title"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary" />
        <span className="mb-6 flex size-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Building2 size={21} aria-hidden />
        </span>
        <p className="font-mono text-[12px] font-bold uppercase tracking-[0.24em] text-primary/80">
          {copy.badge}
        </p>
        <h1
          id="login-title"
          className="mt-2 text-2xl font-extrabold tracking-tight"
        >
          {copy.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {copy.description}
        </p>

        <form className="mt-7 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="access-token">{copy.accessKey}</Label>
            <div className="relative">
              <KeyRound
                aria-hidden
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="access-token"
                type="password"
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  if (loginMutation.isError) loginMutation.reset();
                }}
                autoComplete="off"
                autoFocus
                required
                spellCheck={false}
                aria-describedby={errorId}
                aria-invalid={loginMutation.isError}
                className="h-11 ps-10 font-mono"
              />
            </div>
          </div>

          {loginMutation.isError ? (
            <p
              id="login-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {loginMutation.error instanceof ControlPlaneError &&
              loginMutation.error.status === 401
                ? copy.invalidKey
                : copy.loginFailed}
            </p>
          ) : null}

          <Button
            type="submit"
            className="h-auto min-h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90 max-sm:gap-[8px] max-sm:px-[12px]"
            disabled={!token.trim() || loginMutation.isPending}
          >
            {loginMutation.isPending ? (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <KeyRound className="size-4" aria-hidden />
            )}
            {loginMutation.isPending ? copy.verifying : copy.signIn}
          </Button>
        </form>
      </section>
    </main>
  );
}

function AuthLoading() {
  const { t } = useLocale();
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-[24px] [overflow-wrap:anywhere] sm:p-6"
      role="status"
      aria-live="polite"
      aria-label={t("loadingScreen")}
    >
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <LoaderCircle
          className="size-7 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        <span className="text-sm font-semibold">{t("loadingScreen")}</span>
      </div>
    </main>
  );
}

function AuthUnavailable({
  retry,
  retrying,
  copy,
}: {
  retry: () => void;
  retrying: boolean;
  copy: AuthCopy;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-[16px] [overflow-wrap:anywhere] sm:p-6">
      <section
        className="min-w-0 w-full max-w-md rounded-panel border border-border bg-card px-[24px] py-7 text-center sm:px-7"
        role="alert"
      >
        <KeyRound
          className="mx-auto size-9 text-attention-foreground"
          aria-hidden
        />
        <h1 className="mt-4 text-xl font-extrabold">
          {copy.serviceUnavailable}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {copy.serviceUnavailableDescription}
        </p>
        <Button
          type="button"
          className="mt-5 min-h-11"
          onClick={retry}
          disabled={retrying}
        >
          <RefreshCw
            className={`size-4 ${retrying ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden
          />
          {copy.retry}
        </Button>
      </section>
    </main>
  );
}

function AuthCopyBoundary({
  children,
}: {
  children: (copy: AuthCopy) => ReactNode;
}) {
  const { locale, t } = useLocale();
  const copyQuery = useQuery({
    queryKey: ["auth-copy", locale],
    queryFn: () => loadAuthCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (copyQuery.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-[16px] [overflow-wrap:anywhere] sm:p-6">
        <section
          role="alert"
          className="min-w-0 w-full max-w-md rounded-panel border border-attention/25 bg-card px-[24px] py-7 text-center sm:px-7"
        >
          <h1 className="text-xl font-semibold">{t("authCopyError")}</h1>
          <Button
            type="button"
            className="mt-5 min-h-11"
            onClick={() => window.location.reload()}
          >
            {t("checkAgain")}
          </Button>
        </section>
      </main>
    );
  }
  if (!copyQuery.data) return <AuthLoading />;
  return children(copyQuery.data);
}
