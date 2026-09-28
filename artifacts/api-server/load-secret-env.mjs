import fs from "node:fs";
import path from "node:path";

const MAX_SECRET_BYTES = 64 * 1024;

/** Resolve Docker/Kubernetes-style NAME_FILE secrets before importing the API. */
export function loadSecretEnvironment(names, environment = process.env) {
  for (const name of names) {
    const fileName = `${name}_FILE`;
    const direct = environment[name];
    const filePath = environment[fileName];
    if (direct && filePath) {
      throw new Error(`${name} and ${fileName} cannot both be set.`);
    }
    if (!filePath) continue;
    if (!path.isAbsolute(filePath)) {
      throw new Error(`${fileName} must be an absolute path.`);
    }
    const metadata = fs.statSync(filePath);
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAX_SECRET_BYTES
    ) {
      throw new Error(
        `${fileName} must reference a non-empty file up to 64 KiB.`,
      );
    }
    const value = fs.readFileSync(filePath, "utf8").replace(/\r?\n$/, "");
    if (!value || /[\r\n]/.test(value)) {
      throw new Error(`${fileName} must contain exactly one non-empty line.`);
    }
    environment[name] = value;
  }
}
