"""Fixed non-release RED/GREEN probe; no Codex, account, model or network."""
import json
import os
import subprocess
import sys

assert os.getuid() == 1000 and os.getgid() == 1000
case = sys.argv[1]
assert case in ('plain', 'info-missing', 'info-collision')
keepers = []
collision_pid = 0
# Leave no low-numbered process to accidentally satisfy the numeric lookup.
if case == 'info-collision':
    sibling = subprocess.Popen(['/usr/bin/python3', '-I', '-S', '-c', 'import time; time.sleep(30)'])
    keepers.append(sibling)
    collision_pid = sibling.pid
    assert 3 <= collision_pid <= 64
for _ in range(12):
    subprocess.run(['/usr/bin/true'], check=True, timeout=2)

inner = r'''
import hashlib,json,os,subprocess,sys
def proc_mounts():
    result={}
    for line in open('/proc/self/mountinfo'):
        a,b=line.strip().split(' - ',1); fields=a.split(); tail=b.split()
        if fields[4].startswith('/proc/'):
            result[fields[4]]={'root':fields[3],'flags':sorted(set(fields[5].split(',')) & {'ro','rw','nosuid','nodev','noexec'}),'kind':tail[0],'source':tail[1]}
    return result
identity={'pid':os.getpid(),'procSelf':os.readlink('/proc/self'),'pidNamespace':os.readlink('/proc/self/ns/pid'),'mountNamespace':os.readlink('/proc/self/ns/mnt'),'procChildren':proc_mounts()}
assert identity['pid']==1
workspace='/tmp/fixed-workspace'
os.mkdir(workspace,0o700)
open(workspace+'/marker','w').write('fixed-readable-workspace')
program=r"""
import errno,json,os,re
status=dict(line.strip().split(':',1) for line in open('/proc/self/status') if ':' in line)
mounts={}
root_ro=False
for line in open('/proc/self/mountinfo'):
    a,b=line.strip().split(' - ',1); f=a.split(); t=b.split()
    if f[4]=='/': root_ro='ro' in f[5].split(',')
    if f[4].startswith('/proc/'): mounts[f[4]]={'root':f[3],'flags':sorted(set(f[5].split(',')) & {'ro','rw','nosuid','nodev','noexec'}),'kind':t[0],'source':t[1]}
read=open('marker').read()
open('written','w').write('fixed-written-workspace')
root_write_error=None
try:
    with open('/acos-fixed-root-write','x'): pass
except OSError as e: root_write_error=e.errno
print('ACOS_KERNEL_RESULT:'+json.dumps({'pid':os.getpid(),'procSelf':os.readlink('/proc/self'),'uid':os.getuid(),'gid':os.getgid(),'caps':{k:status[k].strip() for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']},'nnp':status['NoNewPrivs'].strip(),'apparmor':open('/proc/self/attr/current').read().strip(),'pidNamespace':os.readlink('/proc/self/ns/pid'),'mountNamespace':os.readlink('/proc/self/ns/mnt'),'rootRo':root_ro,'rootWriteError':root_write_error,'read':read,'procChildren':mounts}),flush=True)
"""
command=['/usr/bin/bwrap','--unshare-user','--unshare-pid','--as-pid-1','--die-with-parent','--new-session','--ro-bind','/','/','--bind','/proc','/proc','--dev','/dev','--tmpfs','/tmp','--bind',workspace,workspace,'--chdir',workspace]
if sys.argv[1]!='plain': command += ['--json-status-fd','1']
command += ['--','/usr/bin/python3','-I','-S','-c',program]
collision_pid=int(sys.argv[2])
if collision_pid:
    for _ in range(collision_pid-3): subprocess.run(['/usr/bin/true'],check=True,timeout=2)
child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if collision_pid: assert child.pid==collision_pid-1
try:
    stdout,stderr=child.communicate(timeout=3)
    timeout=False
except subprocess.TimeoutExpired as error:
    stdout,stderr=error.output or b'',error.stderr or b''
    timeout=True
result={'case':sys.argv[1],'identity':identity,'childPid':child.pid,'collisionTargetPid':collision_pid,'returncode':child.poll(),'timeout':timeout,'stdout':stdout[-16384:].decode('utf8','replace'),'stderr':stderr[-2048:].decode('utf8','replace'),'workspaceWritten':os.path.isfile(workspace+'/written') and open(workspace+'/written').read()=='fixed-written-workspace'}
print('ACOS_PROBE_RESULT:'+json.dumps(result),flush=True)
# Fixed namespace PID1 exits; the kernel retires its descendants and all pipes.
os._exit(0)
'''
command = ['/usr/bin/bwrap', '--unshare-user', '--unshare-pid', '--as-pid-1', '--die-with-parent', '--new-session', '--json-status-fd', '1', '--ro-bind', '/', '/', '--bind', '/proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--', '/usr/bin/python3', '-I', '-S', '-c', inner, case, str(collision_pid)]
try:
    result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    assert len(result.stdout) <= 32768 and len(result.stderr) <= 8192
    print(json.dumps({'kind': 'sole-conditional-vendor-probe', 'case': case, 'outerReturncode': result.returncode, 'result': result.stdout.decode('utf8','replace'), 'outerStderr': result.stderr.decode('utf8','replace'), 'scope': 'standalone fixed experiment only; no production toolchain or permission acceptance'}))
finally:
    for sibling in keepers:
        sibling.terminate()
        sibling.wait(timeout=2)
