"""No empty-process or arbitrary errno credit for private-proc access denial."""
import errno
import json
from pathlib import Path

directory=Path('vendor-proc-evidence')
file=directory/'known-live-privacy-closed.json'
assert 0<file.stat().st_size<65536
outer=json.loads(file.read_text())
assert outer['outerExit']==0 and not outer['stderr']
assert (directory/'known-live-privacy-closed-remaining-containers.txt').read_text()==''
result=json.loads(outer['stdout'])
assert result['commandExit']==0 and not result['stderr'] and result['siblingExit']==0
assert len(result['before'])==len(result['after'])==2
for phase in ['before','after']:
    for target in result[phase]:
        assert all(target[k] for k in ['alive','environmentPositive','rootPositive','cwdPositive','fileFdPositive','controllerFdPositive','processControlPositive'])
command=json.loads(result['stdout'])
assert command['workspaceRead']=='positive-workspace'
assert command['workspaceWritten'] and command['selfFdEnumerationAndClose']
assert command['profile']==result['profile']=='agentic-coding-proc-probe (enforce)'
# Vendored Bubblewrap's nested setup namespace maps the retained UID/GID1000
# through its intermediary namespace's UID/GID0, not directly to host1000.
assert command['uidMap'].split()==['1000','0','1'] and command['gidMap'].split()==['1000','0','1']
assert not command['directPrivate']['opened']
assert len(command['targets'])==2
denied=True
failures=[]
for target in command['targets']:
    for access in ['environment','root','cwd','fileFd','controllerFd','processControl']:
        value=target[access]
        if value['opened'] or value['denialErrno'] not in (errno.EACCES,errno.EPERM):
            denied=False;failures.append({'target':target['name'],'access':access,**value})
    alias=target['aliasControl']
    if alias['exitCode']==0 or alias['timeout']:
        denied=False;failures.append({'target':target['name'],'access':'mountAliasControl',**alias})
for before,after in zip(result['before'],result['after']):
    assert (before['pid'],before['startTime'],before['oomInode'])==(after['pid'],after['startTime'],after['oomInode'])
    if before['oomValue']!=after['oomValue']:
        denied=False;failures.append({'target':before['name'],'access':'independentOomObservation','before':before['oomValue'],'after':after['oomValue']})
baseline_outer=json.loads((directory/'known-live-privacy-red.json').read_text())
assert baseline_outer['outerExit']==0 and not baseline_outer['stderr']
assert (directory/'known-live-privacy-red-remaining-containers.txt').read_text()==''
baseline=json.loads(baseline_outer['stdout'])
assert baseline['commandExit']==0 and baseline['profile']=='agentic-coding (enforce)'
for before,after in zip(baseline['before'],baseline['after']):
    assert before['oomValue']=='100' and after['oomValue']=='200'
report={'kind':'known-live-retained-proc-privacy-experiment','positiveParentSiblingControlsBeforeAndAfter':True,'workspacePositive':True,'containerRemoved':True,'privateProcAccessDenied':denied,'failures':failures,'observed':result,'scope':'synthetic offline primitive, no actual Codex profile or production acceptance'}
(directory/'known-live-privacy-closed-comparison.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='observed'}))
if not denied: raise SystemExit('retained_proc_candidate_refused_private_process_access')
