// Harmless CVE-2026-105482 regression. All DNS packets stay on loopback.
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { Resolver } from "node:dns/promises";
import test from "node:test";

test(
  "DNS rejects NUL-containing names without querying a truncated name",
  { timeout: 5000 },
  async () => {
    const socket = dgram.createSocket("udp4");
    let queries = 0;
    const resolver = new Resolver({ timeout: 500, tries: 1 });
    try {
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(0, "127.0.0.1", resolve);
      });
      socket.on("message", (request, peer) => {
        queries++;
        const header = Buffer.from(request.subarray(0, 12));
        header.writeUInt16BE(0x8180, 2);
        header.writeUInt16BE(1, 6);
        header.writeUInt16BE(0, 8);
        header.writeUInt16BE(0, 10);
        const answer = Buffer.from([
          0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 127, 0, 0, 1,
        ]);
        socket.send(
          Buffer.concat([header, request.subarray(12), answer]),
          peer.port,
          peer.address,
        );
      });
      resolver.setServers([`127.0.0.1:${socket.address().port}`]);
      assert.deepEqual(await resolver.resolve4("runtime-security.example"), [
        "127.0.0.1",
      ]);
      assert.equal(
        queries,
        1,
        "positive control must query the owned DNS fixture",
      );
      await assert.rejects(
        async () =>
          resolver.resolve4("runtime-security.example\0.allowed.invalid"),
        {
          code: "ERR_INVALID_ARG_VALUE",
        },
      );
      assert.equal(
        queries,
        1,
        "invalid input must not reach DNS as a truncated name",
      );
    } finally {
      resolver.cancel();
      await new Promise((resolve) => socket.close(resolve));
    }
  },
);
