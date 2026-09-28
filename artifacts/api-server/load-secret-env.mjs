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
    const descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY |
        (process.platform === "win32" ? 0 : fs.constants.O_NONBLOCK),
    );
    let value;
    try {
      const metadata = fs.fstatSync(descriptor);
      if (
        !metadata.isFile() ||
        metadata.size <= 0 ||
        metadata.size > MAX_SECRET_BYTES
      ) {
        throw new Error(
          `${fileName} must reference a non-empty file up to 64 KiB.`,
        );
      }
      const bytes = Buffer.alloc(MAX_SECRET_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(
          descriptor,
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (!count) break;
        length += count;
      }
      if (length > MAX_SECRET_BYTES)
        throw new Error(`${fileName} exceeds 64 KiB.`);
      value = bytes
        .subarray(0, length)
        .toString("utf8")
        .replace(/\r?\n$/, "");
    } finally {
      fs.closeSync(descriptor);
    }
    if (!value || /[\r\n]/.test(value)) {
      throw new Error(`${fileName} must contain exactly one non-empty line.`);
    }
    environment[name] = value;
  }
}
