"""Known-live synthetic parent/sibling controls. Never reads a real account."""
import json
import os
import subprocess

assert os.getuid() == os.getgid() == 1000
inner = r'''
import ctypes,errno,json,os,select,subprocess,sys
assert os.getpid()==1
assert os.environ['ACOS_FIXED_PRIVACY_SENTINEL']=='synthetic-parent-only'
private='/tmp/fixed-private'
workspace='/tmp/fixed-workspace'
os.mkdir(private,0o700);os.mkdir(workspace,0o700)
open(private+'/private-marker','w').write('synthetic-private-file')
open(workspace+'/workspace-marker','w').write('positive-workspace')
os.chdir(private)
held=os.open(private+'/private-marker',os.O_RDONLY)
controller_read,controller_write=os.pipe()
os.write(controller_write,b'synthetic-controller-pipe')
def proc_pid(): return int(os.readlink('/proc/self'))
parent={'name':'parent','pid':proc_pid(),'heldFd':held,'controllerFd':controller_read,'sentinel':'synthetic-parent-only'}
sibling_program=r"""
import json,os,sys
assert os.environ['ACOS_FIXED_PRIVACY_SENTINEL']=='synthetic-sibling-only'
os.chdir('/tmp/fixed-private')
held=os.open('private-marker',os.O_RDONLY)
controller=int(sys.argv[1])
print(json.dumps({'name':'sibling','pid':int(os.readlink('/proc/self')),'heldFd':held,'controllerFd':controller,'sentinel':'synthetic-sibling-only'}),flush=True)
sys.stdin.buffer.read(1)
"""
sibling=subprocess.Popen(['/usr/bin/python3','-I','-S','-c',sibling_program,str(controller_read)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'ACOS_FIXED_PRIVACY_SENTINEL':'synthetic-sibling-only'},pass_fds=(controller_read,))
assert select.select([sibling.stdout],[],[],2)[0]
record=sibling.stdout.readline()
assert len(record)<2048
targets=[parent,json.loads(record)]
def controls():
    assert sibling.poll() is None
    observed=[]
    for t in targets:
        base='/proc/'+str(t['pid'])
        assert t['sentinel'].encode() in open(base+'/environ','rb').read()
        assert open(base+'/root'+private+'/private-marker').read()=='synthetic-private-file'
        assert open(base+'/cwd/private-marker').read()=='synthetic-private-file'
        assert open(base+'/fd/'+str(t['heldFd'])).read()=='synthetic-private-file'
        assert os.readlink(base+'/fd/'+str(t['controllerFd'])).startswith('pipe:[')
        with open(base+'/oom_score_adj','r+') as f:
            f.write('100');f.flush();f.seek(0);assert f.read().strip()=='100'
        observed.append({'name':t['name'],'pid':t['pid'],'alive':True,'environmentPositive':True,'rootPositive':True,'cwdPositive':True,'fileFdPositive':True,'controllerFdPositive':True,'processControlPositive':True})
    return observed
before=controls()
program=r"""
import errno,json,os,sys
targets=json.loads(sys.argv[1])
def read_probe(file,sentinel):
    try:
        with open(file,'rb') as f: value=f.read(2048)
        return {'opened':True,'sentinelReadable':sentinel.encode() in value,'denialErrno':None}
    except OSError as e:
        return {'opened':False,'sentinelReadable':False,'denialErrno':e.errno}
observed=[]
for t in targets:
    base='/proc/'+str(t['pid'])
    item={'name':t['name'],'pid':t['pid']}
    item['environment']=read_probe(base+'/environ',t['sentinel'])
    item['root']=read_probe(base+'/root/tmp/fixed-private/private-marker','synthetic-private-file')
    item['cwd']=read_probe(base+'/cwd/private-marker','synthetic-private-file')
    item['fileFd']=read_probe(base+'/fd/'+str(t['heldFd']),'synthetic-private-file')
    try:
        fd=os.open(base+'/fd/'+str(t['controllerFd']),os.O_RDONLY|os.O_NONBLOCK)
        try: value=os.read(fd,2048)
        finally: os.close(fd)
        item['controllerFd']={'opened':True,'sentinelReadable':b'synthetic-controller-pipe' in value,'denialErrno':None}
    except OSError as e: item['controllerFd']={'opened':False,'sentinelReadable':False,'denialErrno':e.errno}
    try:
        with open(base+'/oom_score_adj','w') as f: f.write('200')
        item['processControl']={'opened':True,'denialErrno':None}
    except OSError as e: item['processControl']={'opened':False,'denialErrno':e.errno}
    observed.append(item)
print(json.dumps({'pid':os.getpid(),'procSelf':os.readlink('/proc/self'),'workspaceRead':open('workspace-marker').read(),'directPrivate':read_probe('/tmp/fixed-private/private-marker','synthetic-private-file'),'targets':observed}),flush=True)
"""
command=['/usr/bin/bwrap','--unshare-user','--unshare-pid','--as-pid-1','--die-with-parent','--new-session','--ro-bind','/','/','--bind','/proc','/proc','--dev','/dev','--tmpfs','/tmp','--bind',workspace,workspace,'--chdir',workspace,'--unsetenv','ACOS_FIXED_PRIVACY_SENTINEL','--','/usr/bin/python3','-I','-S','-c',program,json.dumps(targets)]
result=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
assert len(result.stdout)<16384 and len(result.stderr)<4096
after=controls()
# The controlled command may consume the synthetic pipe; write new public data
# only after the access result is recorded. No private owner pipe is involved.
os.close(controller_read);os.close(controller_write);os.close(held)
sibling.stdin.close();sibling.wait(timeout=2)
print(json.dumps({'kind':'known-live-retained-proc-privacy-experiment-not-acceptance','before':before,'after':after,'commandExit':result.returncode,'stdout':result.stdout.decode(),'stderr':result.stderr.decode(),'siblingExit':sibling.returncode}),flush=True)
'''
information_read,information_write=os.pipe()
outer=subprocess.Popen(['/usr/bin/bwrap','--unshare-user','--unshare-pid','--as-pid-1','--die-with-parent','--new-session','--json-status-fd',str(information_write),'--ro-bind','/','/','--bind','/proc','/proc','--dev','/dev','--tmpfs','/tmp','--','/usr/bin/python3','-I','-S','-c',inner],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(information_write,),env={**os.environ,'ACOS_FIXED_PRIVACY_SENTINEL':'synthetic-parent-only'})
os.close(information_write)
stdout,stderr=outer.communicate(timeout=12)
assert len(stdout)<32768 and len(stderr)<4096
os.set_blocking(information_read,False)
information=os.read(information_read,8192);os.close(information_read)
print(json.dumps({'kind':'fixed-synthetic-proc-privacy-probe','outerExit':outer.returncode,'stdout':stdout.decode(),'stderr':stderr.decode(),'outerInformation':information.decode()}))
