import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test, { type TestContext } from "node:test";
import { createCodexAppServerClient } from "./codex-app-server-client";

const script = String.raw`
  let buffer='';
  const send = value => process.stdout.write(JSON.stringify(value)+'\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', part => {
    buffer += part;
    let at;
    while ((at=buffer.indexOf('\n'))>=0) {
      const value=JSON.parse(buffer.slice(0,at)); buffer=buffer.slice(at+1);
      if (value.method==='initialize') send({id:value.id,result:{userAgent:'fixture'}});
      else if(value.method==='config/read') send({id:value.id,result:{config:{default_permissions:'acos_task'},layers:[]}});
      else if(value.method==='permissionProfile/list') send({id:value.id,result:{data:[{id:'acos_task',allowed:true}],nextCursor:null}});
      else if(value.method==='thread/start') {
        if(process.argv[1]==='rejected') send({id:value.id,error:{code:-32603,message:'PRIVATE_FIXTURE_SERVER_ERROR'}});
        else send({id:value.id,result:{thread:{id:'thread_fixture'}}});
      }
      else if(value.method==='turn/start') {
        send({id:value.id,result:{turn:{id:'turn_fixture',status:'inProgress'}}});
        if(process.argv[1]==='eof') { send({method:'item/agentMessage/delta',params:{threadId:'thread_fixture',turnId:'turn_fixture',delta:'partial text'}}); process.exit(0); }
        else if(process.argv[1]==='malformed') process.stdout.write('{broken\n');
        else if(process.argv[1]==='oversize') process.stdout.write('x'.repeat(1048577));
        else if(process.argv[1]==='wrong_scope') send({id:'approval_fixture',method:'item/commandExecution/requestApproval',params:{threadId:'other_thread',turnId:'turn_fixture',itemId:'item_fixture',command:'fixture-command'}});
        else if(process.argv[1]==='unknown') send({id:'approval_fixture',method:'account/login/start',params:{threadId:'thread_fixture',turnId:'turn_fixture'}});
        else {
          send({id:'approval_fixture',method:'item/commandExecution/requestApproval',params:{threadId:'thread_fixture',turnId:'turn_fixture',itemId:'item_fixture',command:'fixture-command'}});
          if(process.argv[1]==='pending_events') send({method:'fixture/progress',params:{threadId:'thread_fixture',turnId:'turn_fixture'}});
          if(process.argv[1]==='resolved_pending') setTimeout(()=>{send({method:'serverRequest/resolved',params:{threadId:'thread_fixture',requestId:'approval_fixture'}});send({method:'turn/completed',params:{threadId:'thread_fixture',turnId:'turn_fixture',turn:{id:'turn_fixture',status:'completed'}}});},10);
          if(process.argv[1]==='terminal_pending') setTimeout(()=>send({method:'turn/completed',params:{threadId:'thread_fixture',turnId:'turn_fixture',turn:{id:'turn_fixture',status:'completed'}}}),10);
          if(process.argv[1]==='item_pending') setTimeout(()=>send({method:'item/completed',params:{threadId:'thread_fixture',turnId:'turn_fixture',item:{type:'commandExecution',id:'item_fixture',status:'declined'}}}),10);
          if(process.argv[1]==='queued_terminal') {send({method:'fixture/block_progress',params:{threadId:'thread_fixture',turnId:'turn_fixture'}});send({method:'turn/completed',params:{threadId:'thread_fixture',turnId:'turn_fixture',turn:{id:'turn_fixture',status:'completed'}}});}
        }
      } else if(value.method==='turn/steer') send({id:value.id,result:{turnId:'turn_fixture'}});
      else if(value.id==='approval_fixture' && 'result' in value) {
        send({method:'fixture/decision',params:{decision:value.result.decision}});
        if(process.argv[1]==='queued_terminal') continue;
        const text=Buffer.from(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:'thread_fixture',turnId:'turn_fixture',delta:'İş ✅'}})+'\r\n');
        const split=text.indexOf(Buffer.from('✅'))+1;
        process.stdout.write(text.subarray(0,split)); setTimeout(()=>{process.stdout.write(text.subarray(split)); send({method:'turn/completed',params:{threadId:'thread_fixture',turn:{id:'turn_fixture',status:'completed'}}});},5);
      }
    }
  });
`;

test(
  "the final synchronous action fence can reject an accept before physical stdio write",
  { timeout: 3000 },
  async (t) => {
    const child = fixture(t);
    const write = child.stdin.write.bind(child.stdin);
    let accepted = false,
      checked = false;
    let sawReply!: () => void;
    const reply = new Promise<null>((resolve) => {
      sawReply = () => resolve(null);
    });
    child.stdin.write = ((part: unknown, ...args: unknown[]) => {
      if (String(part).includes('"decision":"accept"')) accepted = true;
      return (write as (...args: unknown[]) => boolean)(part, ...args);
    }) as typeof child.stdin.write;
    const options = {
      assertOwned: async () => {},
      approve: async () => "accept" as const,
      validateApprovalReply: () => {
        checked = true;
        throw new Error("private rejected exact scope");
      },
      onNotification: (event: { method: string }) => {
        if (event.method === "fixture/decision") sawReply();
      },
    };
    const client = createCodexAppServerClient(child, options);
    t.after(() => client.close());
    await client.request("initialize", {});
    await client.request("thread/start", {});
    await client.request("turn/start", {});
    const outcome = await Promise.race([
      client.failure.catch((error) => error as { kind: string }),
      reply,
    ]);
    assert.equal(outcome?.kind, "protocol");
    assert.equal(checked, true);
    assert.equal(accepted, false);
  },
);

test("a server request rejection retains only its known request method and never its private error message", async (t) => {
  const client = createCodexAppServerClient(fixture(t, "rejected"), {
    assertOwned: async () => {},
  });
  t.after(() => client.close());
  await client.request("initialize", {
    clientInfo: { name: "fixture", version: "fixture" },
  });
  await client.notify("initialized", {});
  await assert.rejects(client.request("thread/start", {}), (error) => {
    assert.equal((error as { kind: string }).kind, "request_rejected");
    assert.equal((error as { method: string }).method, "thread/start");
    assert.equal(String(error).includes("PRIVATE_FIXTURE"), false);
    assert.equal(JSON.stringify(error).includes("PRIVATE_FIXTURE"), false);
    return true;
  });
});

test(
  "progress and steering responses are delivered while a human approval is pending",
  { timeout: 4000 },
  async (t) => {
    let release!: () => void, started!: () => void, progressed!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const approvalStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const progress = new Promise<void>((resolve) => {
      progressed = resolve;
    });
    const client = createCodexAppServerClient(fixture(t, "pending_events"), {
      assertOwned: async () => {},
      requestTimeoutMs: 500,
      approve: async () => {
        started();
        await gate;
        return "decline";
      },
      onNotification: (event) => {
        if (event.method === "fixture/progress") progressed();
      },
    });
    t.after(() => {
      release();
      client.close();
    });
    await begin(client);
    await approvalStarted;
    await client.request("turn/steer", {
      threadId: "thread_fixture",
      expectedTurnId: "turn_fixture",
      input: [{ type: "text", text: "Fixture steering" }],
    });
    await progress;
    release();
  },
);

for (const mode of ["resolved_pending", "terminal_pending", "item_pending"])
  test(
    `native ${mode} cancels the pending callback and cannot emit a late accept`,
    { timeout: 4000 },
    async (t) => {
      let release!: () => void,
        ended!: () => void,
        signal: AbortSignal | undefined,
        accepted = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const end = new Promise<void>((resolve) => {
        ended = resolve;
      });
      const client = createCodexAppServerClient(fixture(t, mode), {
        assertOwned: async () => {},
        requestTimeoutMs: 500,
        approve: async (_request, cancellation) => {
          signal = cancellation;
          await gate;
          return "accept";
        },
        onNotification: (event) => {
          if (
            event.method === "fixture/decision" &&
            event.params.decision === "accept"
          )
            accepted = true;
          if (
            event.method ===
            (mode === "item_pending" ? "item/completed" : "turn/completed")
          )
            ended();
        },
      });
      t.after(() => {
        release();
        client.close();
      });
      await begin(client);
      await end;
      assert.equal(signal?.aborted, true);
      release();
      await client.request("config/read", {});
      assert.equal(accepted, false);
    },
  );

test(
  "pending approval has its own bounded deadline and fixed cancellation reason",
  { timeout: 4000 },
  async (t) => {
    let signal: AbortSignal | undefined;
    const client = createCodexAppServerClient(fixture(t), {
      assertOwned: async () => {},
      requestTimeoutMs: 1000,
      approvalTimeoutMs: 50,
      approve: async (_request, cancellation) => {
        signal = cancellation;
        return new Promise<"accept">(() => {});
      },
    });
    t.after(() => client.close());
    await begin(client);
    await assert.rejects(client.failure, { kind: "timeout" });
    assert.equal(signal?.aborted, true);
    assert.equal(signal?.reason.kind, "cancelled");
  },
);

test("Codex capability inspection reads configuration and profiles without accepting configuration writes or execution RPCs", async (t) => {
  const client = createCodexAppServerClient(fixture(t), {
    assertOwned: async () => {},
  });
  t.after(() => client.close());
  await client.request("initialize", {
    clientInfo: { name: "fixture", version: "fixture" },
    capabilities: { experimentalApi: true },
  });
  await client.notify("initialized", {});
  assert.deepEqual(
    await client.request("config/read", {
      includeLayers: true,
      cwd: process.cwd(),
    }),
    { config: { default_permissions: "acos_task" }, layers: [] },
  );
  assert.deepEqual(
    await client.request("permissionProfile/list", { cwd: process.cwd() }),
    { data: [{ id: "acos_task", allowed: true }], nextCursor: null },
  );
  for (const method of [
    "config/value/write",
    "command/exec",
    "account/login/start",
  ]) {
    await assert.rejects(client.request(method, {}), { kind: "protocol" });
  }
});
test(
  "approval reply waits for already received notifications before its final scope fence",
  { timeout: 4000 },
  async (t) => {
    let releaseReview!: () => void,
      releaseDelivery!: () => void,
      deliveryStarted!: () => void,
      ended!: () => void,
      sent = false;
    const review = new Promise<void>((resolve) => {
      releaseReview = resolve;
    });
    const delivery = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const started = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    const end = new Promise<void>((resolve) => {
      ended = resolve;
    });
    const child = fixture(t, "queued_terminal");
    const receivedTerminal = new Promise<void>((resolve) => {
      let observed = "";
      child.stdout.on("data", (chunk) => {
        observed += chunk.toString();
        const at = observed.indexOf('"method":"turn/completed"');
        if (at >= 0 && observed.indexOf("\n", at) >= 0) resolve();
      });
    });
    const originalWrite = child.stdin.write.bind(child.stdin);
    child.stdin.write = ((
      chunk: string,
      callback: (error?: Error | null) => void,
    ) => {
      const message = JSON.parse(chunk);
      if (message.id === "approval_fixture") sent = true;
      return originalWrite(chunk, callback);
    }) as typeof child.stdin.write;
    const client = createCodexAppServerClient(child, {
      assertOwned: async () => {},
      approve: async () => {
        await review;
        return "accept";
      },
      onNotification: async (event) => {
        if (event.method === "fixture/block_progress") {
          deliveryStarted();
          await delivery;
        }
        if (event.method === "turn/completed") ended();
      },
    });
    t.after(() => {
      releaseReview();
      releaseDelivery();
      client.close();
    });
    await begin(client);
    await started;
    // The fence concerns bytes received here, not merely written by the peer.
    await receivedTerminal;
    releaseReview();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sent, false);
    releaseDelivery();
    await end;
    await client.request("config/read", {});
    assert.equal(sent, false);
  },
);

function fixture(t: TestContext, mode = "ok") {
  const child = spawn(process.execPath, ["-e", script, mode], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill();
  });
  return child;
}
async function begin(client: ReturnType<typeof createCodexAppServerClient>) {
  await client.request("initialize", {
    clientInfo: {
      name: "agentic_company_os",
      title: "Agentic Company OS",
      version: "fixture",
    },
  });
  await client.notify("initialized", {});
  await client.request("thread/start", {});
  client.setScope("thread_fixture", "turn_fixture");
  await client.request("turn/start", {
    threadId: "thread_fixture",
    input: [{ type: "text", text: "Fixture task" }],
  });
}

test("Codex JSONL uses the real stdio pipes, scoped approvals and fragmented UTF-8 notifications", async (t) => {
  const events: Array<{ method: string; params: Record<string, unknown> }> = [];
  let done!: () => void,
    approvals = 0,
    fences = 0;
  const completed = new Promise<void>((resolve) => {
    done = resolve;
  });
  const client = createCodexAppServerClient(fixture(t), {
    assertOwned: async () => {
      fences++;
    },
    approve: async (request) => {
      approvals++;
      assert.equal(request.params.command, "fixture-command");
      return "accept";
    },
    onNotification: (event) => {
      events.push(event);
      if (event.method === "turn/completed") done();
    },
  });
  t.after(() => client.close());
  await begin(client);
  await completed;
  assert.equal(approvals, 1);
  assert.ok(fences >= 7);
  assert.equal(
    events.find((event) => event.method === "fixture/decision")?.params
      .decision,
    "accept",
  );
  assert.equal(
    events.find((event) => event.method === "item/agentMessage/delta")?.params
      .delta,
    "İş ✅",
  );
});

test("loss of ownership while an approval is pending fences the reply and fails the client", async (t) => {
  let release!: () => void,
    started!: () => void,
    lost = false,
    accepted = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const approvalStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const client = createCodexAppServerClient(fixture(t), {
    assertOwned: async () => {
      if (lost) throw new Error("private lease error");
    },
    approve: async () => {
      started();
      await gate;
      return "accept";
    },
    onNotification: (event) => {
      if (
        event.method === "fixture/decision" &&
        event.params.decision === "accept"
      )
        accepted = true;
    },
  });
  t.after(() => client.close());
  await begin(client);
  await approvalStarted;
  lost = true;
  release();
  await assert.rejects(client.failure, { kind: "ownership_lost" });
  assert.equal(accepted, false);
});

for (const [mode, kind] of [
  ["eof", "interrupted"],
  ["malformed", "protocol"],
  ["oversize", "protocol"],
  ["wrong_scope", "protocol"],
  ["unknown", "unsupported_request"],
] as const) {
  test(`Codex ${mode} cannot become a successful completed turn`, async (t) => {
    let approvals = 0,
      terminal = false;
    const client = createCodexAppServerClient(fixture(t, mode), {
      assertOwned: async () => {},
      approve: async () => {
        approvals++;
        return "accept";
      },
      onNotification: (event) => {
        if (event.method === "turn/completed") terminal = true;
      },
    });
    t.after(() => client.close());
    const rejected = assert.rejects(client.failure, { kind });
    await begin(client).catch(() => {});
    await rejected;
    assert.equal(approvals, 0);
    assert.equal(terminal, false);
  });
}

test("Codex cancellation and nonresponsive requests have bounded, safe failures", async (t) => {
  const controller = new AbortController();
  const child = spawn(process.execPath, ["-e", "process.stdin.resume();"], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const client = createCodexAppServerClient(child, {
    assertOwned: async () => {},
    signal: controller.signal,
    requestTimeoutMs: 30,
  });
  const failed = assert.rejects(client.failure, { kind: "timeout" });
  await assert.rejects(client.request("initialize", {}), { kind: "timeout" });
  await failed;
  const next = createCodexAppServerClient(fixture(t), {
    assertOwned: async () => {},
    signal: controller.signal,
  });
  const cancelled = assert.rejects(next.failure, { kind: "cancelled" });
  controller.abort(new Error("private credential reason"));
  await cancelled;
  await assert.rejects(next.request("initialize", {}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("private"));
    return true;
  });
});
