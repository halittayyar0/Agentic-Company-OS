"""Export only checker bytes and path-free validation provenance, never SDK inputs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_NAMES = {
    'windows-private-helper.exe', 'build-first.json', 'build-second.json',
    'lifetime.json', 'security.json', 'component.json', 'README.txt',
}


def digest(file):
    with file.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def load(file):
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 1024 * 1024:
        raise ValueError('Expected bounded regular metadata')
    return json.loads(file.read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['first', 'second', 'lifetime', 'security', 'out']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    first, second = Path(args.first).resolve(), Path(args.second).resolve()
    output = Path(args.out).resolve()
    if output.exists() or output == ROOT or output in ROOT.parents:
        raise ValueError('A fresh output directory is required')
    source_sha = digest(ROOT / 'lib/ai-server/native/windows-private-helper.c')
    builds = [load(folder / 'build.json') for folder in [first, second]]
    executables = [folder / 'windows-private-helper.exe' for folder in [first, second]]
    for build, executable in zip(builds, executables):
        if (executable.is_symlink() or not executable.is_file()
                or build['schema'] != 'agentic-company-os/windows-private-helper-build@1'
                or build['sourceSha256'] != source_sha
                or build['executableBytes'] != executable.stat().st_size
                or not 0 < executable.stat().st_size <= 1024 * 1024
                or build['executableSha256'] != digest(executable)
                or build['staticAnalysis'] != {'tool': 'MSVC /analyze', 'warningsAsErrors': True}
                or not build['importedSystemDlls']
                or any(d.lower() not in {'advapi32.dll', 'kernel32.dll', 'ntdll.dll'} for d in build['importedSystemDlls'])
                or any(not build[name] for name in ['headerInputs', 'compilerBinaryInputs', 'linkInputs'])
                or build['actualMainOrReleaseAccepted'] is not False):
            raise ValueError('Unqualified build')
        for name in ['headerInputs', 'compilerBinaryInputs', 'linkInputs']:
            for row in build[name]:
                if (not row['path'] or ':' in row['path'] or '\\' in row['path']
                        or any(part in {'', '.', '..'} for part in row['path'].split('/'))):
                    raise ValueError('Build metadata contains a nonportable input path')
    if builds[0]['executableSha256'] != builds[1]['executableSha256']:
        raise ValueError('Two separate build directories did not produce identical executable bytes')
    reports = [load(Path(args.lifetime)), load(Path(args.security))]
    for report, schema, count in zip(reports, ['lifetime', 'security'], [5, 13]):
        if (report['schema'] != 'agentic-company-os/windows-private-helper-' + schema + '@1'
                or report['sourceSha256'] != source_sha
                or report['executableSha256'] != builds[0]['executableSha256']
                or report['passed'] is not True or report['cleanupVerified'] is not True
                or report['applicationOrModelStarted'] is not False
                or report['actualMainOrReleaseAccepted'] is not False
                or len(report['checks']) != count or len(set(report['checks'])) != count):
            raise ValueError('Missing exact native conformance evidence')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    ci = os.environ.get('GITHUB_ACTIONS') == 'true'
    if ci:
        if (os.environ.get('GITHUB_REPOSITORY') != 'halittayyar0/Agentic-Company-OS'
                or os.environ.get('GITHUB_SHA') != commit
                or os.environ.get('GITHUB_RUN_ATTEMPT') != '1'
                or subprocess.check_output(['git', 'status', '--porcelain=v1', '--untracked-files=normal'], cwd=ROOT).strip()):
            raise ValueError('Expected one original immutable clean CI producer')
    output.mkdir()
    shutil.copyfile(executables[0], output / 'windows-private-helper.exe')
    for name, record in zip(['build-first.json', 'build-second.json', 'lifetime.json', 'security.json'], builds + reports):
        (output / name).write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8', newline='\n')
    (output / 'README.txt').write_text(
        'Windows metadata checker validation component. Not a qualified application release.\n'
        'Project source: MIT; lib/ai-server/native/windows-private-helper.c in the recorded commit.\n'
        'Compiled using MSVC with its static C runtime. Microsoft runtime components are not relicensed under MIT.\n'
        'Microsoft runtime and SDK terms apply to those components; compiler, SDK and link inputs are not included.\n'
        'https://visualstudio.microsoft.com/license-terms/\n'
        'https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution\n'
        'No model, user data, credentials or privilege changes are part of this component.\n',
        encoding='utf-8', newline='\n')
    inventory = [dict(path=p.name, bytes=p.stat().st_size, sha256=digest(p)) for p in sorted(output.iterdir())]
    record = dict(schema='agentic-company-os/windows-private-helper-component@1', commit=commit,
                  sourceSha256=source_sha, executableSha256=builds[0]['executableSha256'],
                  twoDirectoryBuildsByteIdentical=True, nativeLifetimeChecks=5, nativeSecurityChecks=13,
                  originalCiProducer=ci, runId=os.environ.get('GITHUB_RUN_ID') if ci else None,
                  attempt=1 if ci else None, target='win32-x64', files=inventory,
                  actualMainOrReleaseAccepted=False,
                  remaining=['Application packaging and full source/platform qualification',
                             'Final runtime license notices and release qualification'])
    (output / 'component.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8', newline='\n')
    if {p.name for p in output.iterdir()} != PUBLIC_NAMES:
        raise ValueError('Unexpected export inventory')
    print(json.dumps(dict(originalCiProducer=ci, files=len(PUBLIC_NAMES),
                         sourceSha256=source_sha, executableSha256=builds[0]['executableSha256'],
                         actualMainOrReleaseAccepted=False)))


if __name__ == '__main__':
    main()
