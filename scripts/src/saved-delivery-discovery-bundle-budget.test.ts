import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  measureSavedDeliveryLogic,
  measureSavedDeliveryLocales,
  savedDeliveryRouteControl,
  measureSavedDeliveryDiscovery,
  measureSavedDeliveryEntryExport,
} from "./saved-delivery-discovery-bundle-budget";
import { measureCodingRecoveryBundle } from "./coding-recovery-bundle-budget";

const root = "artifacts/agentic-company-os/src/";
const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"];
const gzip = (contents: Buffer) => gzipSync(contents, { level: 9 }).length;
// Exact shared style factory from qualified main N's native entry. Its body
// receives zero feature credit; only the newly emitted named export is new.
const factory =
  'Ue=De("inline-flex min-w-0 max-w-full cursor-pointer items-center justify-center gap-2 whitespace-normal rounded-control text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-px motion-reduce:transform-none",{variants:{variant:{default:"bg-primary text-primary-foreground border border-primary-border hover:bg-primary/90",destructive:"bg-destructive text-destructive-foreground shadow-sm border-destructive-border hover:bg-destructive/90",outline:"border [border-color:var(--button-outline)] hover:bg-accent hover:text-accent-foreground",secondary:"border bg-secondary text-secondary-foreground border-secondary-border hover:bg-secondary/80",ghost:"border border-transparent hover:bg-accent hover:text-accent-foreground",link:"text-primary underline-offset-4 hover:underline"},size:{default:"min-h-11 px-4 py-2 md:min-h-9",touch:"min-h-[max(2.75rem,44px)] px-4 py-2",sm:"min-h-10 rounded-control px-3 text-sm md:min-h-8",lg:"min-h-12 rounded-control px-8 md:min-h-10",icon:"h-11 w-11 md:h-9 md:w-9"}},defaultVariants:{variant:"default",size:"default"}})';
function fixture() {
  const assets = [
    {
      fileName: "delivery-nav-fixture.js",
      contents: Buffer.from("new navigation".repeat(80)),
    },
    ...locales.map((locale, i) => ({
      fileName: `studio-${locale}-fixture.js`,
      contents: Buffer.from(
        `const c={legacy:"${"old".repeat(25 + i)}",viewSavedDelivery:"${locale}",other:"preserve"};export{c as default};`,
      ),
    })),
  ];
  const manifest = {
    schemaVersion: 1,
    chunks: assets.map((asset, i) => ({
      fileName: "assets/" + asset.fileName,
      sha256: createHash("sha256").update(asset.contents).digest("hex"),
      modules: [
        root +
          (i === 0
            ? "components/studio/project-delivery-jump.tsx"
            : `lib/project-studio-copy/studio-${locales[i - 1]}.ts`),
      ],
    })),
  };
  const update = (i: number, text: string | Buffer) => {
    assets[i].contents = Buffer.from(text);
    manifest.chunks[i].sha256 = createHash("sha256")
      .update(assets[i].contents)
      .digest("hex");
  };
  return { assets, manifest, update };
}

test("saved delivery credit requires exclusive hash-bound navigation and exactly seven owned label fields", () => {
  const { assets, manifest } = fixture();
  const logic = measureSavedDeliveryLogic(assets, manifest);
  assert.equal(logic.raw, assets[0].contents.length);
  assert.equal(logic.gzip, gzip(assets[0].contents));
  const labels = measureSavedDeliveryLocales(assets, manifest);
  assert.equal(labels.controls.length, 7);
  for (const [i, control] of labels.controls.entries()) {
    assert.equal(
      control.contents.toString(),
      assets[i + 1].contents
        .toString()
        .replace(/viewSavedDelivery:"[^"]*",/u, ""),
    );
  }
  assert.equal(
    labels.raw,
    Math.max(...assets.slice(1).map((a) => a.contents.length)) -
      Math.max(...labels.controls.map((a) => a.contents.length)),
  );
  assert.equal(
    labels.gzip,
    Math.max(...assets.slice(1).map((a) => gzip(a.contents))) -
      Math.max(...labels.controls.map((a) => gzip(a.contents))),
  );
});

const route = () =>
  Buffer.from(
    'import{B as B,am as styles}from"./index-fixture.js";const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/legacy.js","assets/delivery-nav-fixture.js"])))=>i.map(i=>d[i]);const Nav=R.lazy(()=>preload(()=>import("./delivery-nav-fixture.js"),__vite__mapDeps([1])));function Detail(){const old=legacy(),o=R.useRef(null),keep=unrelated(),z=j.jsx("a",{id:"project-delivery-link",href:"#project-delivery-heading",className:styles({variant:"outline",size:"touch",className:"mt-3"}),onClick:q=>{if(q.defaultPrevented||q.button!==0||q.altKey||q.ctrlKey||q.metaKey||q.shiftKey||window.location.hash==="#project-delivery-heading")return;const s=[];for(let w=q.currentTarget.parentElement;w;w=w.parentElement)(w.scrollHeight>w.clientHeight||w.scrollWidth>w.clientWidth)&&s.push({node:w,top:w.scrollTop,left:w.scrollLeft});o.current={url:window.location.href,scroll:s}},children:c.viewSavedDelivery});return j.jsxs("main",{children:[existing(),p.resultSummary?.trim()?j.jsxs(j.Fragment,{children:[z,j.jsx(EB,{resetKey:id,FallbackComponent:()=>null,children:j.jsx(R.Suspense,{fallback:null,children:j.jsx(Nav,{origin:o})})})]}):null,j.jsxs("h2",{id:"project-delivery-heading",tabIndex:-1,className:"flex scroll-mt-20 items-center gap-2 rounded-control text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",children:existingDelivery()}),unrelated()]})}',
  );

test("only the new source-bound style export is removed before older entry growth accounting", () => {
  const f = fixture();
  const routeAsset = {
    fileName: "detail-fixture.js",
    contents: route(),
  };
  const entry = {
    fileName: "index-fixture.js",
    contents: Buffer.from(
      "const kept=1," + factory + ";export{kept as old,Ue as am};",
    ),
  };
  f.assets.push(routeAsset, entry);
  f.manifest.chunks.push(
    ...[routeAsset, entry].map((a, i) => ({
      fileName: "assets/" + a.fileName,
      sha256: createHash("sha256").update(a.contents).digest("hex"),
      modules:
        i === 0
          ? [
              root + "pages/tasks/detail.tsx",
              root + "components/studio/project-delivery-summary.tsx",
            ]
          : [root + "components/ui/button.tsx"],
    })),
  );
  const control = measureSavedDeliveryEntryExport(f.assets, f.manifest);
  assert.equal(
    control.contents.toString(),
    entry.contents.toString().replace(",Ue as am", ""),
  );
  assert.equal(control.raw, 9);
  assert.ok(control.contents.includes(factory));
  const update = (text: string) => {
    entry.contents = Buffer.from(text);
    f.manifest.chunks.at(-1)!.sha256 = createHash("sha256")
      .update(entry.contents)
      .digest("hex");
  };
  update(entry.contents.toString().replace("Ue as am", "kept as am"));
  assert.throws(
    () => measureSavedDeliveryEntryExport(f.assets, f.manifest),
    /factory/u,
  );
  update(
    "const kept=1," +
      factory.replace("cursor-pointer", "cursor-auto") +
      ";export{kept as old,Ue as am};",
  );
  assert.throws(
    () => measureSavedDeliveryEntryExport(f.assets, f.manifest),
    /factory/u,
  );
});
test("route credit removes only the verified lazy behavior, stable native anchor, ref, mount, metadata and new heading attributes", () => {
  const original = route();
  const measured = savedDeliveryRouteControl(
    { fileName: "detail-fixture.js", contents: original },
    "delivery-nav-fixture.js",
  );
  const control = measured.contents.toString();
  for (const kept of [
    '"assets/legacy.js"',
    "old=legacy()",
    "keep=unrelated()",
    "existing()",
    "existingDelivery()",
    "unrelated()",
    'className:"flex items-center gap-2 text-base font-semibold"',
  ])
    assert.ok(control.includes(kept), kept);
  for (const removed of [
    "viewSavedDelivery",
    "tabIndex:-1",
    ".useRef(null)",
    "R.lazy(",
    "delivery-nav-fixture",
    "p.resultSummary?.trim()",
    "am as styles",
  ])
    assert.ok(!control.includes(removed), removed);
  assert.equal(measured.raw, original.length - measured.contents.length);
  const unrelatedGrowth = Buffer.from(
    original
      .toString()
      .replace(
        "existingDelivery()",
        'existingDelivery("' + "unrelated".repeat(100) + '")',
      ),
  );
  const grown = savedDeliveryRouteControl(
    { fileName: "detail-fixture.js", contents: unrelatedGrowth },
    "delivery-nav-fixture.js",
  );
  assert.equal(grown.raw, measured.raw);
  assert.equal(grown.contents.length - measured.contents.length, 902);
});

test("ambiguous, expanded or changed route wiring cannot be excused as delivery integration", () => {
  for (const change of [
    (s: string) =>
      s +
      ';const duplicate=R.lazy(()=>preload(()=>import("./delivery-nav-fixture.js"),__vite__mapDeps([1])));',
    (s: string) => s.replace("origin:o}", "anchor:h,unrelated:other()}"),
    (s: string) =>
      s.replace(
        "FallbackComponent:()=>null",
        "FallbackComponent:()=>existing()",
      ),
    (s: string) => s.replace('className:"mt-3"', 'className:"mt-3 unrelated"'),
    (s: string) => s.replace("tabIndex:-1", "tabIndex:0"),
    (s: string) => s.replace("flex scroll-mt-20", "flex extra scroll-mt-20"),
    (s: string) => s + ";function oldConsumer(){return __vite__mapDeps([1])}",
    (s: string) =>
      s.replace(
        '"assets/delivery-nav-fixture.js"]',
        '"assets/delivery-nav-fixture.js","assets/unrelated.js"]',
      ),
    (s: string) => s.replace("__vite__mapDeps([1])", "__vite__mapDeps([0])"),
    (s: string) => s.replace("./index-fixture.js", "./unrelated-fixture.js"),
    (s: string) =>
      s.replace('id:"project-delivery-link"', 'id:"unrelated-link"'),
    (s: string) => s.replace("q.defaultPrevented||", ""),
    (s: string) => s.replace("q.button!==0", "q.button!==1"),
    (s: string) =>
      s.replace("url:window.location.href,scroll:s", "url:other(),scroll:s"),
    (s: string) =>
      s.replace(
        "scroll:s}},children",
        'scroll:s};fetch("/api/work")},children',
      ),
    (s: string) =>
      s.replace("w.scrollTop,left:w.scrollLeft", "0,left:w.scrollLeft"),
    (s: string) => s.replace("origin:o}", "anchor:h,origin:keep}"),
    (s: string) => s.replace("o=R.useRef(null)", "o=R.useRef({})"),
  ])
    assert.throws(() =>
      savedDeliveryRouteControl(
        {
          fileName: "detail-fixture.js",
          contents: Buffer.from(change(route().toString())),
        },
        "delivery-nav-fixture.js",
      ),
    );
});

test("reconstructed route prevents older recovery overlap and still rejects unrelated legacy growth", () => {
  const contents = Buffer.concat([
    route(),
    Buffer.from(';const marker="budget-task-resume-coding-session-recovery-";'),
  ]);
  const initial = savedDeliveryRouteControl(
    { fileName: "detail-fixture.js", contents },
    "delivery-nav-fixture.js",
  );
  const padded = Buffer.concat([
    contents,
    Buffer.from(" ".repeat(120600 - initial.contents.length)),
  ]);
  const clean = savedDeliveryRouteControl(
    { fileName: "detail-fixture.js", contents: padded },
    "delivery-nav-fixture.js",
  );
  const recovery = (contents: Buffer) => [
    { fileName: "detail-fixture.js", contents },
    {
      fileName: "coding-session-recovery-fixture.js",
      contents: Buffer.alloc(7000, 120),
    },
    ...locales.map((locale) => ({
      fileName: `coding-recovery-${locale}-fixture.js`,
      contents: Buffer.alloc(2000, 120),
    })),
  ];
  assert.throws(
    () => measureCodingRecoveryBundle(recovery(padded)),
    /500 raw/u,
  );
  assert.equal(
    measureCodingRecoveryBundle(recovery(clean.contents)).integrationRaw,
    200,
  );
  assert.equal(clean.raw, initial.raw);
  const unrelated = savedDeliveryRouteControl(
    {
      fileName: "detail-fixture.js",
      contents: Buffer.concat([padded, Buffer.from(" ".repeat(301))]),
    },
    "delivery-nav-fixture.js",
  );
  assert.equal(unrelated.raw, clean.raw);
  assert.throws(
    () => measureCodingRecoveryBundle(recovery(unrelated.contents)),
    /500 raw/u,
  );
});

test("combined source-owned scope has its own cap even when its individual pieces pass", () => {
  const f = fixture();
  const originalName = f.assets[0].fileName;
  const routeBytes = route();
  const measured = savedDeliveryRouteControl(
    { fileName: "detail-fixture.js", contents: routeBytes },
    originalName,
  );
  const logicName =
    "delivery-nav-" +
    "x".repeat(
      Math.floor((1190 - measured.raw) / 2) +
        originalName.length -
        "delivery-nav-".length -
        ".js".length,
    ) +
    ".js";
  const longRoute = Buffer.from(
    routeBytes.toString().replaceAll(originalName, logicName),
  );
  assert.ok(
    savedDeliveryRouteControl(
      { fileName: "detail-fixture.js", contents: longRoute },
      logicName,
    ).raw <= 1200,
  );
  f.assets[0].fileName = logicName;
  f.manifest.chunks[0].fileName = "assets/" + logicName;
  f.update(0, Buffer.alloc(1800, 120));
  f.assets.push({ fileName: "detail-fixture.js", contents: longRoute });
  f.manifest.chunks.push({
    fileName: "assets/detail-fixture.js",
    sha256: createHash("sha256").update(longRoute).digest("hex"),
    modules: [
      root + "pages/tasks/detail.tsx",
      root + "components/studio/project-delivery-summary.tsx",
    ],
  });
  assert.throws(
    () => measureSavedDeliveryDiscovery(f.assets, f.manifest),
    /discovery exceeds its independent cap/u,
  );
});

test("legacy locale growth stays charged and peak changes cannot receive another language's label credit", () => {
  const f = fixture();
  f.update(
    1,
    'const c={legacy:"' +
      "x".repeat(900) +
      '",viewSavedDelivery:"tr",other:"preserve"};',
  );
  const before = measureSavedDeliveryLocales(f.assets, f.manifest);
  f.update(
    1,
    f.assets[1].contents
      .toString()
      .replace('legacy:"', 'legacy:"' + "unrelated".repeat(100)),
  );
  const after = measureSavedDeliveryLocales(f.assets, f.manifest);
  assert.equal(after.raw, before.raw);
  assert.equal(
    after.controls[0].contents.length - before.controls[0].contents.length,
    900,
  );
  f.update(
    2,
    'const c={legacy:"tiny",viewSavedDelivery:"' +
      "label".repeat(12) +
      '",other:"preserve"};',
  );
  const differentPeak = measureSavedDeliveryLocales(f.assets, f.manifest);
  assert.equal(differentPeak.raw, before.raw);
  assert.ok(
    differentPeak.raw < Math.max(...differentPeak.controls.map((a) => a.raw)),
  );
});

test("unrelated ownership, tampered bytes, duplicate/missing fields and raw/gzip inflation earn no delivery credit", () => {
  const shared = fixture();
  shared.manifest.chunks[0].modules.push(root + "lib/markdown.tsx");
  assert.throws(
    () => measureSavedDeliveryLogic(shared.assets, shared.manifest),
    /unrelated source/u,
  );
  const changed = fixture();
  changed.assets[0].contents = Buffer.from("changed");
  assert.throws(
    () => measureSavedDeliveryLogic(changed.assets, changed.manifest),
    /hash mismatch/u,
  );
  const missing = fixture();
  missing.update(1, 'const c={legacy:"preserve"};');
  assert.throws(
    () => measureSavedDeliveryLocales(missing.assets, missing.manifest),
    /label/u,
  );
  const duplicate = fixture();
  duplicate.update(
    1,
    'const c={viewSavedDelivery:"a",viewSavedDelivery:"b",legacy:"preserve"};',
  );
  assert.throws(
    () => measureSavedDeliveryLocales(duplicate.assets, duplicate.manifest),
    /label/u,
  );
  const nested = fixture();
  nested.update(
    1,
    'const c={viewSavedDelivery:{private:"not a label"},legacy:"preserve"};',
  );
  assert.throws(
    () => measureSavedDeliveryLocales(nested.assets, nested.manifest),
    /label/u,
  );
  const large = fixture();
  large.update(0, Buffer.alloc(1801, 120));
  assert.throws(
    () => measureSavedDeliveryLogic(large.assets, large.manifest),
    /independent cap/u,
  );
  const compressed = fixture();
  compressed.update(
    0,
    Buffer.concat(
      Array.from({ length: 45 }, (_, i) =>
        createHash("sha256").update(String(i)).digest(),
      ),
    ),
  );
  assert.throws(
    () => measureSavedDeliveryLogic(compressed.assets, compressed.manifest),
    /independent cap/u,
  );
  const largeLabel = fixture();
  largeLabel.update(
    1,
    'const c={viewSavedDelivery:"' + "x".repeat(110) + '",legacy:"preserve"};',
  );
  assert.throws(
    () => measureSavedDeliveryLocales(largeLabel.assets, largeLabel.manifest),
    /independent cap/u,
  );
});
