# Bundle performance checks

The production build keeps limits for total transfer, individual assets, language packs and separately measured features. Run the checks from the repository root with Node 24 and the pinned pnpm version:

```sh
pnpm build
pnpm --filter @workspace/scripts run check:bundle
```

The compiler writes a private `dist/bundle-budget-manifest.json`. It records each JavaScript asset's final SHA-256 and repository source modules. The checker verifies the actual emitted bytes and source ownership before measuring a feature.

## Model privacy controls

Local, cloud and unknown model labels add a small shared component and guards to the existing model choices. Their budget measures growth over the previous model-choice implementation, so existing search and settings code stay charged to their original limits.

The comparison uses the frontend sources from `025309ee63fc5d4e346e493ba9727ccea97e3eb0`, compiled with the current compiler, lockfile and authored language packs. The five source overlays are:

- `components/agent/agent-model-picker.tsx`
- `components/model-picker.tsx`
- `components/studio/guided-model-connection.tsx`
- `lib/model-search.ts`
- `pages/settings.tsx`

Paths above are relative to `artifacts/agentic-company-os/src`. The older `components/model-picker.tsx` is absent from the emitted module inventory and contributes no credit. Three unchanged companions remain in the measured chunks: the language selector and the new-agent/settings copy loaders.

| Measured scope                                      | Control raw bytes | Control gzip bytes | Maximum new growth   |
| --------------------------------------------------- | ----------------: | -----------------: | -------------------- |
| Active model-choice chunks, including shared search |            21,607 |              7,493 | 2,000 raw / 900 gzip |
| Settings contribution within that same scope        |            15,559 |              4,950 | 600 raw / 200 gzip   |

Gzip measurements use level 9. The Settings contribution is removed from the older first-project calculation before applying its unchanged 450-byte limit. The checker validates the exact current source fingerprints and rejects altered source, foreign ownership, missing outputs or modified compiled bytes. Changes to these sources require a fresh recorded comparison and review of the measured delta.

The connection-copy loader originally belonged to the guided-model connection chunk. Its separately emitted version remains in the same connection budget: 28,000 raw / 10,500 gzip bytes with one selected language; all seven authored packs have their existing separate limits. Compiler ownership binds the loader and each language pack to that scope. Each emitted chunk is counted once.

## Local model runtime admission

The running server can satisfy the local-selector floor while failing a model's
declared minimum version. Runtime readiness and its visible recovery guidance
share the existing model privacy allowance above. The frozen control and every
raw/gzip ceiling remain unchanged. The warning formatter lives in the lazy
connection-copy module and is charged to the existing connection allowance.

The 2026-10-11 production measurement is 1,971 raw / 850 gzip bytes above the
original model-choice control; Settings accounts for 507 raw / 181 gzip within
that same total. The four changed model-choice source fingerprints were rebound
to those measured bytes; the three unchanged companion fingerprints remain
identical. Compiled-byte ownership and tampering checks still apply.

## Content hashes

The build uses Rollup's [hexadecimal content-hash character set](https://rollupjs.org/configuration-options/#output-hashcharacters). Repeated dependency paths compress better with its smaller alphabet. The filename length stays at eight characters, and the evidence manifest continues to verify the final files with full SHA-256 digests.

When changing build options, compare the emitted module inventory, media digests and compiled runtime bodies, then run the complete bundle checker and relevant browser journeys. Record the exact source revision for every test result.

## Shared dependency compression

Saved-usage recovery uses a named locale tuple to avoid repeating field names in
all seven lazy language files. Its complete panel, largest selected pack and
verified reader wiring measured 7,960 raw / 3,306 gzip bytes; all packs measured
7,671 raw / 3,894 gzip bytes. The existing 8 KB / 3.5 KB feature and 11 KB / 6 KB
all-language ceilings remain unchanged. No code was moved into unrelated chunks
for budget credit. See the
[saved-usage verification](./verification/2026-10-11-saved-usage-recovery.md).

The build applies a pinned Terser pass only to `vendor-core` and `vendor-ui`
after the normal browser-target transform. Application chunks keep their
existing compiler, source ownership checks and normalized runtime fingerprints.
Property mangling and unsafe compression are disabled; source maps compose with
the preceding transform. Existing budget ceilings remain unchanged.

The [2026-10-11 recovery verification](./verification/2026-10-11-incomplete-response-recovery.md)
records 6,871 raw bytes and 6,265 gzip bytes saved across the two emitted vendor
files. All original bundle checks and 203 relevant browser cases passed on its
recorded source. The record also identifies the remaining runtime release gates.
