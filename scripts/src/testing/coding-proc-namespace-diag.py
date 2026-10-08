"""Fixed public no-Codex lookup diagnosis; never release acceptance."""
import json
import os
import subprocess

assert os.getuid() == 1000
for _ in range(12):
    subprocess.run(['/usr/bin/true'], check=True, timeout=2)

inner = r'''
import json,os,subprocess,sys
identity={'pid':os.getpid(),'procSelf':os.readlink('/proc/self'),'pidNamespace':os.readlink('/proc/self/ns/pid')}
command=['/usr/bin/bwrap','--unshare-user','--unshare-pid','--as-pid-1','--die-with-parent','--new-session','--ro-bind','/','/','--bind','/proc','/proc','--dev','/dev','--tmpfs','/tmp','--','/usr/bin/true']
child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
try:
    stdout,stderr=child.communicate(timeout=2)
    result={'identity':identity,'childPid':child.pid,'returncode':child.returncode,'timeout':False,'stderr':stderr[-2048:].decode('utf8','replace')}
except subprocess.TimeoutExpired as error:
    result={'identity':identity,'childPid':child.pid,'returncode':child.poll(),'timeout':True,'stderr':(error.stderr or b'')[-2048:].decode('utf8','replace')}
print(json.dumps(result),flush=True)
# This fixed namespace's PID1 exits; kernel destroys all its descendants.
os._exit(0)
'''
command=['/usr/bin/bwrap','--unshare-user','--unshare-pid','--as-pid-1','--die-with-parent','--new-session','--ro-bind','/','/','--bind','/proc','/proc','--dev','/dev','--tmpfs','/tmp','--','/usr/bin/python3','-I','-S','-c',inner]
try:
    result=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
    print(json.dumps({'kind':'fixed-retained-proc-pid-lookup','outerReturncode':result.returncode,'result':result.stdout[-8192:].decode('utf8','replace'),'outerStderr':result.stderr[-2048:].decode('utf8','replace'),'scope':'separate synthetic container; no Codex, credentials, inference or product acceptance'}))
except subprocess.TimeoutExpired:
    raise SystemExit('fixed_outer_probe_deadline')
