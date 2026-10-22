import assert from "node:assert/strict";
import test from "node:test";
import { projectDeliveryExport } from "./project-delivery-export";
import { loadProjectStudioCopy } from "./project-studio-copy";

test("delivery files contain the visible report, not unrelated task data or a title-based path", async () => {
  const c = await loadProjectStudioCopy("en");
  const project = {
    id: 42,
    title: "../Report Ω العربية 繁體 <script>",
    resultSummary:
      "  ## Saved report\n\n[Source](https://example.com/report)  ",
    autonomyMode: "finite" as const,
    brief: "PRIVATE-BRIEF",
    providerCredential: "PRIVATE-CREDENTIAL",
    activity: "PRIVATE-TOOL-OUTPUT",
  };
  const file = projectDeliveryExport(project, c, "Completed");
  assert.ok(file);
  assert.equal(file.filename, "project-42-summary.txt");
  assert.ok(file.text.includes(project.title));
  assert.ok(file.text.endsWith(project.resultSummary.trim() + "\n"));
  assert.ok(file.text.includes(c.deliveryExportNotice));
  assert.ok(file.text.includes("Current status: Completed"));
  for (const privateValue of [
    project.brief,
    project.providerCredential,
    project.activity,
  ])
    assert.ok(!file.text.includes(privateValue));
  assert.ok(!file.text.includes(c.cycleDeliveryNote));
});

test("recurring exports identify the saved summary and current state without inventing a delivery date", async () => {
  const c = await loadProjectStudioCopy("en");
  const file = projectDeliveryExport(
    {
      id: 101,
      title: "Daily review",
      resultSummary: "A previous one-off delivery retained after conversion.",
      autonomyMode: "continuous",
    },
    c,
    "In progress",
  );
  assert.ok(file);
  assert.ok(file.text.includes(c.cycleDeliveryNote));
  assert.ok(file.text.includes("Current status: In progress"));
  assert.ok(file.text.includes("previous one-off delivery"));
  assert.doesNotMatch(file.text, /\d{4}-\d{2}-\d{2}|verified|certified/iu);
});

test("empty delivery and invalid task identities cannot produce a downloadable file", async () => {
  const c = await loadProjectStudioCopy("en");
  const project = {
    id: 101,
    title: "Report",
    resultSummary: "Saved report",
    autonomyMode: "finite" as const,
  };
  for (const resultSummary of [null, "", " \n "])
    assert.equal(
      projectDeliveryExport({ ...project, resultSummary }, c, "Completed"),
      null,
    );
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(
      projectDeliveryExport({ ...project, id }, c, "Completed"),
      null,
    );
});
