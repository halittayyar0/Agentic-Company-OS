"""Build the reviewed metadata-only Windows checker with existing MSVC tools.

Build-host only. Never downloads tools, changes privileges, or installs a runtime.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'lib/ai-server/native/windows-private-helper.c'


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    if platform.system() != 'Windows' or platform.machine().lower() not in {'amd64', 'x86_64'}:
        raise RuntimeError('Build requires the supported Windows x64 build host')
    output = Path(args.out).resolve()
    if output.exists() or output == ROOT or output in ROOT.parents:
        raise RuntimeError('A fresh, separate build directory is required')
    spec = importlib.util.spec_from_file_location('acos_existing_windows_build', ROOT / 'scripts/build-native-postgres.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    environment = dict(os.environ)
    for key in list(environment):
        if key.upper() in {'CL', '_CL_', 'LINK', '_LINK_'}:
            del environment[key]
    environment = module.windows_environment(environment)
    for key in ['CL', '_CL_', 'LINK', '_LINK_']:
        environment.pop(key, None)
    compiler = Path(shutil.which('cl.exe', path=environment['PATH']) or '')
    linker = Path(shutil.which('link.exe', path=environment['PATH']) or '')
    dumpbin = Path(shutil.which('dumpbin.exe', path=environment['PATH']) or '')
    if not all(p.is_file() and p.is_absolute() for p in [compiler, linker, dumpbin]):
        raise RuntimeError('Existing native compiler/linker inspection tools are required')
    source_sha = digest(SOURCE)
    output.mkdir()
    (output / 'link-inputs').mkdir()
    executable = output / 'windows-private-helper.exe'
    options = ['/nologo', '/W4', '/WX', '/O2', '/sdl', '/analyze', '/MT', '/GS', '/guard:cf',
        '/Brepro', '/DUNICODE', '/D_UNICODE', '/TC', '/std:c11',
        '/DACOS_SOURCE_SHA256="' + source_sha + '"']
    link_options = ['/WX', '/INCREMENTAL:NO', '/DEBUG:NONE', '/DYNAMICBASE', '/HIGHENTROPYVA',
        '/NXCOMPAT', '/GUARD:CF', '/CETCOMPAT', '/BREPRO', '/MACHINE:X64',
        '/SUBSYSTEM:CONSOLE,6.02', "/MANIFESTUAC:level='asInvoker'", 'advapi32.lib']
    command = [str(compiler), *options, '/sourceDependencies', str(output / 'source-dependencies.json'),
        '/Fo' + str(output / 'helper.obj'), '/Fe' + str(executable), str(SOURCE),
        '/link', *link_options, '/LINKREPRO:' + str(output / 'link-inputs')]
    result = subprocess.run(command, env=environment, cwd=output, capture_output=True)
    (output / 'compiler.stdout.log').write_bytes(result.stdout)
    (output / 'compiler.stderr.log').write_bytes(result.stderr)
    if result.returncode:
        print(result.stdout.decode('utf-8', errors='replace'))
        print(result.stderr.decode('utf-8', errors='replace'))
        raise RuntimeError('Native checker compilation failed; diagnostics retained')
    dependencies = subprocess.check_output([str(dumpbin), '/nologo', '/dependents', str(executable)], env=environment)
    (output / 'dependencies.log').write_bytes(dependencies)
    dlls = sorted(set(re.findall(r'^\s+([A-Za-z0-9_.-]+\.dll)\s*$', dependencies.decode('utf-8', errors='replace'), re.M | re.I)))
    if not dlls or any(d.lower() not in {'kernel32.dll', 'advapi32.dll', 'ntdll.dll'} for d in dlls):
        raise RuntimeError('Unexpected native runtime dependency; do not package this executable')
    probe = subprocess.run([str(executable), '--build-info'], capture_output=True, timeout=15)
    if probe.returncode or json.loads(probe.stdout) != dict(protocol=1, target='win32-x64', sourceSha256=source_sha):
        raise RuntimeError('Compiled checker identity did not match the source')
    version = subprocess.run([str(compiler), '/Bv'], env=environment, capture_output=True)
    version_text = (version.stdout + version.stderr).decode('utf-8', errors='replace')
    (output / 'compiler-version.log').write_text(version_text, encoding='utf-8')
    versions = sorted(set(re.findall(r'\b(?:19|14)\.\d+\.\d+(?:\.\d+)?\b', version_text)))
    roots = {
        'vc': Path(environment['VCTOOLSINSTALLDIR']).resolve(),
        'sdk': Path(environment['WINDOWSSDKDIR']).resolve(),
    }
    includes = json.loads((output / 'source-dependencies.json').read_text(encoding='utf-8-sig'))['Data']['Includes']
    header_inputs = []
    for value in sorted(set(includes)):
        header = Path(value).resolve()
        owners = [(label, parent) for label, parent in roots.items() if header.is_relative_to(parent)]
        if len(owners) != 1 or not header.is_file():
            raise RuntimeError('An unreviewed header escaped the compiler/SDK input roots')
        label, parent = owners[0]
        header_inputs.append(dict(path=label + '/' + header.relative_to(parent).as_posix(),
            bytes=header.stat().st_size, sha256=digest(header)))
    compiler_inputs = []
    binaries = sorted(p for p in compiler.parent.rglob('*') if p.is_file() and p.suffix.lower() in {'.dll', '.exe'})
    if not 0 < len(binaries) <= 256 or sum(p.stat().st_size for p in binaries) > 512 * 1024 * 1024:
        raise RuntimeError('Unexpected compiler binary inventory')
    for binary in binaries:
        compiler_inputs.append(dict(path=binary.relative_to(compiler.parent).as_posix(),
            bytes=binary.stat().st_size, sha256=digest(binary)))
    link_inputs = []
    for binary in sorted((output / 'link-inputs').rglob('*')):
        if binary.is_file() and binary.suffix.lower() in {'.lib', '.obj', '.res', '.manifest'}:
            link_inputs.append(dict(path=binary.relative_to(output / 'link-inputs').as_posix(),
                bytes=binary.stat().st_size, sha256=digest(binary)))
    if not header_inputs or not link_inputs:
        raise RuntimeError('Complete native header/link input provenance was not captured')
    record = dict(schema='agentic-company-os/windows-private-helper-build@1',
        protocol=1, target='win32-x64', sourceSha256=source_sha,
        executableSha256=digest(executable), executableBytes=executable.stat().st_size,
        compiler=dict(name=compiler.name, sha256=digest(compiler), versions=versions),
        linker=dict(name=linker.name, sha256=digest(linker)),
        sdkVersion=environment.get('WINDOWSSDKVERSION', '').rstrip('\\/'),
        compilerOptions=options + ['/sourceDependencies', '${BUILD}/source-dependencies.json'],
        linkerOptions=link_options + ['/LINKREPRO:${BUILD}/link-inputs'],
        headerInputs=header_inputs, compilerBinaryInputs=compiler_inputs, linkInputs=link_inputs,
        importedSystemDlls=dlls,
        residentSystemModules=['ntdll.dll'],
        staticAnalysis=dict(tool='MSVC /analyze', warningsAsErrors=True),
        runtimeCompilerRequired=False, runtimeDownloadRequired=False,
        privilegedExecutionRequired=False, actualMainOrReleaseAccepted=False)
    with (output / 'build.json').open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(record, handle, indent=2)
        handle.write('\n')
    print(json.dumps({k: record[k] for k in ['sourceSha256', 'executableSha256',
        'executableBytes', 'importedSystemDlls', 'actualMainOrReleaseAccepted']}))


if __name__ == '__main__':
    main()
