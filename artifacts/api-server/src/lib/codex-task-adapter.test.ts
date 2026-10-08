import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test, { type TestContext } from "node:test";
import path from "node:path";
import { buildCodexTaskConfiguration } from "./codex-task-configuration";
import {
  runCodexTask,
  CodexTaskError,
  type CodexTaskBinding,
  type CodexTaskPorts,
} from "./codex-task-adapter";

const binding: CodexTaskBinding = {
  taskId: 51,
  attemptId: "00000000-0000-4000-8000-000000000072",
  leaseOwner: "owned_fixture_lease",
  policyRevision: 4,
  registrationId: "fixture_registration",
  registrationRevision: 6,
  accountId: "fixture_account",
  admissionVersion: 0,
};
const script = String.raw`
  let buffer = '';
  let experimental = false;
  const prepared = JSON.parse(process.argv[2] || '{}');
  const send = value => process.stdout.write(JSON.stringify(value)+'\n');
  const event = (method, extra) => send({method,params:{threadId:'thread_fixture',turnId:'turn_fixture',...extra}});
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', part => {
    buffer += part;
    let at;
    while ((at=buffer.indexOf('\n'))>=0) {
      const value = JSON.parse(buffer.slice(0,at)); buffer=buffer.slice(at+1);
      if(value.method==='fixture/withdrawApproval') {
        send({method:'serverRequest/resolved',params:{threadId:'thread_fixture',requestId:'approval_fixture'}});
        event('item/completed',{completedAtMs:105,item:{type:'fileChange',id:'item_patch',changes:[{path:prepared.cwd+require('node:path').sep+'fixture-new.txt',kind:{type:'add'},diff:'A useful result\n'}],status:'declined'}});
        event('turn/completed',{turn:{id:'turn_fixture',status:'completed',items:[]}});
        continue;
      }
      if (value.method==='initialize') { experimental=value.params.capabilities?.experimentalApi===true; send({id:value.id,result:{userAgent:'fixture'}}); }
      else if(value.method==='config/read') send({id:value.id,result:{config:{...prepared.permissions.configuration.values,permissions:{[prepared.permissions?.id]:process.argv[1]==='profile_changed'?{...prepared.permissions?.definition,network:{enabled:true}}:prepared.permissions?.definition}},layers:[{name:{type:'user',file:prepared.permissions.configuration.file,profile:null},config:prepared.permissions.configuration.values,disabledReason:null}]}});
      else if(value.method==='permissionProfile/list') send({id:value.id,result:{data:[{id:prepared.permissions?.id,allowed:process.argv[1]!=='profile_denied'}],nextCursor:null}});
      else if(value.method==='thread/start'||value.method==='thread/resume') {
        if(process.argv[1]==='profile_unsupported') {send({id:value.id,error:{code:-32603,message:'PRIVATE_FIXTURE_UNSUPPORTED_SANDBOX'}}); continue;}
        if(prepared.permissions && (!experimental || value.params.sandbox!=null || value.params.permissions!==prepared.permissions.id || (value.method==='thread/start'&&value.params.allowProviderModelFallback!==false))) {send({id:value.id,error:{code:-1,message:'invalid_profile_request'}}); continue;}
        send({id:value.id,result:{thread:{id:'thread_fixture'},model:'fixture-model',modelProvider:'openai_chatgpt_plan',cwd:value.params.cwd,approvalPolicy:prepared.approvalPolicy||'never',sandbox:{type:'readOnly',networkAccess:false},approvalsReviewer:'user',activePermissionProfile:prepared.permissions?{id:prepared.permissions.id,extends:process.argv[1]==='profile_inherited'?':read-only':null}:null,runtimeWorkspaceRoots:process.argv[1]==='profile_roots_changed'?['/outside']:value.params.runtimeWorkspaceRoots}});
      } else if(value.method==='turn/start') {
        if(prepared.permissions && (value.params.sandboxPolicy!=null || value.params.permissions!==prepared.permissions.id || JSON.stringify(value.params.runtimeWorkspaceRoots)!==JSON.stringify(prepared.permissions.runtimeWorkspaceRoots))) {send({id:value.id,error:{code:-1,message:'invalid_turn_permissions'}}); continue;}
        send({id:value.id,result:{turn:{id:'turn_fixture',status:'inProgress'}}});
        if(process.argv[1]==='instant') {event('turn/completed',{turn:{id:'turn_fixture',status:'completed',items:[]}}); continue;}
        event('item/agentMessage/delta',{delta:'Not completion; build passed!'});
        if(process.argv[1]==='eof') process.exit(0);
        if(process.argv[1]==='wait'||process.argv[1]==='steer') continue;
        if(['approval','grant','cleared_approval','missing_patch','changed_patch','patch_receipt','failed_patch','receipt_mismatch','unfinished_patch'].includes(process.argv[1])) {
          const changes=[{path:prepared.cwd+require('node:path').sep+'fixture-new.txt',kind:{type:'add'},diff:'A useful result\n'}];
          if(process.argv[1]!=='missing_patch') event('item/started',{startedAtMs:100,item:{type:'fileChange',id:'item_patch',changes,status:'inProgress'}});
          send({id:'approval_fixture',method:'item/fileChange/requestApproval',params:{threadId:'thread_fixture',turnId:'turn_fixture',itemId:'item_patch',startedAtMs:101,grantRoot:process.argv[1]==='grant'?'/outside':null}});
          if(process.argv[1]==='changed_patch') setTimeout(()=>event('item/fileChange/patchUpdated',{itemId:'item_patch',changes:[{...changes[0],diff:'A different result\n'}]}),20);
          continue;
        }
        if(process.argv[1]!=='unknown_usage') event('thread/tokenUsage/updated',{tokenUsage:{last:{inputTokens:3,outputTokens:2,totalTokens:5},total:{inputTokens:13,outputTokens:12,totalTokens:25}}});
        event('item/completed',{item:{type:'agentMessage',id:'item_answer',text:'ACCESS_TOKEN=fixture-private-token\nBuild passed!'}});
        event('turn/completed',{turn:{id:process.argv[1]==='wrong_turn'?'another_turn':'turn_fixture',status:process.argv[1]==='failed'?'failed':process.argv[1]==='interrupted'?'interrupted':'completed',items:[]}});
      } else if(value.method==='turn/steer') { send({id:value.id,result:{turnId:'turn_fixture'}}); event('turn/completed',{turn:{id:'turn_fixture',status:'completed',items:[]}}); }
      else if(value.method==='turn/interrupt') {send({id:value.id,result:{}}); event('turn/completed',{turn:{id:'turn_fixture',status:'interrupted',items:[]}});}
      else if(value.id==='approval_fixture') {
        event('fixture/decision',{decision:value.result.decision});
        if(process.argv[1]!=='unfinished_patch') event('item/completed',{completedAtMs:105,item:{type:'fileChange',id:'item_patch',changes:[{path:prepared.cwd+require('node:path').sep+'fixture-new.txt',kind:{type:'add'},diff:process.argv[1]==='receipt_mismatch'?'Different\n':'A useful result\n'}],status:process.argv[1]==='failed_patch'?'failed':value.result.decision==='accept'?'completed':'declined'}});
        event('turn/completed',{turn:{id:'turn_fixture',status:'completed',items:[]}});
      }
    }
  });
`;
function setup(t: TestContext, mode = "ok", startupDelayMs = 0) {
  let fixtureChild: ReturnType<typeof spawn> | undefined;
  let current = { ...binding },
    launches = 0,
    stops = 0;
  const modes: string[] = [];
  const ports: CodexTaskPorts = {
    readBinding: async () => ({ ...current }),
    prepare: async () => ({
      cwd: process.cwd(),
      model: "fixture-model",
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      config: {},
      secrets: ["fixture-private-token"],
    }),
    launch: async (prepared) => {
      launches++;
      const child = spawn(
        process.execPath,
        [
          "-e",
          startupDelayMs
            ? `setTimeout(() => {${script}}, ${startupDelayMs})`
            : script,
          mode,
          JSON.stringify(prepared),
        ],
        {
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      fixtureChild = child;
      t.after(() => child.kill());
      return {
        child,
        stop: async () => {
          stops++;
          child.kill();
        },
      };
    },
    approve: async () => {
      modes.push("approval");
      return "decline";
    },
  };
  return {
    ports,
    modes,
    withdrawApproval: () => {
      assert.ok(fixtureChild?.stdin);
      fixtureChild.stdin.write(
        JSON.stringify({ method: "fixture/withdrawApproval" }) + "\n",
      );
    },
    change: (patch: Partial<CodexTaskBinding>) => {
      current = { ...current, ...patch };
    },
    get launches() {
      return launches;
    },
    get stops() {
      return stops;
    },
  };
}

test("a native cleared approval cancels its callback without failing a separately completed turn", async (t) => {
  const fixture = setup(t, "cleared_approval");
  let cancelled = false;
  fixture.ports.approve = async (_request, _binding, signal) => {
    assert.ok(signal);
    const aborted = new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    // Withdraw only after the callback has begun waiting. A fixed child timer
    // can expire before stdout delivery on a loaded native runner.
    fixture.withdrawApproval();
    await aborted;
    cancelled = true;
    throw new Error("fixture-private-cancelled-approval-diagnostic");
  };
  const result = await runCodexTask(input, fixture.ports);
  assert.equal(result.status, "completed");
  assert.equal(result.deliverableVerified, false);
  assert.equal(cancelled, true);
  assert.equal(fixture.stops, 1);
});
const input = {
  binding,
  prompt: "Complete the fixture job",
  requestTimeoutMs: 1000,
  turnTimeoutMs: 1500,
  fenceIntervalMs: 25,
};

test("a final turn admission is awaited before inference and cannot be skipped by child launch", async (t) => {
  const fixture = setup(t, "ok");
  let checks = 0;
  const ports = {
    ...fixture.ports,
    beforeTurnStart: async (submitted: CodexTaskBinding) => {
      checks++;
      assert.deepEqual(submitted, binding);
      throw new CodexTaskError("unsupported_capability");
    },
  };
  await assert.rejects(runCodexTask(input, ports), {
    kind: "unsupported_capability",
    requestStarted: false,
  });
  assert.equal(checks, 1);
  assert.equal(fixture.stops, 1);
});

test("ownership is rechecked after the final turn admission yields", async (t) => {
  const fixture = setup(t, "ok");
  let checks = 0;
  const ports = {
    ...fixture.ports,
    beforeTurnStart: async () => {
      checks++;
      fixture.change({ registrationRevision: 999 });
    },
  };
  await assert.rejects(runCodexTask(input, ports), {
    kind: "ownership_lost",
    requestStarted: false,
  });
  assert.equal(checks, 1);
  assert.equal(fixture.stops, 1);
});

test("EOF after inference starts retains the actual started boundary even without a usage report", async (t) => {
  const fixture = setup(t, "eof");
  await assert.rejects(runCodexTask(input, fixture.ports), {
    requestStarted: true,
    usage: null,
  });
  assert.equal(fixture.stops, 1);
});

test("a patch approval without a captured native patch cannot reach the human bridge", async (t) => {
  const fixture = setup(t, "missing_patch");
  await assert.rejects(runCodexTask(input, fixture.ports), {
    kind: "protocol",
  });
  assert.deepEqual(fixture.modes, []);
  assert.equal(fixture.stops, 1);
});

test("a patch changed during review withdraws the exact action and cannot use a late accept", async (t) => {
  const fixture = setup(t, "changed_patch");
  let cancelled = false;
  fixture.ports.approve = async (_request, _binding, signal) => {
    assert.ok(signal);
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    cancelled = true;
    return "accept";
  };
  await assert.rejects(runCodexTask(input, fixture.ports), {
    kind: "protocol",
  });
  assert.equal(cancelled, true);
  assert.equal(fixture.stops, 1);
});

test("the human bridge receives a frozen exact patch and the actual terminal item receipt", async (t) => {
  const fixture = setup(t, "patch_receipt");
  fixture.ports.approve = async (request) => {
    const reviewed = request as typeof request & {
      action: {
        digest: string;
        effect: { type: string; changes: { diff: string }[] };
      };
    };
    assert.match(reviewed.action.digest, /^[a-f0-9]{64}$/);
    assert.equal(reviewed.action.effect.type, "fileChange");
    assert.equal(reviewed.action.effect.changes[0].diff, "A useful result\n");
    assert.equal(Object.isFrozen(reviewed.action.effect.changes[0]), true);
    return "accept";
  };
  const result = await runCodexTask(input, fixture.ports);
  const receipts = (
    result as typeof result & {
      actionReceipts: { status: string; proofScope: string }[];
    }
  ).actionReceipts;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, "completed");
  assert.equal(receipts[0].proofScope, "codex_item");
  assert.equal(result.deliverableVerified, false);
});

test("a terminal native receipt is durably acknowledged before the completed turn returns", async (t) => {
  const fixture = setup(t, "patch_receipt");
  fixture.ports.approve = async () => "accept";
  let persisted = false;
  const ports = {
    ...fixture.ports,
    onActionReceipt: async (
      receipt: { proofScope: string; status: string },
      submitted: CodexTaskBinding,
    ) => {
      assert.equal(receipt.proofScope, "codex_item");
      assert.equal(receipt.status, "completed");
      assert.deepEqual(submitted, binding);
      await new Promise((resolve) => setTimeout(resolve, 40));
      persisted = true;
    },
  };
  const result = await runCodexTask(input, ports);
  assert.equal(persisted, true);
  assert.equal(result.status, "completed");
  assert.equal(result.actionReceipts.length, 1);
});

for (const startupDelayMs of [0, 300])
  for (const stuck of [false, true])
    test(`a ${stuck ? "stalled" : "failed"} receipt store cannot create a completed checkpoint or discard an observed item${startupDelayMs ? " after a delayed child start" : ""}`, async (t) => {
      const fixture = setup(t, "patch_receipt", startupDelayMs);
      fixture.ports.approve = async () => "accept";
      const ports = {
        ...fixture.ports,
        onActionReceipt: async () => {
          if (stuck) await new Promise<void>(() => {});
          else throw new Error("fixture-private-receipt-store-diagnostic");
        },
      };
      await assert.rejects(
        // Use the normal bounded fixture deadline. A 200ms startup race can
        // expire during initialize, before this receipt-store failure is tested.
        runCodexTask(input, ports),
        (error: unknown) => {
          assert.ok(
            error &&
              typeof error === "object" &&
              "kind" in error &&
              "requestStarted" in error &&
              "actionReceipts" in error,
          );
          assert.equal(error.kind, stuck ? "timeout" : "protocol");
          assert.equal(error.requestStarted, true);
          assert.equal((error.actionReceipts as unknown[]).length, 1);
          assert.equal(
            (error.actionReceipts as { status: string }[])[0].status,
            "completed",
          );
          assert.doesNotMatch(String(error), /fixture-private/);
          return true;
        },
      );
      assert.equal(fixture.stops, 1);
    });

for (const mode of ["receipt_mismatch", "unfinished_patch"]) {
  test(`${mode} cannot become an accepted terminal coding checkpoint`, async (t) => {
    const fixture = setup(t, mode);
    fixture.ports.approve = async () => "accept";
    await assert.rejects(runCodexTask(input, fixture.ports), {
      kind: "protocol",
    });
  });
}

function profileSetup(t: TestContext, mode = "ok") {
  const fixture = setup(t, mode);
  const built = buildCodexTaskConfiguration({
    cwd: process.cwd(),
    executable: process.execPath,
    home: path.resolve(process.cwd(), "../owned-private-home"),
    model: "fixture-model",
    policy: { mode: "approval" },
    canUseTerminal: true,
    processExecEnabled: true,
  });
  fixture.ports.prepare = async () => ({
    cwd: process.cwd(),
    model: "fixture-model",
    approvalPolicy: built.approvalPolicy,
    permissions: built.permissions,
    config: {},
    secrets: [],
  });
  return fixture;
}

test("named Codex permissions use experimental profile inspection, exact workspace roots and no legacy sandbox or model fallback", async (t) => {
  const fixture = profileSetup(t);
  assert.equal((await runCodexTask(input, fixture.ports)).status, "completed");
  assert.equal(fixture.stops, 1);
});
for (const mode of [
  "profile_changed",
  "profile_denied",
  "profile_inherited",
  "profile_roots_changed",
  "profile_unsupported",
]) {
  test(`Codex ${mode} refuses inference before a coding turn`, async (t) => {
    const fixture = profileSetup(t, mode);
    await assert.rejects(runCodexTask(input, fixture.ports), {
      kind: "unsupported_capability",
      usage: null,
    });
    assert.equal(fixture.stops, 1);
  });
}
test("conflicting, broad or overrideable named permissions are rejected before child launch", async (t) => {
  for (const patch of [
    { sandboxPolicy: { type: "dangerFullAccess" } },
    { config: { default_permissions: ":danger-full-access" } },
    {
      permissions: {
        id: "acos_task",
        runtimeWorkspaceRoots: ["/outside"],
        runtimeExecutable: process.execPath,
        definition: {
          filesystem: { ":root": "read" },
          network: { enabled: false },
        },
        configuration: { file: "fixture", values: {} },
      },
    },
  ]) {
    const fixture = profileSetup(t),
      original = fixture.ports.prepare;
    fixture.ports.prepare = async (binding) => ({
      ...(await original(binding)),
      ...patch,
    });
    await assert.rejects(runCodexTask(input, fixture.ports), {
      kind: "unsupported_capability",
    });
    assert.equal(fixture.launches, 0);
  }
  const advertisedOnly = profileSetup(t),
    original = advertisedOnly.ports.prepare;
  advertisedOnly.ports.prepare = async (binding) => ({
    ...(await original(binding)),
    approvalPolicy: "untrusted" as never,
  });
  await assert.rejects(runCodexTask(input, advertisedOnly.ports), {
    kind: "unsupported_capability",
  });
  assert.equal(advertisedOnly.launches, 0);
});

test("named permissions cannot add a second file read or make the verified runtime file writable", async (t) => {
  for (const patch of [
    { [path.resolve(process.cwd(), "../outside-private-file")]: "read" },
    { [process.execPath]: "write" },
    { [path.dirname(process.execPath)]: "read" },
  ]) {
    const fixture = profileSetup(t),
      original = fixture.ports.prepare;
    fixture.ports.prepare = async (binding) => {
      const prepared = await original(binding);
      assert.ok(prepared.permissions);
      return {
        ...prepared,
        permissions: {
          ...prepared.permissions,
          definition: {
            ...prepared.permissions.definition,
            filesystem: {
              ...(prepared.permissions.definition.filesystem as Record<
                string,
                unknown
              >),
              ...patch,
            },
          },
        },
      };
    };
    await assert.rejects(runCodexTask(input, fixture.ports), {
      kind: "unsupported_capability",
      cleanupState: "not_launched",
    });
    assert.equal(fixture.launches, 0);
  }
});

test("named permissions reject missing or rebound runtime file metadata before launch", async (t) => {
  for (const runtimeExecutable of [
    undefined,
    path.dirname(process.execPath),
    path.join(process.cwd(), "untrusted-cli"),
    "relative-cli",
  ]) {
    const fixture = profileSetup(t),
      original = fixture.ports.prepare;
    fixture.ports.prepare = async (binding) => {
      const prepared = await original(binding);
      assert.ok(prepared.permissions);
      return {
        ...prepared,
        permissions: {
          ...prepared.permissions,
          runtimeExecutable: runtimeExecutable as string,
        },
      };
    };
    await assert.rejects(runCodexTask(input, fixture.ports), {
      kind: "unsupported_capability",
      cleanupState: "not_launched",
    });
    assert.equal(fixture.launches, 0);
  }
});

test("owned Codex terminal completion binds replies before immediately following notifications and retains truthful proof scope", async (t) => {
  const fixture = setup(t);
  const result = await runCodexTask(input, fixture.ports);
  assert.equal(result.status, "completed");
  assert.equal(result.threadId, "thread_fixture");
  assert.equal(result.turnId, "turn_fixture");
  assert.deepEqual(result.usage, {
    promptTokens: 13,
    completionTokens: 12,
    totalTokens: 25,
  });
  assert.equal(result.proofScope, "codex_turn");
  assert.equal(result.deliverableVerified, false);
  assert.equal(result.text.includes("fixture-private-token"), false);
  assert.equal(fixture.launches, 1);
  assert.equal(fixture.stops, 1);
});
test("missing Codex usage remains unknown and reported thread totals never use only last model-call counters", async (t) => {
  const fixture = setup(t, "unknown_usage");
  const result = await runCodexTask(input, fixture.ports);
  assert.equal(result.usage, null);
});
for (const [mode, kind] of [
  ["eof", "interrupted"],
  ["wrong_turn", "protocol"],
  ["failed", "turn_failed"],
  ["interrupted", "interrupted"],
] as const) {
  test(`Codex ${mode} cannot become a completed owned task`, async (t) => {
    const fixture = setup(t, mode);
    await assert.rejects(runCodexTask(input, fixture.ports), { kind });
    assert.equal(fixture.stops, 1);
  });
}
test("lost account revision on a silent child terminates the owned process without requiring another notification", async (t) => {
  const fixture = setup(t, "wait");
  const result = runCodexTask(input, fixture.ports);
  setTimeout(() => fixture.change({ registrationRevision: 7 }), 100);
  await assert.rejects(result, { kind: "ownership_lost" });
  assert.equal(fixture.stops, 1);
});
test("changed attempt or policy before launch and unsupported prepared capability cannot launch a coding child", async (t) => {
  const fixture = setup(t);
  fixture.change({ attemptId: "00000000-0000-4000-8000-000000000073" });
  await assert.rejects(runCodexTask(input, fixture.ports), {
    kind: "ownership_lost",
  });
  assert.equal(fixture.launches, 0);
  fixture.change({ attemptId: "00000000-0000-4000-8000-000000000072" });
  fixture.ports.prepare = async () => {
    throw new Error("private unsupported detail");
  };
  await assert.rejects(runCodexTask(input, fixture.ports), {
    kind: "unsupported_capability",
  });
  assert.equal(fixture.launches, 0);
});
test("a cancelled child and a nonterminal turn deadline stop only that owned runtime", async (t) => {
  const fixture = setup(t, "wait"),
    controller = new AbortController();
  const result = runCodexTask(
    { ...input, signal: controller.signal },
    fixture.ports,
  );
  setTimeout(() => controller.abort("private reason"), 100);
  await assert.rejects(result, { kind: "cancelled" });
  const deadline = setup(t, "wait");
  await assert.rejects(
    runCodexTask({ ...input, turnTimeoutMs: 150 }, deadline.ports),
    { kind: "timeout" },
  );
  assert.equal(fixture.stops, 1);
  assert.equal(deadline.stops, 1);
});
test("an explicit scoped approval is fenced again and session-wide write grants never reach the durable approval bridge", async (t) => {
  const fixture = setup(t, "approval");
  fixture.ports.approve = async () => {
    fixture.change({ leaseOwner: "other_owner" });
    return "accept";
  };
  await assert.rejects(runCodexTask(input, fixture.ports), {
    kind: "ownership_lost",
  });
  const grant = setup(t, "grant");
  await assert.rejects(runCodexTask(input, grant.ports), {
    kind: "unsupported_capability",
  });
  assert.deepEqual(grant.modes, []);
});
test("steer is scoped to the active turn; interrupt acknowledgement cannot succeed the turn", async (t) => {
  const fixture = setup(t, "steer");
  const result = await runCodexTask(
    {
      ...input,
      onControl: (control) => {
        void control.steer("One bounded clarification");
      },
    },
    fixture.ports,
  );
  assert.equal(result.status, "completed");
  const interrupted = setup(t, "wait");
  await assert.rejects(
    runCodexTask(
      {
        ...input,
        onControl: (control) => {
          void control.interrupt();
        },
      },
      interrupted.ports,
    ),
    { kind: "interrupted" },
  );
});
test("backend-owned resume mapping cannot reuse a thread from a different account, task or workspace", async (t) => {
  const fixture = setup(t);
  fixture.ports.readSession = async () => ({
    threadId: "thread_fixture",
    binding: { ...binding, accountId: "another_account" },
    cwd: process.cwd(),
  });
  await assert.rejects(
    runCodexTask({ ...input, resume: true }, fixture.ports),
    { kind: "ownership_lost" },
  );
  assert.equal(fixture.launches, 0);
});
test("a terminal notification immediately after its turn-start reply has the exact server-issued scope", async (t) => {
  const fixture = setup(t, "instant");
  const result = await runCodexTask(input, fixture.ports);
  assert.equal(result.status, "completed");
  assert.equal(result.turnId, "turn_fixture");
});
test("failed completed-turn status preserves reported usage without exposing private runtime bodies", async (t) => {
  const fixture = setup(t, "failed");
  await assert.rejects(runCodexTask(input, fixture.ports), (error) => {
    assert.equal((error as { kind: string }).kind, "turn_failed");
    assert.deepEqual((error as { usage: unknown }).usage, {
      promptTokens: 13,
      completionTokens: 12,
      totalTokens: 25,
    });
    assert.equal(String(error).includes("fixture-private-token"), false);
    return true;
  });
});
test("a resume receipt subtracts its prior accepted cumulative counters, and unknown baselines stay unknown", async (t) => {
  const fixture = setup(t);
  fixture.ports.readSession = async () => ({
    threadId: "thread_fixture",
    binding: { ...binding },
    cwd: process.cwd(),
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
  });
  const result = await runCodexTask({ ...input, resume: true }, fixture.ports);
  assert.deepEqual(result.usage, {
    promptTokens: 3,
    completionTokens: 2,
    totalTokens: 5,
  });
  const unknown = setup(t);
  unknown.ports.readSession = async () => ({
    threadId: "thread_fixture",
    binding: { ...binding },
    cwd: process.cwd(),
    usage: null,
  });
  assert.equal(
    (await runCodexTask({ ...input, resume: true }, unknown.ports)).usage,
    null,
  );
});
test("cleanup evidence distinguishes no launch, ambiguous launch and acknowledged owned shutdown", async (t) => {
  const never = setup(t);
  never.ports.prepare = async () => {
    throw new CodexTaskError("unsupported_capability");
  };
  await assert.rejects(
    runCodexTask({ binding, prompt: "Fixture" }, never.ports),
    (error: CodexTaskError) => {
      assert.equal(error.cleanupState, "not_launched");
      assert.equal(error.requestStarted, false);
      return true;
    },
  );
  assert.equal(never.launches, 0);
  const ambiguous = setup(t);
  ambiguous.ports.launch = async () => {
    throw new Error("fixture-private-launch-error");
  };
  await assert.rejects(
    runCodexTask({ binding, prompt: "Fixture" }, ambiguous.ports),
    (error: CodexTaskError) => {
      assert.equal(error.cleanupState, "unknown");
      assert.equal(error.requestStarted, false);
      return true;
    },
  );
  const failed = setup(t, "failed");
  await assert.rejects(
    runCodexTask({ binding, prompt: "Fixture" }, failed.ports),
    (error: CodexTaskError) => {
      assert.equal(error.cleanupState, "verified");
      assert.equal(error.requestStarted, true);
      return true;
    },
  );
  assert.equal(failed.stops, 1);
});

test("a cleanup failure prevents a success receipt even after a completed terminal turn", async (t) => {
  const fixture = setup(t),
    original = fixture.ports.launch;
  fixture.ports.launch = async (...args) => {
    const owned = await original(...args);
    return {
      ...owned,
      stop: async () => {
        await owned.stop();
        throw new Error("private cleanup detail");
      },
    };
  };
  await assert.rejects(runCodexTask(input, fixture.ports), {
    kind: "cleanup_failed",
    cleanupState: "unknown",
  });
});

test("mutating the caller's expected binding cannot authorize a different account during the active turn", async (t) => {
  const fixture = setup(t, "steer"),
    submitted = { ...binding };
  await assert.rejects(
    runCodexTask(
      {
        ...input,
        binding: submitted,
        onControl: (control) => {
          submitted.accountId = "changed_account";
          fixture.change({ accountId: "changed_account" });
          void control.steer("Finish fixture").catch(() => {});
        },
      },
      fixture.ports,
    ),
    { kind: "ownership_lost" },
  );
});
