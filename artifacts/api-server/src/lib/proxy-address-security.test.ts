import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const expressRequire = createRequire(require.resolve("express"));
const proxyAddress = expressRequire("proxy-addr") as {
  compile(subnet: string): (address: string, hop: number) => boolean;
};

test("Express's actual proxy resolver rejects unrelated IPv4 clients under IPv6 trust subnets", () => {
  for (const subnet of ["::ffff:10.0.0.0/8", "::/1"]) {
    assert.equal(proxyAddress.compile(subnet)("203.0.113.9", 0), false, subnet);
  }
  const mapped = proxyAddress.compile("::ffff:10.0.0.0/104");
  assert.equal(mapped("10.2.3.4", 0), true);
  assert.equal(mapped("203.0.113.9", 0), false);
  const ipv4 = proxyAddress.compile("10.0.0.0/8");
  assert.equal(ipv4("10.2.3.4", 0), true);
  assert.equal(ipv4("203.0.113.9", 0), false);
});
