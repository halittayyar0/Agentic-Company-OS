"""Pinned, disposable x64 Linux CLI fixture for offline CI permission tests.

No package install scripts or account/config access. Default mode is disposable;
explicit --image-runtime installs only a new root-owned /opt/agentic-codex tree.
An existing archive must match the same pinned SHA-512 bytes.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import tarfile
import tempfile
import urllib.request

VERSION = "0.159.2"
URL = "https://registry.npmjs.org/@openai/codex/-/codex-0.159.2-linux-x64.tgz"
INTEGRITY = "RrCZ1X52wpa1lOsXtCtSyhjOFdQPh7LH5Ccv8HsKmd/2UXbUwxXFqWXFK3JzatquUNGtW/TLox5Y7qVOGkV0/Q=="
MEMBERS = ("bin/codex", "codex-resources/bwrap", "codex-path/rg")
PREFIX = "package/vendor/x86_64-unknown-linux-musl/"
BWRAP_SHA256 = "77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c"


def main():
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise ValueError("fixture_requires_x64_linux")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--image-runtime", action="store_true")
    args = parser.parse_args()
    destination = Path("/opt/agentic-codex")
    if args.image_runtime:
        if os.geteuid() != 0 or destination.exists() or destination.is_symlink():
            raise ValueError("runtime_requires_root_and_new_destination")
        for directory in (destination.parent, Path("/")):
            metadata = directory.stat()
            if directory.is_symlink() or metadata.st_uid != 0 or metadata.st_mode & 0o022:
                raise ValueError("runtime_parent_not_protected")
    if args.archive and (args.archive.is_symlink() or not args.archive.is_file()
                         or args.archive.resolve(strict=True) != args.archive.absolute()):
        raise ValueError("fixture_archive_path_invalid")
    parent = Path(tempfile.gettempdir()).resolve(strict=True)
    root = Path(tempfile.mkdtemp(prefix="acos-linux-codex-fixture-", dir=parent)).resolve(strict=True)
    moved = False
    try:
        archive = root / "verified-package.tgz"
        sha512, sha256, length = hashlib.sha512(), hashlib.sha256(), 0
        source = args.archive.open("rb") if args.archive else urllib.request.urlopen(URL, timeout=60)
        with source, archive.open("xb") as output:
            os.chmod(archive, 0o600)
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                length += len(block)
                if length > 200 * 1024 * 1024:
                    raise ValueError("fixture_archive_too_large")
                sha512.update(block)
                sha256.update(block)
                output.write(block)
        if base64.b64encode(sha512.digest()).decode() != INTEGRITY:
            raise ValueError("fixture_archive_integrity_mismatch")
        with tarfile.open(archive, "r:gz") as package:
            entries = package.getmembers()
            for name in MEMBERS:
                matches = [entry for entry in entries if entry.name == PREFIX + name]
                if len(matches) != 1 or not matches[0].isfile() or not 0 < matches[0].size < 512 * 1024 * 1024:
                    raise ValueError("fixture_member_invalid")
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                stream = package.extractfile(matches[0])
                if stream is None:
                    raise ValueError("fixture_member_missing")
                written = 0
                with stream, target.open("xb") as output:
                    while True:
                        block = stream.read(1024 * 1024)
                        if not block:
                            break
                        written += len(block)
                        if written > matches[0].size:
                            raise ValueError("fixture_member_overflow")
                        output.write(block)
                if written != matches[0].size:
                    raise ValueError("fixture_member_truncated")
                target.chmod(0o700)
        component_digest = hashlib.sha256((root / "codex-resources/bwrap").read_bytes()).hexdigest()
        if component_digest != BWRAP_SHA256:
            raise ValueError("fixture_bwrap_identity_mismatch")
        archive.unlink()
        if args.image_runtime:
            root.rename(destination)
            root, moved = destination, True
            for directory in [root] + [entry for entry in root.rglob("*") if entry.is_dir()]:
                directory.chmod(0o755)
            for entry in root.rglob("*"):
                if entry.is_symlink():
                    raise ValueError("runtime_link_forbidden")
                if entry.is_file():
                    entry.chmod(0o555)
        result = {"root": str(root), "executable": str(root / "bin/codex"), "version": VERSION,
                  "archiveSha256": sha256.hexdigest(), "integrity": "sha512-" + INTEGRITY,
                  "bwrapSha256": component_digest, "imageRuntime": args.image_runtime}
        (root / "fixture-owner.json").write_text(json.dumps(result))
        os.chmod(root / "fixture-owner.json", 0o444 if args.image_runtime else 0o600)
        print(json.dumps(result))
    except BaseException:
        expected = root == destination if moved else root.parent == parent and root.name.startswith("acos-linux-codex-fixture-")
        if not expected or root.is_symlink() or root.resolve(strict=True) != root:
            raise ValueError("fixture_cleanup_ownership_invalid")
        shutil.rmtree(root)
        raise


if __name__ == "__main__":
    main()
