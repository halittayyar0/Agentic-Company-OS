"""Bounded fixed-artifact comparison; refuses unsafe explicit information."""
import errno
import json
from pathlib import Path

directory = Path('vendor-proc-evidence')
cases = {}
for variant in ('red', 'green'):
    for case in ('plain', 'info-missing', 'info-collision'):
        file = directory / (variant + '-' + case + '.json')
        assert file.stat().st_size <= 65536
        outer = json.loads(file.read_text())
        assert outer['outerReturncode'] == 0
        assert not outer['outerStderr']
        assert (directory / (variant + '-' + case + '-remaining-containers.txt')).read_text() == ''
        lines = outer['result'].splitlines()
        marked = [line.removeprefix('ACOS_PROBE_RESULT:') for line in lines if line.startswith('ACOS_PROBE_RESULT:')]
        assert len(marked) == 1
        result = json.loads(marked[0])
        result['containerRemoved'] = True
        kernel = [line.removeprefix('ACOS_KERNEL_RESULT:') for line in result['stdout'].splitlines() if line.startswith('ACOS_KERNEL_RESULT:')]
        if kernel:
            assert len(kernel) == 1
            result['kernel'] = json.loads(kernel[0])
        records = []
        for line in result['informationOutput'].splitlines():
            if line.startswith('{'):
                record = json.loads(line)
                if 'pid-namespace' in record:
                    records.append(record)
        result['informationRecords'] = records
        cases[variant + '-' + case] = result

red = cases['red-plain']
assert red['returncode'] == 1 and red['timeout'] and 'open /proc/' in red['stderr'] and '/ns/ns failed' in red['stderr']
green = cases['green-plain']
assert green['returncode'] == 0 and not green['timeout'] and not green['stderr']
kernel = green['kernel']
assert kernel['pid'] == 1 and kernel['uid'] == 1000 and kernel['gid'] == 1000
assert all(int(value,16) == 0 for value in kernel['caps'].values())
assert kernel['nnp'] == '1' and kernel['apparmor'] == 'agentic-coding (enforce)'
assert kernel['rootRo'] and kernel['rootWriteError'] == errno.EROFS
assert kernel['read'] == 'fixed-readable-workspace' and green['workspaceWritten']
assert kernel['pidNamespace'] != green['identity']['pidNamespace']
assert kernel['mountNamespace'] != green['identity']['mountNamespace']
assert kernel['procChildren'] == green['identity']['procChildren']
assert kernel['procChildren']  # Positive actual submount evidence; no empty-set credit.

for variant in ('red','green'):
    missing = cases[variant+'-info-missing']
    assert missing['returncode'] == 1 and missing['timeout'] and not missing['informationRecords']

collision = cases['green-info-collision']
wrong_records = []
if 'kernel' in collision:
    actual = int(collision['kernel']['pidNamespace'].split('[')[1].rstrip(']'))
    wrong_records = [record for record in collision['informationRecords'] if record['pid-namespace'] != actual]
report = {'kind':'controlled-vendor-lookup-experiment-not-release-acceptance','plainStartupCorrected':True,'managedProcMasksRetained':True,'uidCapsNnpProfileRootWorkspaceVerified':True,'allFixedContainersRemoved':True,'explicitInfoCollisionRefused':collision['returncode'] != 0 and not collision['informationRecords'],'wrongExplicitInformationRecords':wrong_records,'cases':cases,'scope':'kernel primitive only; no Codex named permissions, parent/sibling privacy or packaged installation proof'}
(directory/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({key:value for key,value in report.items() if key not in ('cases','wrongExplicitInformationRecords')}))
# A functioning plain command is insufficient to accept unsafe information.
if not report['explicitInfoCollisionRefused']:
    raise SystemExit('candidate_not_accepted_explicit_information_collision')
