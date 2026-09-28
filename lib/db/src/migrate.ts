async function main(): Promise<void> {
  const { closeDatabase, databaseBackend, dbReady } = await import("./index");
  try {
    await dbReady;
    process.stdout.write(
      `Database migrations complete (${databaseBackend}).\n`,
    );
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Database migration failed"}\n`,
  );
  process.exitCode = 1;
});
