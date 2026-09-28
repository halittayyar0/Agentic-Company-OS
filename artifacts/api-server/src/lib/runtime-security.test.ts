import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRuntimeConfiguration,
  readSyntheticRuntimeConfiguration,
} from "./runtime-security";

const CONFIG_KEYS = [
  "NODE_ENV",
  "RUNTIME_ROLE",
  "OPERATOR_AUTH_TOKEN",
  "RUNTIME_CONTROL_KEY",
  "RUNTIME_CONTROL_API_URL",
  "DATABASE_URL",
  "ALLOW_REMOTE_ACCESS",
  "TRUSTED_HOSTS",
  "CORS_ALLOWED_ORIGINS",
  "OPERATOR_SESSION_TTL_MS",
  "EMERGENCY_STOP_MONITOR_MS",
  "MAX_TASK_STEPS",
  "PROJECT_MEETING_MAX_RESPONDERS_PER_START",
  "PROJECT_MEETING_MAX_CONCURRENT_STARTS",
  "SYNTHETIC_RUNTIME_ENABLED",
  "SYNTHETIC_RUNTIME_SEED",
  "SYNTHETIC_RUNTIME_FAULT_PLAN",
  "SYNTHETIC_RUNTIME_CONTROL_FILE",
  "ENDURANCE_MODE",
  "ENDURANCE_RUN_ID",
  "ENDURANCE_RUN_DIR",
  "ENDURANCE_EXPECTED_AGENTS",
] as const;

async function withEnvironment(
  values: Partial<Record<(typeof CONFIG_KEYS)[number], string | undefined>>,
  run: () => void,
): Promise<void> {
  const previous = new Map(CONFIG_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of CONFIG_KEYS) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production fails closed without operator auth and durable PostgreSQL", async () => {
  await withEnvironment({ NODE_ENV: "production" }, () => {
    assert.throws(
      () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
      /OPERATOR_AUTH_TOKEN/,
    );
  });

  await withEnvironment(
    {
      NODE_ENV: "production",
      OPERATOR_AUTH_TOKEN: "x".repeat(32),
    },
    () => {
      assert.throws(
        () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
        /DATABASE_URL/,
      );
    },
  );
});

test("split API and worker roles require one shared PostgreSQL database even on loopback", async () => {
  for (const role of ["api", "worker"] as const) {
    await withEnvironment({ RUNTIME_ROLE: role }, () => {
      assert.throws(
        () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
        /split runtime roles require DATABASE_URL/,
      );
    });

    await withEnvironment(
      {
        RUNTIME_ROLE: role,
        DATABASE_URL: "postgresql://operator:secret@db.example/agentic",
        RUNTIME_CONTROL_KEY: "c".repeat(32),
        ...(role === "worker"
          ? {
              RUNTIME_CONTROL_API_URL:
                "http://app:5000/api/internal/runtime-control",
            }
          : {}),
      },
      () => {
        assert.doesNotThrow(() =>
          assertRuntimeConfiguration({ host: "127.0.0.1" }),
        );
      },
    );
  }

  await withEnvironment({ RUNTIME_ROLE: "combined" }, () => {
    assert.doesNotThrow(() =>
      assertRuntimeConfiguration({ host: "127.0.0.1" }),
    );
  });
});

test("split roles require a distinct control key and workers need no operator bearer", async () => {
  const durable = "postgresql://operator:secret@db.example/agentic";
  await withEnvironment({ RUNTIME_ROLE: "api", DATABASE_URL: durable }, () => {
    assert.throws(
      () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
      /RUNTIME_CONTROL_KEY/,
    );
  });
  await withEnvironment(
    {
      NODE_ENV: "production",
      RUNTIME_ROLE: "worker",
      DATABASE_URL: durable,
      RUNTIME_CONTROL_KEY: "c".repeat(32),
      RUNTIME_CONTROL_API_URL: "http://app:5000/api/internal/runtime-control",
    },
    () => {
      assert.doesNotThrow(() =>
        assertRuntimeConfiguration({ host: "127.0.0.1" }),
      );
    },
  );
});

test("durable combined installations require an encryption key for operator receipts", async () => {
  await withEnvironment(
    {
      RUNTIME_ROLE: "combined",
      DATABASE_URL: "postgresql://operator:secret@db.example/agentic",
    },
    () => {
      assert.throws(
        () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
        /RUNTIME_CONTROL_KEY/,
      );
    },
  );
});

test("remote mode requires the complete production boundary", async () => {
  const base = {
    OPERATOR_AUTH_TOKEN: "x".repeat(32),
    DATABASE_URL: "postgresql://operator:secret@db.example/agentic",
    RUNTIME_CONTROL_KEY: "c".repeat(32),
    ALLOW_REMOTE_ACCESS: "true",
    TRUSTED_HOSTS: "company-os.example.com",
    CORS_ALLOWED_ORIGINS: "https://company-os.example.com",
  } as const;

  await withEnvironment({ ...base, NODE_ENV: "development" }, () => {
    assert.throws(
      () => assertRuntimeConfiguration({ host: "0.0.0.0" }),
      /NODE_ENV=production/,
    );
  });

  await withEnvironment({ ...base, NODE_ENV: "production" }, () => {
    assert.doesNotThrow(() => assertRuntimeConfiguration({ host: "0.0.0.0" }));
  });

  await withEnvironment(
    {
      ...base,
      NODE_ENV: "production",
      CORS_ALLOWED_ORIGINS: "http://company-os.example.com",
    },
    () => {
      assert.throws(
        () => assertRuntimeConfiguration({ host: "0.0.0.0" }),
        /must use HTTPS/,
      );
    },
  );
});

test("session and emergency-stop intervals are bounded at startup", async () => {
  await withEnvironment({ OPERATOR_SESSION_TTL_MS: "NaN" }, () => {
    assert.throws(
      () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
      /OPERATOR_SESSION_TTL_MS/,
    );
  });
  await withEnvironment({ EMERGENCY_STOP_MONITOR_MS: "999" }, () => {
    assert.throws(
      () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
      /EMERGENCY_STOP_MONITOR_MS/,
    );
  });
});

test("production accepts MAX_TASK_STEPS=0 as disabled and rejects invalid bounds", async () => {
  const production = {
    NODE_ENV: "production",
    OPERATOR_AUTH_TOKEN: "x".repeat(32),
    DATABASE_URL: "postgresql://operator:secret@db.example/agentic",
    RUNTIME_CONTROL_KEY: "c".repeat(32),
  } as const;

  await withEnvironment({ ...production, MAX_TASK_STEPS: "0" }, () => {
    assert.doesNotThrow(() =>
      assertRuntimeConfiguration({ host: "127.0.0.1" }),
    );
  });
  await withEnvironment({ MAX_TASK_STEPS: "-1" }, () => {
    assert.throws(
      () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
      /MAX_TASK_STEPS/,
    );
  });
  await withEnvironment({ MAX_TASK_STEPS: "10001" }, () => {
    assert.throws(
      () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
      /MAX_TASK_STEPS/,
    );
  });
});

test("project meeting execution bounds fail closed at startup", async () => {
  await withEnvironment(
    { PROJECT_MEETING_MAX_RESPONDERS_PER_START: "33" },
    () => {
      assert.throws(
        () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
        /PROJECT_MEETING_MAX_RESPONDERS_PER_START/,
      );
    },
  );
  await withEnvironment({ PROJECT_MEETING_MAX_CONCURRENT_STARTS: "0" }, () => {
    assert.throws(
      () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
      /PROJECT_MEETING_MAX_CONCURRENT_STARTS/,
    );
  });
});

test("ordinary production runtime rejects synthetic endurance execution", async () => {
  await withEnvironment(
    {
      NODE_ENV: "production",
      SYNTHETIC_RUNTIME_ENABLED: "true",
      SYNTHETIC_RUNTIME_SEED: "240901",
      ENDURANCE_MODE: "soak",
      ENDURANCE_RUN_ID: "production-synthetic",
      ENDURANCE_RUN_DIR: "D:\\endurance\\production-synthetic",
      SYNTHETIC_RUNTIME_CONTROL_FILE:
        "D:\\endurance\\production-synthetic\\faults.json",
      OPERATOR_AUTH_TOKEN: "x".repeat(32),
      DATABASE_URL: "postgresql://operator:secret@db.example/agentic",
    },
    () => {
      assert.throws(
        () => assertRuntimeConfiguration({ host: "127.0.0.1" }),
        /synthetic.*production/iu,
      );
    },
  );
});

test("attested production endurance image accepts only the explicit soak contract", async () => {
  const base = {
    NODE_ENV: "production",
    SYNTHETIC_RUNTIME_ENABLED: "true",
    SYNTHETIC_RUNTIME_SEED: "240901",
    ENDURANCE_RUN_ID: "production-synthetic",
    ENDURANCE_RUN_DIR: "/app/endurance-control",
    SYNTHETIC_RUNTIME_CONTROL_FILE: "/app/endurance-control/fault-control.json",
    ENDURANCE_EXPECTED_AGENTS: "10",
  } as const;

  assert.throws(
    () =>
      readSyntheticRuntimeConfiguration(
        { ...base, ENDURANCE_MODE: "accelerated" },
        { productionAttestation: () => true },
      ),
    /soak/iu,
  );
  const config = readSyntheticRuntimeConfiguration(
    { ...base, ENDURANCE_MODE: "soak" },
    { productionAttestation: () => true },
  );
  assert.equal(config?.mode, "soak");
  assert.equal(config?.expectedAgents, 10);
});

test("synthetic runtime requires an explicit mode, run identity and canonical seed", async () => {
  const base = { SYNTHETIC_RUNTIME_ENABLED: "true" } as const;
  await withEnvironment(base, () => {
    assert.throws(
      () => readSyntheticRuntimeConfiguration(),
      /ENDURANCE_MODE/iu,
    );
  });
  await withEnvironment(
    {
      ...base,
      ENDURANCE_MODE: "accelerated",
      ENDURANCE_RUN_ID: "runtime-security-test",
      SYNTHETIC_RUNTIME_SEED: "01",
    },
    () => {
      assert.throws(() => readSyntheticRuntimeConfiguration(), /seed/iu);
    },
  );
  await withEnvironment(
    {
      ...base,
      ENDURANCE_MODE: "accelerated",
      ENDURANCE_RUN_ID: "runtime-security-test",
      SYNTHETIC_RUNTIME_SEED: "240901",
      SYNTHETIC_RUNTIME_FAULT_PLAN: '[{"outcome":"publish"}]',
    },
    () => {
      assert.throws(() => readSyntheticRuntimeConfiguration(), /fault plan/iu);
    },
  );
});

test("accelerated synthetic runtime accepts a validated in-memory plan", async () => {
  await withEnvironment(
    {
      NODE_ENV: "test",
      SYNTHETIC_RUNTIME_ENABLED: "true",
      SYNTHETIC_RUNTIME_SEED: "240901",
      SYNTHETIC_RUNTIME_FAULT_PLAN: "[]",
      ENDURANCE_MODE: "accelerated",
      ENDURANCE_RUN_ID: "accelerated-security-test",
      ENDURANCE_EXPECTED_AGENTS: "10",
    },
    () => {
      const config = readSyntheticRuntimeConfiguration();
      assert.equal(config?.mode, "accelerated");
      assert.equal(config?.seed, 240_901);
      assert.equal(config?.faultPlan.entries.length, 0);
      assert.equal(config?.expectedAgents, 10);
      assert.equal(config?.controlFile, null);
      assert.doesNotThrow(() =>
        assertRuntimeConfiguration({ host: "127.0.0.1" }),
      );
    },
  );
});

test("soak synthetic runtime requires one local run-scoped control file", async () => {
  const base = {
    NODE_ENV: "test",
    SYNTHETIC_RUNTIME_ENABLED: "true",
    SYNTHETIC_RUNTIME_SEED: "240901",
    ENDURANCE_MODE: "soak",
    ENDURANCE_RUN_ID: "soak-security-test",
  } as const;
  await withEnvironment(base, () => {
    assert.throws(
      () => readSyntheticRuntimeConfiguration(),
      /ENDURANCE_RUN_DIR/iu,
    );
  });
  await withEnvironment(
    {
      ...base,
      ENDURANCE_RUN_DIR: "D:\\endurance\\soak-security-test",
      SYNTHETIC_RUNTIME_CONTROL_FILE: "D:\\endurance\\outside\\faults.json",
    },
    () => {
      assert.throws(
        () => readSyntheticRuntimeConfiguration(),
        /directly inside/iu,
      );
    },
  );
  await withEnvironment(
    {
      ...base,
      ENDURANCE_RUN_DIR: "D:\\endurance\\soak-security-test",
      SYNTHETIC_RUNTIME_CONTROL_FILE:
        "D:\\endurance\\soak-security-test\\faults.json",
    },
    () => {
      const config = readSyntheticRuntimeConfiguration();
      assert.equal(config?.mode, "soak");
      assert.equal(
        config?.controlFile,
        "D:\\endurance\\soak-security-test\\faults.json",
      );
    },
  );
});
