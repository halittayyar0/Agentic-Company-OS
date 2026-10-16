# Native runtime source and portability audit — 2026-10-16

## Decision

Use a project-built PostgreSQL 17.10 and statically linked zlib 1.3.2. The
`@embedded-postgres/*` 17.10.0-beta.17 candidates are unsuitable for this
application: all five checksum-verified tarballs include only `postgres`,
`initdb`, and `pg_ctl`, omitting `pg_isready`, `pg_dump`, `pg_restore`, and `psql`.
No upstream lifecycle script was run. The upstream binary project describes
its bundles as intended for testing; starting them would not establish
production readiness.

All 1,478 regular native Windows payload files (excluding `pg-symlinks.json`)
matched byte-for-byte the cached official EDB 17.10-1 Windows distribution.
The npm tar includes only the wrapper MIT license while its payload includes
LGPL gettext/iconv/pthreads libraries and numerous other third-party DLLs.
Copying only that MIT license would therefore be insufficient. The chosen
source build avoids redistributing those payloads.

## Verified source inputs

| Component        | Exact archive                                                                             | SHA-256                                                            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| PostgreSQL 17.10 | [official tar.bz2](https://ftp.postgresql.org/pub/source/v17.10/postgresql-17.10.tar.bz2) | `078a03516dcdbdb705fecaf415ea3d13a956c589e46f09fed68a06fb00598c90` |
| zlib 1.3.2       | [official tar.gz](https://zlib.net/zlib-1.3.2.tar.gz)                                     | `bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16` |

Both archives were downloaded and checked against the publisher's checksum
([PostgreSQL](https://ftp.postgresql.org/pub/source/v17.10/postgresql-17.10.tar.bz2.sha256),
[zlib](https://zlib.net/)). Preserved license texts and their hashes are in
`deploy/native-attribution/`. Node uses the exact target binary archive pins;
retain its complete LICENSE, which also carries its bundled-library notices.

## Source-supported build recipe

Build-host tools are separate from end-user requirements. PostgreSQL 17.10
requires a C compiler, Meson >=0.54, Ninja for that backend, Python, Perl >=5.14,
Flex >=2.5.35 and Bison >=2.3. The verified release archive has `gram.y` but no
generated `gram.c` or `scan.c`; Flex/Bison cannot be omitted for a release tar.
Windows supports the executable names `win_flex` and `win_bison`. MSVC requires
its SDK/resource compiler environment. zlib's CMake build needs CMake >=3.12.
These tools run during release creation, never on a user's first launch.

For zlib use CMake Release with `ZLIB_BUILD_SHARED=OFF`,
`ZLIB_BUILD_STATIC=ON`, `ZLIB_BUILD_TESTING=OFF`, and
`CMAKE_POSITION_INDEPENDENT_CODE=ON`. On MSVC set policy CMP0091 to NEW and
`CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`. zlib 1.3.2 names its Windows static
output `zs.lib`; Unix uses `libz.a`. Its generated pkg-config file says `-lz`
even for the Windows static-only output, so avoid relying on that file.

For PostgreSQL use a fresh build and install prefix, Release,
`-Dauto_features=disabled -Dzlib=enabled -Dssl=none -Duuid=none`, and preserve
the normal relative `bin`, `lib`, and `share` layout (set `--libdir=lib`). On
MSVC add `-Db_vscrt=mt`; use a matching static CRT for zlib. Explicitly disable
auto-detected dependencies to prevent a developer's installed libraries from
silently entering the release. Use `--wrap-mode=nodownload`.

Two recorded source changes provide the private runtime dependencies:

1. Override the default installed runtime search paths in `meson.build` with
   sibling-relative paths for Unix executables, libraries and modules. Preserve
   the upstream shared `libpq` dependency and all public encoding symbols.
2. Resolve zlib by CMake with explicit `ZLIB_INCLUDE_DIR`, `ZLIB_LIBRARY`, and
   `ZLIB_USE_STATIC_LIBS=ON` in the existing zlib dependency call; verify Meson's
   resolved dependency contains the exact pinned static-library path. Explicit
   cache variables avoid guessing names or accidentally selecting system zlib.

An initial source-inspection proposal selected `libpq_st` directly. The actual
Windows build rejected that proposal: libpq referenced nominal encoding symbols,
while its static common dependency exported private variants. That failed local
build is retained as a failed observation; the final recipe restores upstream
shared libpq instead of changing its public API or suppressing linker errors.
No PostgreSQL source guard was found that prohibits MSVC `/MT`; actual archive
execution is still required to establish the result on each target.

## Portability and feature boundaries

Upstream PostgreSQL's Meson build otherwise embeds the installed libpq path;
on macOS it uses an absolute dylib install name. Unix search paths use `$ORIGIN`
or `@loader_path`/`@executable_path`. The macOS finishing step rewrites private
library IDs/references to `@rpath` and re-signs changed Mach-O files ad hoc;
this is not notarization. Keep the directory layout so PostgreSQL's `make_relative_path`
can locate its own data and modules after extraction elsewhere. Inspect final
imports with `dumpbin`, `otool`, or `readelf`/`ldd` on the matching host; no
dependency may resolve to a build checkout, a developer package prefix, or an
unshipped third-party library. Do not assume static CRT removes Windows OS DLL
requirements. An extracted-archive test must remove access to its build prefix
and any installed database/toolchain to prove relocation.

Keep zlib enabled: upstream `compress_gzip.c` rejects gzip compression when
`HAVE_LIBZ` is absent. This retains default gzip custom-format dump/restore.
Explicit LZ4/Zstandard-compressed external backups remain unsupported with
those features disabled and should fail with their actual diagnostic. TLS,
LDAP/GSSAPI, ICU, XML/XSLT, external procedural languages and readline are not
part of this local managed database build. SCRAM and built-in PL/pgSQL remain
available. The managed database must bind only to loopback; these build flags
must not be applied to a user-supplied external database server.

The bundled Node 24.21.0 establishes a floor of macOS 13.5, or GNU/Linux kernel
4.18 with glibc 2.28 and libstdc++ 6.0.25 (`GLIBCXX_3.4.25`); Windows x64's Node
floor is Windows 10/Server 2016 on a vendor-supported release. PostgreSQL's
actual compiler/sysroot can raise these floors. Build Linux artifacts on the
oldest supported glibc/sysroot or declare the measured higher requirement;
building on a modern Ubuntu runner does not prove compatibility with 2.28.
Alpine/musl, Windows ARM native, root execution, and signed/notarized macOS
distribution are outside the chosen package contract. PostgreSQL refuses root.

Each of the five targets still needs an actual matching OS/architecture build
and final-archive smoke, including initialization, migrations, two workers,
one job, compressed backup/restore, shutdown, and retained-data resume. This
audit supplies source and notice evidence; it does not claim those gates passed.

## Primary references

- [Pinned PostgreSQL options](https://github.com/postgres/postgres/blob/REL_17_10/meson_options.txt),
  [build definitions](https://github.com/postgres/postgres/blob/REL_17_10/meson.build),
  [libpq targets](https://github.com/postgres/postgres/blob/REL_17_10/src/interfaces/libpq/meson.build),
  [installation requirements and relocation](https://github.com/postgres/postgres/blob/REL_17_10/doc/src/sgml/installation.sgml),
  [path relocation implementation](https://github.com/postgres/postgres/blob/REL_17_10/src/port/path.c).
- [Pinned zlib CMake](https://github.com/madler/zlib/blob/v1.3.2/CMakeLists.txt),
  [Meson CRT settings](https://mesonbuild.com/Builtin-options.html),
  [Microsoft /MT](https://learn.microsoft.com/en-us/cpp/build/reference/md-mt-ld-use-run-time-library).
- [Pinned Node platform matrix](https://github.com/nodejs/node/blob/v24.21.0/BUILDING.md).
- [Wrapper downloader at npm gitHead](https://github.com/leinelissen/embedded-postgres/blob/c23ad8a026c711c8666c3c2596d0fde643cf378a/packages/downloader/src/index.ts),
  [Zonky 17.10 repack script](https://github.com/zonkyio/embedded-postgres-binaries/blob/a1828fe69408a9a0102d6e877cb02b57b95347c6/scripts/repack-postgres.sh),
  [upstream intended use](https://github.com/zonkyio/embedded-postgres-binaries).

## Windows Unicode-path repair

The first extracted Windows archive failed initialization in a path containing Ω:
PostgreSQL's narrow Win32 APIs converted the executable path to a question mark
before its restricted-token re-execution. The failed receipt is retained. The
finishing step preserves existing executable manifests and embeds a process-only
UTF-8 activeCodePage, then reads it back before computing runtime hashes. This
requires Windows 10 1903 or newer; no system locale, registry or security setting
is changed. See [Microsoft's process code page documentation](https://learn.microsoft.com/en-us/windows/apps/design/globalizing/use-utf8-code-page).
The Unicode archive installation must pass after this change before release.
