import { eq } from "drizzle-orm";
import { db, capabilityInstallationsTable } from "@workspace/db";
import { validateExtensionPackage } from "./extension-manifest";

/** Fixed Node execution. No endpoint, environment variables or executable are imported. */
export async function resolveLocalProgram(command: string) {
  if (!/^extension(?:\s|$)/i.test(command)) return null;
  const match =
    /^extension (user-[a-z0-9][a-z0-9-]{0,59})@([1-9][0-9]{0,9}) (\{[\s\S]*\})$/.exec(
      command,
    );
  if (!match || command.length > 8192)
    throw new Error("EXTENSION_PROGRAM_INPUT_INVALID");
  let input: unknown;
  try {
    input = JSON.parse(match[3]);
  } catch {
    throw new Error("EXTENSION_PROGRAM_INPUT_INVALID");
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("EXTENSION_PROGRAM_INPUT_INVALID");
  const id = match[1],
    revision = Number(match[2]);
  const read = async () => {
    const [row] = await db
      .select()
      .from(capabilityInstallationsTable)
      .where(eq(capabilityInstallationsTable.id, id));
    if (!row?.enabled) throw new Error("EXTENSION_DISABLED");
    if (row.revision !== revision)
      throw new Error("EXTENSION_REVISION_CONFLICT");
    const manifest = validateExtensionPackage(row.manifest);
    if (manifest.kind !== "program") throw new Error("EXTENSION_NOT_PROGRAM");
    return manifest;
  };
  const manifest = await read();
  const runner = `const run = async (input) => {\n${manifest.code}\n};\nPromise.resolve(run(JSON.parse(process.argv[1]))).then(value => { const text = JSON.stringify(value ?? null); if (Buffer.byteLength(text) > 48000) throw new Error("EXTENSION_OUTPUT_TOO_LARGE"); process.stdout.write(text); }).catch(() => { process.stderr.write("EXTENSION_PROGRAM_FAILED"); process.exitCode = 1; });`;
  const argv = ["node", "--eval", runner, JSON.stringify(input)];
  if (JSON.stringify(argv).length > 16000)
    throw new Error("EXTENSION_PROGRAM_INPUT_TOO_LARGE");
  return {
    argv,
    revalidate: async () => {
      await read();
    },
  };
}
