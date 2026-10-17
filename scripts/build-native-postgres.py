"""Build the pinned private PostgreSQL runtime. Build-host tools only, never first-run tools."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
RELOCATABLE_RPATH = """# Private distribution: resolve sibling libraries after extraction/relocation.
if host_system == 'darwin'
  bin_install_rpaths = ['@executable_path/../lib']
  lib_install_rpaths = ['@loader_path']
  mod_install_rpaths = ['@loader_path', '@loader_path/..']
elif host_system != 'windows'
  bin_install_rpaths = ['$ORIGIN/../lib']
  lib_install_rpaths = ['$ORIGIN']
  mod_install_rpaths = ['$ORIGIN', '$ORIGIN/..']
endif

# Define arguments for default targets"""


def checked_download(spec, cache):
    destination = cache / spec["url"].rsplit("/", 1)[1]
    downloaded = False
    declared_size = None
    candidate = destination
    if not destination.exists():
        temporary = destination.with_suffix(destination.suffix + ".partial")
        with urllib.request.urlopen(spec["url"], timeout=120) as response, temporary.open("xb") as output:
            length = response.headers.get("Content-Length")
            if length is not None:
                declared_size = int(length)
            shutil.copyfileobj(response, output)
        candidate = temporary
        downloaded = True
    size = candidate.stat().st_size
    observed_hash = hashlib.sha256(candidate.read_bytes()).hexdigest()
    # A bad response stays in the owned build directory as .partial evidence.
    # Never promote it to a verified cache entry, retry it, or alter the pin.
    diagnostic = (f"{destination.name} expectedSha256={spec['sha256']} "
                  f"observedSha256={observed_hash} expectedBytes={declared_size} observedBytes={size}")
    if declared_size is not None and size != declared_size:
        raise RuntimeError("Native source size mismatch: " + diagnostic)
    if observed_hash != spec["sha256"]:
        raise RuntimeError("Native source checksum mismatch: " + diagnostic)
    if downloaded:
        candidate.rename(destination)
    return destination


def extract_source(archive, destination):
    destination.mkdir()
    with tarfile.open(archive) as source:
        # Build input must not introduce links or paths outside this fresh owned directory.
        for member in source.getmembers():
            target = destination / member.name
            if not target.resolve().is_relative_to(destination.resolve()) or not (member.isfile() or member.isdir()):
                raise RuntimeError("Unsafe native source archive member: " + member.name)
        source.extractall(destination, filter="data")
    children = list(destination.iterdir())
    if len(children) != 1 or not children[0].is_dir():
        raise RuntimeError("Native source archive must contain one root")
    return children[0]


def run(arguments, env, cwd=None):
    print("Build step:", Path(str(arguments[0])).name, str(arguments[1]) if len(arguments) > 1 else "", flush=True)
    subprocess.run([str(item) for item in arguments], env=env, cwd=cwd, check=True)


def windows_environment(env):
    vswhere = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
    installation = subprocess.check_output([str(vswhere), "-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], text=True).strip()
    if not installation:
        raise RuntimeError("Release build requires the Visual C++ build tools")
    devcmd = Path(installation) / "Common7/Tools/VsDevCmd.bat"
    with tempfile.TemporaryDirectory(prefix="acos-build-environment-") as temporary:
        script = Path(temporary) / "environment.cmd"
        script.write_text(f'@call "{devcmd}" -no_logo -arch=x64 -host_arch=x64 >nul\n@if errorlevel 1 exit /b 1\n@set\n')
        output = subprocess.check_output([os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", str(script)], text=True, env=env)
    for line in output.splitlines():
        if "=" in line and not line.startswith("="):
            key, value = line.split("=", 1)
            env[key.upper()] = value
    cmake = Path(installation) / "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    if cmake.is_file():
        env["PATH"] = str(cmake.parent) + os.pathsep + env.get("PATH", "")
    git_perl = Path("C:/Program Files/Git/usr/bin/perl.exe")
    if git_perl.is_file():
        # Git also ships GNU link.exe; MSVC's linker must keep precedence.
        env["PATH"] = env["PATH"] + os.pathsep + str(git_perl.parent)
    # MSYS Perl otherwise rewrites native MSVC switches such as /nologo into
    # Git-relative filesystem paths when it calls dumpbin/link.
    env["MSYS2_ARG_CONV_EXCL"] = "*"
    env["MSYS_NO_PATHCONV"] = "1"
    return env


def patch_once(file, old, new):
    original = file.read_text(encoding="utf-8")
    if original.count(old) != 1:
        raise RuntimeError("Upstream source patch no longer matches: " + file.name)
    modified = original.replace(old, new)
    file.write_text(modified, encoding="utf-8", newline="\n")
    return {"path": file.name,
            "beforeSha256": hashlib.sha256(original.encode()).hexdigest(),
            "afterSha256": hashlib.sha256(modified.encode()).hexdigest(),
            "old": old, "new": new}


def finish_runtime(prefix, pins, flags, patches, env):
    is_windows = sys.platform == "win32"
    if is_windows:
        # PostgreSQL's narrow Win32 APIs otherwise lose non-ACP characters in
        # package/user paths before initdb re-executes with a restricted token.
        # The process-only UTF-8 manifest is supported on Windows 10 1903+.
        mt = shutil.which("mt.exe", path=env.get("PATH"))
        if not mt:
            raise RuntimeError("Windows SDK manifest tool required on the release host")
        with tempfile.TemporaryDirectory(prefix="acos-native-manifest-") as temporary:
            manifest = Path(temporary) / "application.manifest"
            assembly_ns = "urn:schemas-microsoft-com:asm.v1"
            app_ns = "urn:schemas-microsoft-com:asm.v3"
            settings_ns = "http://schemas.microsoft.com/SMI/2019/WindowsSettings"
            for executable in sorted((prefix / "bin").glob("*.exe")):
                if manifest.exists():
                    manifest.unlink()
                extracted = subprocess.run([mt, "-nologo", f"-inputresource:{executable};#1", f"-out:{manifest}"], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                assembly = ET.parse(manifest).getroot() if extracted.returncode == 0 else ET.Element("{" + assembly_ns + "}assembly", {"manifestVersion": "1.0"})
                app = assembly.find("{" + app_ns + "}application")
                if app is None:
                    app = ET.SubElement(assembly, "{" + app_ns + "}application")
                settings = app.find("{" + app_ns + "}windowsSettings")
                if settings is None:
                    settings = ET.SubElement(app, "{" + app_ns + "}windowsSettings")
                codepage = settings.find("{" + settings_ns + "}activeCodePage")
                if codepage is None:
                    codepage = ET.SubElement(settings, "{" + settings_ns + "}activeCodePage")
                codepage.text = "UTF-8"
                ET.ElementTree(assembly).write(manifest, encoding="utf-8", xml_declaration=True)
                run([mt, "-nologo", "-manifest", manifest, f"-outputresource:{executable};#1"], env)
                readback = Path(temporary) / "readback.manifest"
                run([mt, "-nologo", f"-inputresource:{executable};#1", f"-out:{readback}"], env)
                if ET.parse(readback).find(".//{" + settings_ns + "}activeCodePage").text != "UTF-8":
                    raise RuntimeError("UTF-8 Windows application manifest readback failed")
    # Darwin embeds the installed absolute libpq ID by default. Give the owned
    # libraries relative IDs/references, then restore local ad-hoc signatures.
    if sys.platform == "darwin":
        seen = set()
        for folder in ["bin", "lib"]:
            for candidate in sorted((prefix / folder).rglob("*")):
                file = candidate.resolve()
                if not file.is_file() or file in seen:
                    continue
                seen.add(file)
                with file.open("rb") as incoming:
                    magic = incoming.read(4)
                if magic not in [bytes.fromhex(value) for value in ["cffaedfe", "cefaedfe", "feedfacf", "feedface", "cafebabe", "bebafeca"]]:
                    continue
                listing = subprocess.check_output(["/usr/bin/otool", "-L", str(file)], text=True, env=env)
                dependencies = [line.strip().split(" (compatibility version", 1)[0] for line in listing.splitlines()[1:]]
                is_library = str(file).endswith(".dylib")
                if is_library:
                    identifier = "@rpath/" + file.relative_to(prefix / "lib").as_posix()
                    run(["/usr/bin/install_name_tool", "-id", identifier, file], env)
                for dependency in dependencies:
                    if dependency.startswith(str(prefix) + "/"):
                        relative = Path(dependency).relative_to(prefix / "lib").as_posix()
                        run(["/usr/bin/install_name_tool", "-change", dependency, "@rpath/" + relative, file], env)
                    elif dependency.startswith("/") and not dependency.startswith(("/usr/lib/", "/System/Library/")):
                        raise RuntimeError("Non-system dynamic dependency escaped the private runtime")
                run(["/usr/bin/codesign", "--force", "--sign", "-", file], env)
                if str(prefix) in subprocess.check_output(["/usr/bin/otool", "-L", str(file)], text=True, env=env):
                    # The first line is otool's filename, not a loader reference.
                    references = subprocess.check_output(["/usr/bin/otool", "-L", str(file)], text=True, env=env).splitlines()[1:]
                    if any(str(prefix) in line for line in references):
                        raise RuntimeError("Non-relocatable Darwin library reference")
    suffix = ".exe" if is_windows else ""
    for name in ["postgres", "initdb", "pg_ctl", "pg_dump", "pg_restore", "psql", "pg_isready"]:
        run([prefix / "bin" / (name + suffix), "--version"], env)
    machine = platform.machine().lower()
    architecture = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(machine)
    if architecture is None:
        raise RuntimeError("Unsupported release build architecture")
    runtime_files = []
    for folder in ["bin", "lib", "share"]:
        for item in sorted((prefix / folder).rglob("*")):
            if not item.resolve().is_relative_to(prefix.resolve()):
                raise RuntimeError("Runtime output escapes its prefix")
            if item.is_file():
                runtime_files.append({"path": item.relative_to(prefix).as_posix(), "bytes": item.stat().st_size,
                                      "sha256": hashlib.sha256(item.read_bytes()).hexdigest()})
    (prefix / "native-build-provenance.json").write_text(json.dumps({
        "schemaVersion": 1, "postgres": pins["postgres"], "zlib": pins["zlib"],
        "target": f"{sys.platform}-{architecture}", "features": flags, "files": runtime_files,
        "patches": patches, "staticDependencies": ["zlib"], "privateSharedDependencies": ["libpq"],
        "windowsProcessCodePage": "UTF-8" if is_windows else None,
        "unsupportedBackupCompression": ["lz4", "zstd"],
    }, indent=2) + "\n")
    print("PostgreSQL runtime ready:", prefix, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="New private build directory; not an existing directory")
    parser.add_argument("--cache", default=str(ROOT / ".tmp/self-contained-inputs"))
    parser.add_argument("--jobs", type=int, default=min(os.cpu_count() or 2, 4))
    args = parser.parse_args()
    work = Path(args.out).absolute()
    work.mkdir(parents=True, exist_ok=False)
    (work / ".agentic-native-build").write_text("Owned release build directory\n")
    cache = Path(args.cache).absolute()
    cache.mkdir(parents=True, exist_ok=True)
    pins = json.loads((ROOT / "deploy/native-runtimes.json").read_text())
    env = dict(os.environ)
    is_windows = sys.platform == "win32"
    if is_windows:
        env = windows_environment(env)
        flex_spec = pins["winFlexBison"]
        flex_archive = checked_download(flex_spec, cache)
        flex = work / "win-flex-bison"
        flex.mkdir()
        with zipfile.ZipFile(flex_archive) as archive:
            for member in archive.infolist():
                if not (flex / member.filename).resolve().is_relative_to(flex.resolve()):
                    raise RuntimeError("Unsafe build-tool archive")
            archive.extractall(flex)
        env["PATH"] = str(flex) + os.pathsep + env["PATH"]
    # Prefer the interpreter's own pinned Meson/Ninja virtual environment.
    env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
    cmake = shutil.which("cmake", path=env["PATH"])
    ninja = shutil.which("ninja", path=env["PATH"])
    if not cmake or not ninja:
        raise RuntimeError("Release build requires CMake and pinned Ninja")
    zlib = extract_source(checked_download(pins["zlib"], cache), work / "zlib-source")
    pg = extract_source(checked_download(pins["postgres"], cache), work / "postgres-source")
    zprefix = work / "zlib-prefix"
    zbuild = work / "zlib-build"
    configure = [cmake, "-S", zlib, "-B", zbuild, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release", f"-DCMAKE_INSTALL_PREFIX={zprefix.as_posix()}", "-DZLIB_BUILD_SHARED=OFF", "-DZLIB_BUILD_STATIC=ON", "-DZLIB_BUILD_TESTING=OFF", "-DCMAKE_POSITION_INDEPENDENT_CODE=ON"]
    if is_windows:
        configure += ["-DCMAKE_POLICY_DEFAULT_CMP0091=NEW", "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded"]
    run(configure, env)
    run([cmake, "--build", zbuild, "--parallel", str(args.jobs)], env)
    run([cmake, "--install", zbuild], env)
    zlibrary = zprefix / "lib" / ("zs.lib" if is_windows else "libz.a")
    if not zlibrary.is_file():
        raise RuntimeError("Missing pinned static zlib output")
    patches = []
    patches.append(patch_once(pg / "meson.build", "# Define arguments for default targets", RELOCATABLE_RPATH))
    # Force CMake to the exact static input; never consult host pkg-config zlib.
    zdependency = "dependency('zlib', required: zlibopt, method: 'cmake', cmake_args: [" + ", ".join("'" + arg + "'" for arg in [f"-DZLIB_INCLUDE_DIR={zprefix.as_posix()}/include", f"-DZLIB_LIBRARY={zlibrary.as_posix()}", "-DZLIB_USE_STATIC_LIBS=ON"]) + "])"
    patches.append(patch_once(pg / "meson.build", "dependency('zlib', required: zlibopt)", zdependency))
    patches[-1]["path"] = "meson.build"
    build = work / "postgres-build"
    prefix = work / "runtime"
    flags = ["--buildtype=release", "--wrap-mode=nodownload", "--libdir=lib", "-Dauto_features=disabled", "-Dzlib=enabled", "-Dssl=none", "-Duuid=none", "-Ddefault_library=static"]
    if is_windows:
        flags += ["-Db_vscrt=mt"]
    run([sys.executable, "-m", "mesonbuild.mesonmain", "setup", build, pg, "--prefix", prefix, *flags], env)
    dependencies = json.loads((build / "meson-info/intro-dependencies.json").read_text())
    selected = [dep for dep in dependencies if str(dep.get("name", "")).lower() == "zlib"]
    if len(selected) != 1 or not any(str(zlibrary).replace("\\", "/").lower() in str(arg).replace("\\", "/").lower() for arg in selected[0].get("link_args", [])):
        raise RuntimeError("PostgreSQL did not select our pinned static zlib")
    run([sys.executable, "-m", "mesonbuild.mesonmain", "compile", "-C", build, "-j", str(args.jobs)], env)
    run([sys.executable, "-m", "mesonbuild.mesonmain", "install", "-C", build, "--no-rebuild"], env)
    # Only source-relative patch text is public; absolute build paths stay private.
    patches[-1]["new"] = patches[-1]["new"].replace(zprefix.as_posix(), "<PINNED_ZLIB_PREFIX>")
    finish_runtime(prefix, pins, flags, patches, env)


if __name__ == "__main__":
    main()
