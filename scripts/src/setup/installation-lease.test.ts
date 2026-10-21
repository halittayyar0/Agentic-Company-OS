import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { acquireInstallationLock } from "./installation-lock";
import {
  acquireInstallationLease,
  transferInstallationLease,
  assertInstallationLease,
} from "./installation-lease";

test("upgrade lease transfers once without a gap and releases its OS ownership exactly once", async () => {
  const id = randomUUID(),
    directory = path.resolve(`lease-${id}`);
  const lease = await acquireInstallationLease(directory, 5031, id);
  try {
    assertInstallationLease(lease, directory, id);
    await assert.rejects(acquireInstallationLock(directory, 5031));
    assert.throws(() =>
      transferInstallationLease(lease, directory + "-other", id),
    );
    assert.throws(() =>
      transferInstallationLease(lease, directory, randomUUID()),
    );
    const release = transferInstallationLease(lease, directory, id);
    await assert.rejects(acquireInstallationLock(directory, 5031));
    assert.throws(() => transferInstallationLease(lease, directory, id));
    assert.throws(() => assertInstallationLease(lease, directory, id));
    await assert.rejects(lease.release(), /lease_transferred/u);
    await release();
    await release();
    const next = await acquireInstallationLock(directory, 5031);
    await next();
  } finally {
    await lease.release();
  }
});

test("unclaimed and released upgrade leases cannot be forged or reused", async () => {
  const id = randomUUID(),
    directory = path.resolve(`lease-${id}`);
  const lease = await acquireInstallationLease(directory, 5031, id);
  await lease.release();
  await lease.release();
  assert.throws(() => transferInstallationLease(lease, directory, id));
  assert.throws(() => transferInstallationLease({ ...lease }, directory, id));
});
