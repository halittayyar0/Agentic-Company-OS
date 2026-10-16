"""Build-only archive operations; installed packages never require Python."""

import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
import zipfile
from contextlib import contextmanager


def safe_member(name):
    parts = PurePosixPath(name).parts
    if not parts or name.startswith("/") or "\\" in name or ":" in name:
        raise ValueError("Unsafe archive path")
    if any(part in (".", "..") for part in parts):
        raise ValueError("Unsafe archive path")
    return parts


def extract_node(archive, destination, target, version, checksum):
    with open(archive, "rb") as incoming:
        if hashlib.file_digest(incoming, "sha256").hexdigest() != checksum:
            raise ValueError("Node archive checksum mismatch")
    platform, architecture = target.split("-")
    upstream_platform = "win" if platform == "win32" else platform
    prefix = f"node-v{version}-{upstream_platform}-{architecture}/"
    executable = "node.exe" if platform == "win32" else "bin/node"
    selected = {prefix + executable: executable, prefix + "LICENSE": "LICENSE"}
    found = set()
    destination = Path(destination)
    if platform == "win32":
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                safe_member(member.filename)
                if member.filename not in selected:
                    continue
                mode = member.external_attr >> 16
                if member.is_dir() or stat.S_ISLNK(mode):
                    raise ValueError("Node entry is not a regular file")
                if member.filename in found or member.file_size > 128 * 1024 * 1024:
                    raise ValueError("Invalid Node entry")
                target_path = destination / selected[member.filename]
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with source.open(member) as incoming, open(target_path, "xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                found.add(member.filename)
    else:
        with tarfile.open(archive, "r:gz") as source:
            for member in source:
                safe_member(member.name)
                if member.name not in selected:
                    continue
                if not member.isfile() or member.name in found or member.size > 128 * 1024 * 1024:
                    raise ValueError("Invalid Node entry")
                target_path = destination / selected[member.name]
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as incoming, open(target_path, "xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                target_path.chmod(0o755 if member.name.endswith("/bin/node") else 0o644)
                found.add(member.name)
    if found != selected.keys():
        raise ValueError("Node executable or license missing")


def archive_package(directory, output):
    directory = Path(directory).resolve(strict=True)
    files = []
    for root, directories, names in os.walk(directory, followlinks=False):
        for name in directories + names:
            item = Path(root) / name
            if item.is_symlink():
                raise ValueError("Package contains a symbolic link")
        for name in names:
            item = Path(root) / name
            if not item.is_file():
                raise ValueError("Package contains a special file")
            files.append(item)
    if Path(output).exists():
        raise ValueError("Archive output already exists")
    if str(output).endswith(".zip"):
        with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for item in sorted(files):
                archive.write(item, item.relative_to(directory).as_posix())
    else:
        with tarfile.open(output, "x:gz", format=tarfile.PAX_FORMAT) as archive:
            for item in sorted(files):
                info = archive.gettarinfo(item, item.relative_to(directory).as_posix())
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                with item.open("rb") as incoming:
                    archive.addfile(info, incoming)


def extract_package(archive, destination):
    destination = Path(destination).absolute()
    if os.path.lexists(destination):
        raise ValueError("Extraction destination must be new")
    maximum_file = 128 * 1024 * 1024
    maximum_total = 2 * 1024 * 1024 * 1024
    rows = []
    seen = set()
    total = 0

    def validate(name, size, mode, entry):
        nonlocal total
        safe_member(name)
        parts = name.split("/")
        if len(name) > 1024 or any(
            not part or part in (".", "..") or part.endswith((".", " "))
            or any(ord(char) < 32 or ord(char) == 127 for char in part)
            or part.split(".")[0].casefold() in {
                "con", "prn", "aux", "nul",
                *[f"com{index}" for index in range(1, 10)],
                *[f"lpt{index}" for index in range(1, 10)],
            }
            for part in parts
        ):
            raise ValueError("Unsafe package path")
        folded = name.casefold()
        if folded in seen or size < 0 or size > maximum_file or len(rows) >= 20_000:
            raise ValueError("Duplicate or oversized package entry")
        total += size
        if total > maximum_total:
            raise ValueError("Package exceeds extraction limit")
        seen.add(folded)
        rows.append((name, size, mode, entry))

    @contextmanager
    def open_archive():
        if zipfile.is_zipfile(archive):
            with zipfile.ZipFile(archive) as source:
                for entry in source.infolist():
                    mode = entry.external_attr >> 16
                    if entry.is_dir() or (entry.external_attr & 0x10) or stat.S_IFMT(mode) not in (0, stat.S_IFREG) or entry.flag_bits & 1:
                        raise ValueError("Package entries must be regular unencrypted files")
                    # ZipInfo normalizes backslashes on Windows; validate the raw name.
                    validate(entry.orig_filename, entry.file_size, mode, entry)
                yield lambda entry: source.open(entry)
        else:
            with tarfile.open(archive, "r:gz") as source:
                for entry in source:
                    if not entry.isfile() or entry.sparse is not None:
                        raise ValueError("Package entries must be regular files")
                    validate(entry.name, entry.size, entry.mode, entry)
                yield lambda entry: source.extractfile(entry)

    def consume(incoming, expected, outgoing=None):
        received = 0
        while chunk := incoming.read(1024 * 1024):
            received += len(chunk)
            if received > expected:
                raise ValueError("Package entry exceeds declared size")
            if outgoing is not None:
                outgoing.write(chunk)
        if received != expected:
            raise ValueError("Truncated package entry")

    with open_archive() as read_entry:
        if not rows:
            raise ValueError("Package is empty")
        # Reject file/directory collisions, including differently cased parents.
        for name, _, _, _ in rows:
            parts = name.casefold().split("/")
            if any("/".join(parts[:index]) in seen for index in range(1, len(parts))):
                raise ValueError("Package file conflicts with a directory")
        # Check compressed contents and checksums before creating the destination.
        for _, size, _, entry in rows:
            with read_entry(entry) as incoming:
                consume(incoming, size)
        destination.mkdir()
        for name, size, mode, entry in rows:
            output = destination.joinpath(*name.split("/"))
            output.parent.mkdir(parents=True, exist_ok=True)
            with read_entry(entry) as incoming, output.open("xb") as outgoing:
                consume(incoming, size, outgoing)
            if os.name != "nt":
                output.chmod(0o755 if mode & 0o111 else 0o644)


if __name__ == "__main__":
    if sys.argv[1] == "extract-node" and len(sys.argv) == 7:
        extract_node(*sys.argv[2:])
    elif sys.argv[1] == "archive" and len(sys.argv) == 4:
        archive_package(*sys.argv[2:])
    elif sys.argv[1] == "extract-package" and len(sys.argv) == 4:
        extract_package(*sys.argv[2:])
    else:
        raise SystemExit("Invalid archive-helper arguments")
