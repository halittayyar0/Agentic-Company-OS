/** Owned offline fixture only. No CLI login, provider, model or host changes. */
export const LINUX_NAMESPACE_FIXTURE = String.raw`
import json, os, select, signal, subprocess, sys, time, uuid
from pathlib import Path

def wait_for(check, seconds=8):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = check()
        if result:
            return result
        time.sleep(.02)
    raise AssertionError('fixture_deadline')

def record(root, name, value):
    temporary = root / (name + '.tmp')
    temporary.write_text(json.dumps(value))
    temporary.replace(root / name)

def read_record(root, name):
    try:
        return json.loads((root / name).read_text())
    except FileNotFoundError:
        return None

def identity(pid):
    try:
        value = Path('/proc/%s/stat' % pid).read_text()
        return value[value.rindex(')')+2:].split()[19]
    except FileNotFoundError:
        return None

def namespace_members(namespace, owned_identities=None):
    owned_identities = owned_identities or {}
    result = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != os.getuid():
                continue
            if os.readlink(entry / 'ns/pid') == namespace:
                result.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError):
            pass
        except PermissionError:
            # Unrelated nondumpable host processes can share our UID. Never
            # treat an inaccessible captured owned identity as retired.
            if (entry.name in owned_identities and
                identity(int(entry.name)) == owned_identities[entry.name]):
                raise
    return result

role = sys.argv[1]
if role == 'target':
    root, scenario = Path(sys.argv[2]), sys.argv[3]
    child = subprocess.Popen(['/usr/bin/python3', '-c',
        'import os,time; os.setsid(); time.sleep(60)'], close_fds=True)
    record(root, 'target.json', {'pid': os.getpid(), 'descendant': child.pid})
    wait_for(lambda: (root / 'finish').exists(), 60)
    os._exit(7 if scenario == 'target-crash' else 0)

if role == 'worker':
    root, scenario = Path(sys.argv[2]), sys.argv[3]
    owner_read, owner_write = os.pipe()
    receipt_read, receipt_write = os.pipe()
    status_read, status_write = os.pipe()
    gate_read, gate_write = os.pipe()
    run_id = str(uuid.uuid4())
    outside = os.readlink('/proc/self/ns/pid')
    command = ['/usr/bin/python3', '-I', str(root / 'guardian.py'), run_id,
        outside, str(owner_read), str(receipt_write), '/usr/bin/python3',
        '-I', str(root / 'fixture.py'), 'target', str(root), scenario]
    if scenario == 'startup-owner-gone':
        os.close(owner_write)
        owner_write = None
    if scenario != 'not-pid-one':
        command = ['/usr/bin/bwrap', '--unshare-user', '--unshare-pid',
            '--die-with-parent', '--as-pid-1', '--new-session', '--ro-bind', '/', '/',
            '--bind', str(root), str(root), '--bind', '/proc', '/proc', '--chdir', str(root),
            '--json-status-fd', str(status_write)] + (
                ['--block-fd', str(gate_read)] if scenario == 'early-owner-killed' else []
            ) + ['--'] + command
    child = subprocess.Popen(command, pass_fds=(owner_read, receipt_write, status_write, gate_read),
        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': str(root),
             'ACOS_FIXTURE_ACCESS': 'fixture-only-private-access'},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for fd in (owner_read, receipt_write, status_write, gate_read):
        os.close(fd)
    status = b''
    if scenario != 'not-pid-one':
        wait_for(lambda: bool(select.select([status_read], [], [], .02)[0]))
        while b'\n' not in status:
            data = os.read(status_read, 4096)
            if not data:
                raise AssertionError('missing_namespace_status')
            status += data
        init_pid = json.loads(status.split(b'\n')[0])['child-pid']
        kernel_namespace = os.readlink('/proc/%s/ns/pid' % init_pid)
        assert kernel_namespace != outside
        initial = {'initPid': init_pid, 'initIdentity': identity(init_pid),
            'namespace': kernel_namespace, 'outerPid': child.pid,
            'outerIdentity': identity(child.pid), 'runId': run_id}
        initial['members'] = {str(init_pid): initial['initIdentity']}
        record(root, 'created.json', initial)
    if scenario == 'early-owner-killed':
        record(root, 'ready.json', initial)
        time.sleep(60)
    receipts = b''
    if scenario not in ('startup-owner-gone', 'not-pid-one'):
        def ready():
            global receipts
            if select.select([receipt_read], [], [], .02)[0]:
                receipts += os.read(receipt_read, 4096)
            return b'\n' in receipts and (root / 'target.json').exists()
        wait_for(ready)
        message = json.loads(receipts.split(b'\n')[0])
        assert message['runId'] == run_id and message['kind'] == 'ready'
        assert message['initPid'] == 1 and message['targetPid'] > 1
        def ready_members():
            members = namespace_members(kernel_namespace, initial['members'])
            return members if len(members) >= 3 else None
        members = wait_for(ready_members)
        initial['members'].update({str(pid): identity(pid) for pid in members})
        assert all(value is not None for value in initial['members'].values())
        record(root, 'created.json', initial)
        record(root, 'ready.json', initial)
        if scenario == 'owner-eof':
            wait_for(lambda: (root / 'stop').exists())
            os.close(owner_write)
            owner_write = None
    stdout, stderr = child.communicate(timeout=12)
    while select.select([receipt_read], [], [], .01)[0]:
        data = os.read(receipt_read, 4096)
        if not data:
            break
        receipts += data
    messages = [json.loads(line) for line in receipts.splitlines()]
    assert b'fixture-only-private-access' not in stdout + stderr + receipts
    record(root, 'result.json', {'exit': child.returncode, 'receipts': messages})
    os._exit(0)

scenario, root = role, Path(sys.argv[2]).resolve()
worker = subprocess.Popen(['/usr/bin/python3', '-I', str(root / 'fixture.py'),
    'worker', str(root), scenario], env={'PATH': '/usr/bin:/bin', 'HOME': str(root), 'LANG': 'C.UTF-8'})
owned = None
try:
    if scenario in ('startup-owner-gone', 'not-pid-one'):
        assert worker.wait(timeout=12) == 0
        result = read_record(root, 'result.json')
        assert result['exit'] == 78 and not (root / 'target.json').exists()
        owned = read_record(root, 'created.json')
    else:
        owned = wait_for(lambda: read_record(root, 'ready.json'))
        if scenario in ('owner-killed', 'early-owner-killed'):
            worker.kill()
            worker.wait(timeout=5)
        elif scenario == 'guardian-killed':
            assert identity(owned['initPid']) == owned['initIdentity']
            assert os.readlink('/proc/%s/ns/pid' % owned['initPid']) == owned['namespace']
            os.kill(owned['initPid'], signal.SIGKILL)
            assert worker.wait(timeout=12) == 0
        else:
            (root / ('stop' if scenario == 'owner-eof' else 'finish')).write_text('fixture')
            assert worker.wait(timeout=12) == 0
            stopped = read_record(root, 'result.json')['receipts'][-1]
            assert stopped['kind'] == 'stopped' and stopped['activeProcesses'] == 0
            assert stopped['targetExitCode'] == (7 if scenario == 'target-crash' else 0 if scenario == 'target-normal' else -9)
    if owned:
        wait_for(lambda: not namespace_members(owned['namespace'], owned['members']))
        wait_for(lambda: all(identity(int(pid)) != value for pid, value in owned['members'].items()))
        wait_for(lambda: identity(owned['initPid']) != owned['initIdentity'])
        wait_for(lambda: identity(owned['outerPid']) != owned['outerIdentity'])
    if scenario == 'early-owner-killed':
        assert not (root / 'target.json').exists()
    print(json.dumps({'scenario': scenario, 'passed': True, 'namespaceEmpty': True,
        'observedNamespace': bool(owned), 'escapedDescendantExercised':
        scenario not in ('startup-owner-gone', 'early-owner-killed', 'not-pid-one')}))
finally:
    if worker.poll() is None:
        worker.kill()
        worker.wait(timeout=5)
    owned = owned or read_record(root, 'created.json')
    if owned and identity(owned['initPid']) == owned['initIdentity']:
        assert os.readlink('/proc/%s/ns/pid' % owned['initPid']) == owned['namespace']
        os.kill(owned['initPid'], signal.SIGKILL)
        wait_for(lambda: not namespace_members(owned['namespace'], owned['members']))
`;
