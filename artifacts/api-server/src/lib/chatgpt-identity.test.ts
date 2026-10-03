import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { createChatGPTIdentityVerifier } from "./chatgpt-identity";

test("ChatGPT identity requires a signed issuer, issued client, time and attempt nonce", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const now = Date.now(),
    seconds = Math.floor(now / 1000);
  const clientId = "oaiapp_fixture_one",
    nonce = "fresh-attempt-nonce";
  const base = {
    iss: "https://auth.openai.com",
    aud: clientId,
    sub: "fixture-subject",
    nonce,
    iat: seconds,
    exp: seconds + 3600,
    email: "fixture@example.test",
    name: "Fixture Person",
  };
  const token = (claims: object = base, header: object = {}) => {
    const prefix = [
      Buffer.from(
        JSON.stringify({
          alg: "RS256",
          kid: "fixture-key",
          typ: "JWT",
          ...header,
        }),
      ).toString("base64url"),
      Buffer.from(JSON.stringify(claims)).toString("base64url"),
    ].join(".");
    return `${prefix}.${sign("RSA-SHA256", Buffer.from(prefix), privateKey).toString("base64url")}`;
  };
  let discoveryRequests = 0;
  let unavailable = false;
  const server = createServer((request, response) => {
    assert.equal(request.url, "/.well-known/jwks.json");
    discoveryRequests++;
    if (unavailable) {
      response.writeHead(503);
      response.end("temporary fixture outage");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        keys: [
          {
            ...publicKey.export({ format: "jwk" }),
            kid: "fixture-key",
            use: "sig",
            alg: "RS256",
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const fixtureOrigin = `http://127.0.0.1:${address.port}`;
  try {
    const verifier = createChatGPTIdentityVerifier({
      now: () => now,
      fetch: async (input, init) => {
        const requested = new URL(String(input));
        assert.equal(requested.origin, "https://auth.openai.com");
        return fetch(new URL(requested.pathname, fixtureOrigin), init);
      },
    });
    const identity = await verifier(token(), clientId, { nonce });
    assert.equal(identity.subject, base.sub);
    assert.equal(identity.email, base.email);
    assert.ok(!JSON.stringify(identity).includes(nonce));
    for (const claims of [
      { ...base, iss: "https://untrusted.example" },
      { ...base, aud: "different-client" },
      { ...base, exp: seconds - 60 },
      { ...base, iat: seconds + 300 },
      { ...base, nbf: seconds + 300 },
      { ...base, nonce: "wrong-nonce" },
      { ...base, sub: "" },
      { ...base, exp: undefined },
      { ...base, aud: [clientId, "other-client"] },
      { ...base, azp: "other-client" },
    ])
      await assert.rejects(
        verifier(token(claims), clientId, { nonce }),
        /chatgpt_identity_invalid/,
      );
    for (const header of [
      { alg: "none" },
      { alg: "HS256" },
      { crit: ["unknown"], unknown: true },
    ])
      await assert.rejects(
        verifier(token(base, header), clientId, { nonce }),
        /chatgpt_identity_invalid/,
      );
    const signed = token(),
      pieces = signed.split(".");
    const unboundedPayload = Buffer.from(
      JSON.stringify(base).replace(/"exp":\d+/u, '"exp":1e999'),
    ).toString("base64url");
    const unboundedPrefix = `${pieces[0]}.${unboundedPayload}`;
    await assert.rejects(
      verifier(
        `${unboundedPrefix}.${sign("RSA-SHA256", Buffer.from(unboundedPrefix), privateKey).toString("base64url")}`,
        clientId,
        { nonce },
      ),
      /chatgpt_identity_invalid/,
    );
    pieces[1] = Buffer.from(
      JSON.stringify({ ...base, sub: "tampered-subject" }),
    ).toString("base64url");
    await assert.rejects(
      verifier(pieces.join("."), clientId, { nonce }),
      /chatgpt_identity_invalid/,
    );
    await assert.rejects(
      verifier(signed, "dynamic_agent_client", { nonce }),
      /chatgpt_identity_invalid/,
    );
    await assert.rejects(
      verifier(signed, clientId, { subject: "other-person" }),
      /chatgpt_identity_invalid/,
    );
    assert.equal(
      (await verifier(signed, clientId, { subject: base.sub })).subject,
      base.sub,
    );
    assert.equal(discoveryRequests, 1);
    const recoveringVerifier = createChatGPTIdentityVerifier({
      now: () => now,
      fetch: async (input, init) =>
        fetch(new URL(new URL(String(input)).pathname, fixtureOrigin), init),
    });
    unavailable = true;
    await assert.rejects(
      recoveringVerifier(signed, clientId, { nonce }),
      /chatgpt_identity_unavailable/,
    );
    unavailable = false;
    assert.equal(
      (await recoveringVerifier(signed, clientId, { nonce })).subject,
      base.sub,
    );
    assert.equal(discoveryRequests, 3);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
