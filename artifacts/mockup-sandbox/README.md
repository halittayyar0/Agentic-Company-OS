# Design previews

Use Node 24 and run `pnpm --filter @workspace/mockup-sandbox dev` from the
workspace root to open the local design preview server.

Put regular `.tsx` component files in `src/components/mockups`. Nested folders
are supported. Files and folders beginning with `_`, hidden folders, symbolic
links and directory junctions are excluded. Copy a linked component into this
directory to preview it. Imports are normalized and sorted before generation.

Discovery uses Node's built-in file API and a fixed pattern. The generated
module refreshes when preview files are added or removed.
