# Optional native coding toolchain

The `coding-runtime` image includes the unmodified, integrity-pinned Linux x64
Codex 0.159.2 binaries from the official OpenAI npm package. Ordinary production
images omit this optional toolchain. No package scripts or sign-in run during
installation.

- Codex: Apache-2.0; upstream license and notice are included here.
- Bubblewrap: upstream GNU Library General Public License version 2 is included
  as `BUBBLEWRAP-COPYING`. The corresponding vendored source is included in
  `bubblewrap-source.tar.gz` with its original license link and build files.
- ripgrep 15.2.0: upstream MIT license and Unlicense are included here.
- PCRE2 10.45, compiled into ripgrep: upstream copying terms are included here.
- Ratatui 0.30.2, used by Codex: its crate license is included here.

Codex source commit: `ff6aec96948b70d94983af2641a6b67c94faeff5`
(`rust-v0.159.2`). The Bubblewrap source archive contains all 50 vendored blobs,
verified against that commit's Git blob identities, with source bytes unchanged.
Archive SHA-256: `d038cebff7a83e2ea0039f652e19b18f708e99b93ab2372341d488c393fc1a5a`.

Complete Codex source and build instructions:
https://github.com/openai/codex/tree/ff6aec96948b70d94983af2641a6b67c94faeff5

Upstream ripgrep sources: https://github.com/BurntSushi/ripgrep/tree/15.2.0

Upstream PCRE2 sources: https://github.com/PCRE2Project/pcre2/tree/pcre2-10.45

Ratatui's crate SHA-256, from the pinned Codex Cargo.lock:
`3274ba0a2c5e1bcad2a2005d20f4dc59dad26b2eb0940fb094500dba4099d57d`.

Toolchain updates require refreshing the archive integrity, native binary
identity, source attribution and actual offline permission/cleanup gates.
The system helper stays root-owned and cannot be replaced by a coding task.
