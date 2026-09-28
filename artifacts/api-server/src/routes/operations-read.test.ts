import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";

interface HttpResponse {
  status: number;
  body: string;
}

function request(port: number, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("operations read routes validate bounded query input and map project errors", async (t) => {
  const routeModule = await import("./operations");
  const readModule = await import("../lib/operations/operations-read-model");
  const overviewCalls: unknown[] = [];
  const projectCalls: unknown[] = [];
  const instanceCalls: unknown[] = [];
  const app = express();
  app.use(
    "/api",
    routeModule.createOperationsRouter({
      getOverview: async (input) => {
        overviewCalls.push(input);
        return { contract: "overview" } as never;
      },
      getProject: async (input) => {
        projectCalls.push(input);
        if (input.rootTaskId === 404) {
          throw new readModule.OperationsProjectNotFoundError();
        }
        if (input.rootTaskId === 409) {
          throw new readModule.OperationsRootRequiredError();
        }
        return { contract: "project", rootTaskId: input.rootTaskId } as never;
      },
      listInstances: async (input) => {
        instanceCalls.push(input);
        return { contract: "instances" } as never;
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const overview = await request(
    address.port,
    "/api/ops/overview?windowHours=12",
  );
  assert.equal(overview.status, 200, overview.body);
  assert.deepEqual(JSON.parse(overview.body), { contract: "overview" });
  assert.deepEqual(overviewCalls, [{ windowHours: 12 }]);

  const project = await request(
    address.port,
    "/api/tasks/12/operations?windowHours=48",
  );
  assert.equal(project.status, 200, project.body);
  assert.deepEqual(projectCalls, [{ rootTaskId: 12, windowHours: 48 }]);

  const instances = await request(
    address.port,
    "/api/ops/instances?windowHours=6&limit=25",
  );
  assert.equal(instances.status, 200, instances.body);
  assert.deepEqual(instanceCalls, [{ windowHours: 6, limit: 25 }]);

  for (const path of [
    "/api/ops/overview?windowHours=0",
    "/api/ops/overview?windowHours=169",
    "/api/ops/overview?windowHours=abc",
    "/api/ops/overview?windowHours=12&unexpected=true",
    "/api/tasks/0/operations",
    "/api/tasks/not-a-number/operations",
    "/api/ops/instances?limit=201",
    "/api/ops/instances?limit=1.5",
  ]) {
    const invalid = await request(address.port, path);
    assert.equal(invalid.status, 400, `${path}: ${invalid.body}`);
  }
  assert.equal(overviewCalls.length, 1);
  assert.equal(projectCalls.length, 1);
  assert.equal(instanceCalls.length, 1);

  assert.equal(
    (await request(address.port, "/api/tasks/404/operations")).status,
    404,
  );
  assert.equal(
    (await request(address.port, "/api/tasks/409/operations")).status,
    409,
  );
});
