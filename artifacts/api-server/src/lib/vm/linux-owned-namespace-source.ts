/** Public stdlib-only Python guardian for a dedicated Linux PID namespace.
 * This is process lifetime ownership, not Codex permission or platform approval.
 * A backend launcher must supply a private owner pipe and verify kernel identity.
 * bwrap --die-with-parent alone has a known startup race; EOF is checked before
 * target creation and monitored by PID1 independently of bwrap's outer monitor. */
export const LINUX_OWNED_NAMESPACE_SOURCE = String.raw`
import json, os, select, signal, subprocess, sys, time, uuid

def main():
    if len(sys.argv) < 7:
        raise ValueError()
    run_id, owner_namespace = sys.argv[1:3]
    owner_fd, receipt_fd = map(int, sys.argv[3:5])
    if (str(uuid.UUID(run_id)) != run_id or os.getpid() != 1 or
        os.readlink('/proc/self/ns/pid') == owner_namespace or
        owner_fd == receipt_fd or min(owner_fd, receipt_fd) < 3 or
        max(owner_fd, receipt_fd) > 1024 or not os.path.isabs(sys.argv[5])):
        raise ValueError()
    os.set_inheritable(owner_fd, False)
    os.set_inheritable(receipt_fd, False)
    os.set_blocking(owner_fd, False)
    def alive():
        ready, _, _ = select.select([owner_fd], [], [], 0)
        if not ready:
            return True
        # The owner sends no data. EOF and unexpected control bytes both stop.
        os.read(owner_fd, 1)
        return False
    def report(value):
        value['runId'] = run_id
        payload = (json.dumps(value, separators=(',', ':')) + '\n').encode()
        if os.write(receipt_fd, payload) != len(payload):
            raise OSError()
    if not alive():
        return 78
    stopping = False
    def stop(signum, frame):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    target = subprocess.Popen(sys.argv[5:], close_fds=True)
    report({'kind': 'ready', 'initPid': 1, 'targetPid': target.pid})
    exit_code = None
    while not stopping and alive():
        try:
            while True:
                pid, status = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    break
                if pid == target.pid:
                    exit_code = os.waitstatus_to_exitcode(status)
        except ChildProcessError:
            break
        if exit_code is not None:
            break
        time.sleep(0.025)
    # getpid()==1 and a different kernel namespace were checked above. kill(-1)
    # addresses only this namespace, including detached setsid descendants.
    try:
        os.kill(-1, signal.SIGKILL)
    except ProcessLookupError:
        pass
    until = time.monotonic() + 8
    while time.monotonic() < until:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
            if pid == target.pid and exit_code is None:
                exit_code = os.waitstatus_to_exitcode(status)
            if pid == 0:
                time.sleep(0.025)
        except ChildProcessError:
            report({'kind': 'stopped', 'activeProcesses': 0,
                    'targetExitCode': exit_code})
            return 0
    # No invented cleanup receipt. Exiting PID1 is the kernel backstop.
    return 79

try:
    result = main()
except BaseException:
    os.write(2, b'owned_linux_namespace_failed\n')
    result = 78
os._exit(result)
`;
