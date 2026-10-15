import path from "node:path";

export class SetupArgumentError extends Error {}
export const setupHelp = `Agentic Company OS setup
Source:   pnpm run setup [options]
Portable: node scripts/src/setup/bootstrap.mjs [options]

  --help, -h          Show this help without probing or starting setup.
  --check             Check prerequisites only; no installation or model request.
  --data-dir <path>   Use a private parent directory for a new installation.
  --resume <path>     Resume an existing installation (starts its services).

Use --check on its own. Exit 0 means at least one installation path has
its detected prerequisites; exit 1 means neither path is ready. Optional
coding and phone features do not block an ordinary installation.
The interactive wizard supports seven languages. Terminal help is English.
`;

export function parseSetupArguments(argv: string[]): {
  help?: boolean;
  check?: boolean;
  resume?: string;
  parent?: string;
} {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 1 && ["--help", "-h"].includes(args[0]))
    return { help: true };
  if (args.length === 1 && args[0] === "--check") return { check: true };
  let resume: string | undefined, parent: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (
      (args[i] === "--resume" || args[i] === "--data-dir") &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    ) {
      if (args[i] === "--resume") {
        if (resume)
          throw new SetupArgumentError(
            "Duplicate resume path. Use --help for usage.",
          );
        resume = path.resolve(args[++i]);
      } else {
        if (parent)
          throw new SetupArgumentError(
            "Duplicate data directory. Use --help for usage.",
          );
        parent = path.resolve(args[++i]);
      }
    } else
      throw new SetupArgumentError(
        "Invalid setup arguments. Use --help for usage; --check must be used alone.",
      );
  }
  if (resume && parent)
    throw new SetupArgumentError(
      "Resume already identifies its data directory. Use --help for usage.",
    );
  return { resume, parent };
}
