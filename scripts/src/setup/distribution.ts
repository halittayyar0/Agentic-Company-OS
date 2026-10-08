import { readFile } from "node:fs/promises";
import path from "node:path";

export interface SetupDistribution {
  schemaVersion: 1;
  commit: string;
  image: string;
  codingImage?: string;
}

export function validateDistribution(value: unknown): SetupDistribution {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid distribution manifest");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).sort().join(",") !==
      (Object.hasOwn(data, "codingImage")
        ? "codingImage,commit,image,schemaVersion"
        : "commit,image,schemaVersion") ||
    data.schemaVersion !== 1 ||
    typeof data.commit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(data.commit) ||
    typeof data.image !== "string" ||
    !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/u.test(
      data.image,
    )
  )
    throw new Error("Invalid distribution manifest");
  if (
    Object.hasOwn(data, "codingImage") &&
    (typeof data.codingImage !== "string" ||
      !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/u.test(
        data.codingImage,
      ) ||
      data.codingImage === data.image)
  )
    throw new Error("Invalid coding distribution image");
  return {
    schemaVersion: 1,
    commit: data.commit,
    image: data.image,
    ...(typeof data.codingImage === "string"
      ? { codingImage: data.codingImage }
      : {}),
  };
}

export async function readDistribution(
  directory: string,
): Promise<SetupDistribution | null> {
  try {
    return validateDistribution(
      JSON.parse(
        await readFile(path.join(directory, "distribution.json"), "utf8"),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
