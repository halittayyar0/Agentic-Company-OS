import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  measureTaskResultReviewBundle,
  resultReviewApiControl,
  resultReviewDownloadControl,
} from "./task-result-review-bundle-budget";
const root = "artifacts/agentic-company-os/src/";
function fixture(borrowed = false, extra = "") {
  const rows = [
    {
      fileName: "review.js",
      contents: Buffer.from("const review=true;" + extra),
      modules: [
        "components/tasks/operator-result-review.tsx",
        "components/tasks/operator-result-provenance.tsx",
        "lib/task-result-review-input.ts",
        "lib/task-result-review-copy.ts",
        ...(borrowed ? ["lib/markdown.tsx"] : []),
      ].map((p) => root + p),
    },
    ...["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"].map((locale) => ({
      fileName: `review-${locale}.js`,
      contents: Buffer.from(`const locale="${locale}";`),
      modules: [
        root + `lib/task-result-review-copy/result-review-${locale}.ts`,
      ],
    })),
  ];
  return {
    assets: rows.map(({ fileName, contents }) => ({ fileName, contents })),
    manifest: {
      schemaVersion: 1,
      chunks: rows.map((row) => ({
        fileName: "assets/" + row.fileName,
        sha256: createHash("sha256").update(row.contents).digest("hex"),
        modules: row.modules,
      })),
    },
  };
}
test("new review accounting distinguishes selected language from disk languages and rejects borrowed legacy code", () => {
  const f = fixture(),
    measured = measureTaskResultReviewBundle(f.assets, f.manifest);
  assert.ok(measured.globalRaw > measured.raw);
  const borrowed = fixture(true);
  assert.throws(() =>
    measureTaskResultReviewBundle(borrowed.assets, borrowed.manifest),
  );
  f.assets[0].contents = Buffer.from("tampered");
  assert.throws(() => measureTaskResultReviewBundle(f.assets, f.manifest));
  const oversized = fixture(false, "x".repeat(11000));
  assert.throws(() =>
    measureTaskResultReviewBundle(oversized.assets, oversized.manifest),
  );
});
test("review API credit removes only the exact new GET bindings and preserves adjacent existing code", () => {
  const text =
    'const url=id=>`/api/approvals/${id}/result-review`,load=async(id,options)=>fetcher(url(id),{...options,method:"GET"}),legacy="KEEP";export{legacy,load};';
  const a = { fileName: "index-fixture.js", contents: Buffer.from(text) },
    control = resultReviewApiControl(a);
  assert.ok(control.contents.includes('legacy="KEEP"'));
  assert.ok(control.contents.includes("export{legacy}"));
  assert.equal(
    resultReviewApiControl({
      ...a,
      contents: Buffer.from(text + 'const old="' + "x".repeat(4000) + '";'),
    }).raw,
    control.raw,
  );
  for (const changed of [
    text.replace('method:"GET"', 'method:"POST"'),
    text.replace("...options", "...different"),
    text.replace("/result-review", "/different"),
  ])
    assert.throws(() =>
      resultReviewApiControl({ ...a, contents: Buffer.from(changed) }),
    );
  const download =
    'const old=1,copy=useQuery({queryKey:["task-result-review-copy",lang],queryFn:async()=>(await preload(async()=>{const{loadTaskResultReviewCopy:load}=await import("./copy-fixture.js");return{loadTaskResultReviewCopy:load}},__vite__mapDeps([0]))).loadTaskResultReviewCopy(lang),enabled:project.completionAuthority==="operator",staleTime:1/0,retry:!1}),legacy="KEEP";';
  const d = resultReviewDownloadControl(
    { fileName: "download.js", contents: Buffer.from(download) },
    "copy-fixture.js",
  );
  assert.ok(d.contents.includes('old=1,legacy="KEEP"'));
  assert.throws(() =>
    resultReviewDownloadControl(
      {
        fileName: "download.js",
        contents: Buffer.from(
          download.replace(
            'enabled:project.completionAuthority==="operator"',
            "enabled:true",
          ),
        ),
      },
      "copy-fixture.js",
    ),
  );
});
