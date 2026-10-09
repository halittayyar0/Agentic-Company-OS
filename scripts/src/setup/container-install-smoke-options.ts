export function parseContainerSmokeOptions(args: string[]): {
  image?: string;
  codingImage?: string;
  codingRuntime: boolean;
} {
  if (args.length === 0) return { codingRuntime: false };
  if (args.length === 1 && args[0] === "--coding-source")
    return { codingRuntime: true };
  const pinned = /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/u;
  if (
    args.length > 2 ||
    args.some((arg) => !pinned.test(arg)) ||
    (args.length === 2 && args[0] === args[1])
  )
    throw new Error(
      "Container proof requires source mode or distinct immutable image digests",
    );
  return {
    image: args[0],
    ...(args[1] ? { codingImage: args[1] } : {}),
    codingRuntime: args.length === 2,
  };
}
