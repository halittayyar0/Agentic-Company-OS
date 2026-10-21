import path from "node:path";
import { acquireInstallationLock } from "./installation-lock";

export interface InstallationLease {
  readonly directory: string;
  readonly planId: string;
  release(): Promise<void>;
}
interface State {
  directory: string;
  planId: string;
  claimed: boolean;
  closed: boolean;
  close(): Promise<void>;
}
const states = new WeakMap<InstallationLease, State>();
const identity = (value: string) =>
  process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);

export async function acquireInstallationLease(
  directory: string,
  port: number,
  planId: string,
): Promise<InstallationLease> {
  if (
    !path.isAbsolute(directory) ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(planId)
  )
    throw new Error("installation_lease_identity");
  const release = await acquireInstallationLock(directory, port);
  let closing: Promise<void> | undefined;
  const state: State = {
    directory: identity(directory),
    planId,
    claimed: false,
    closed: false,
    close: () => {
      state.closed = true;
      return (closing ??= release());
    },
  };
  const lease = Object.freeze({
    directory: path.resolve(directory),
    planId,
    async release() {
      if (state.claimed && !state.closed)
        throw new Error("installation_lease_transferred");
      await state.close();
    },
  });
  states.set(lease, state);
  return lease;
}
export function transferInstallationLease(
  lease: InstallationLease,
  directory: string,
  planId: string,
): () => Promise<void> {
  assertInstallationLease(lease, directory, planId);
  const state = states.get(lease)!;
  state.claimed = true;
  return state.close;
}
export function assertInstallationLease(
  lease: InstallationLease,
  directory: string,
  planId: string,
): void {
  const state = states.get(lease);
  if (
    !state ||
    state.closed ||
    state.claimed ||
    state.directory !== identity(directory) ||
    state.planId !== planId
  )
    throw new Error("installation_lease_identity");
}
