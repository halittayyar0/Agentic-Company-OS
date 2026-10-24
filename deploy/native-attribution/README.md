# Native runtime attribution

The portable distribution includes Node.js 24.22.1 and a project-built PostgreSQL
17.11 with static zlib 1.3.2. The source archive URLs, verified SHA-256 values,
and hashes of the preserved notices are in `sources.json`.

Copy this directory into every native release. Preserve the LICENSE file from
the exact checksum-verified Node binary archive as the authoritative Node
notice; `NODE-LICENSE.txt` is a reference from the matching upstream tag and
includes Node's bundled third-party notices. Fail packaging if the two differ
until the difference has been reviewed. The official Windows archive's CRLF
versus upstream tag LF was verified as the sole text difference; packaging
permits that difference and preserves the archive's exact bytes and checksum.

`POSTGRESQL-COPYRIGHT.txt`, the regex copyright, and the timezone README were
copied verbatim from the verified official PostgreSQL archive. Additional source
notices preserve original copyright/license statements in PostgreSQL's bundled
code, including components outside the minimal application build. `ZLIB-LICENSE.txt`
was copied verbatim from the verified official zlib archive.

PostgreSQL and zlib source is available at the exact URLs recorded in
`sources.json`. Build-time changes to PostgreSQL's Meson dependency selection
must be recorded in the build input provenance: resolving the pinned static
zlib and selecting relative runtime search paths. Keep the upstream shared
libpq and relocate its macOS library IDs/references before local ad-hoc signing.
These changes do not modify PostgreSQL's SQL, storage, authentication or
compression implementations. A source patch remains a downstream modification;
do not describe the resulting binary as an upstream-provided binary.

No npm `@embedded-postgres` payload or EDB third-party DLL is covered by this
bundle. Those candidate payloads were rejected because required tools were
missing and their third-party notice/source requirements needed separate work.

This directory documents runtime attribution. It does not replace attribution
for the application's JavaScript production dependencies, nor does it certify
platform compatibility or production readiness. Release evidence must identify
the actual target, compiler, configuration, source changes, binary inventory,
and the tests performed on the extracted final archive.
