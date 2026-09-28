export interface PostgresClientErrorEmitter {
  on(event: "error", listener: (error: unknown) => void): unknown;
}

export interface PostgresPoolErrorEmitter {
  on(event: "error", listener: (error: unknown) => void): unknown;
  on(
    event: "connect",
    listener: (client: PostgresClientErrorEmitter) => void,
  ): unknown;
}

export interface PostgresPoolErrorRecord {
  event: "postgres_idle_connection_error";
  code: string;
}

export type PostgresPoolErrorReporter = (
  record: PostgresPoolErrorRecord,
) => void;

const SAFE_POSTGRES_ERROR_CODE = /^[A-Z0-9_]{1,32}$/u;

function defaultReporter(record: PostgresPoolErrorRecord): void {
  console.error("[db] PostgreSQL pool discarded an idle connection.", record);
}

/**
 * node-postgres emits idle-client failures on Pool itself. Without a listener,
 * EventEmitter treats the error as fatal and terminates the API or worker.
 * The diagnostic intentionally omits the Error message and connection details.
 */
export function attachPostgresPoolErrorHandler(
  pool: PostgresPoolErrorEmitter,
  report: PostgresPoolErrorReporter = defaultReporter,
): void {
  pool.on("connect", (client) => {
    // pg-pool removes its idle listener while a client is checked out. Keep a
    // passive listener attached so a transport reset cannot become an
    // EventEmitter-level uncaught exception; the active query still rejects.
    client.on("error", () => undefined);
  });
  pool.on("error", (error) => {
    const candidate =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    report({
      event: "postgres_idle_connection_error",
      code:
        typeof candidate === "string" &&
        SAFE_POSTGRES_ERROR_CODE.test(candidate)
          ? candidate
          : "UNKNOWN",
    });
  });
}
