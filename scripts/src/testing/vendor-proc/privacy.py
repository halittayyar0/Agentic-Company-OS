"""Known-live synthetic parent/sibling controls. Never reads a real account."""
import json
import os
import subprocess
import hashlib
import sys

variant=os.environ.get('ACOS_FIXED_PRIVACY_PROFILE')
assert variant in ('red','closed','filtered')
selected='/opt/agentic-inner/bwrap' if variant=='filtered' else '/usr/bin/bwrap'
owner_proof={}
for file in dict.fromkeys(['/usr/bin/bwrap',selected]):
    metadata=os.lstat(file)
    assert os.path.realpath(file)==file and os.path.isfile(file) and not os.path.islink(file)
    assert metadata.st_uid==0 and metadata.st_mode & 0o6022==0
    try:
        os.getxattr(file,'security.capability')
        raise AssertionError('unexpected_file_capability')
    except OSError as error:
        assert error.errno==61  # ENODATA; do not accept observation failures.
    parent=os.path.dirname(file)
    parents=[]
    while True:
        current=os.lstat(parent)
        assert os.path.isdir(parent) and not os.path.islink(parent)
        assert current.st_uid==0 and current.st_mode & 0o022==0
        parents.append({'path':parent,'uid':current.st_uid,'mode':current.st_mode & 0o7777})
        if parent=='/':break
        parent=os.path.dirname(parent)
    owner_proof[file]={'path':file,'uid':metadata.st_uid,'mode':metadata.st_mode & 0o7777,'sha256':hashlib.sha256(open(file,'rb').read()).hexdigest(),'parents':parents,'fileCapabilitiesAbsent':True}

assert os.getuid() == os.getgid() == 1000
inner = r'''
import errno,json,os,select,subprocess,sys
assert os.getpid()==1
owner_proof=json.loads(sys.argv[1])
assert os.environ['ACOS_FIXED_PRIVACY_SENTINEL']=='synthetic-parent-only'
variant=os.environ.get('ACOS_FIXED_PRIVACY_PROFILE')
assert variant in ('red','closed','filtered')
closed=variant!='red'
filtered=variant=='filtered'
expected_profile='agentic-coding-proc-probe (enforce)' if closed else 'agentic-coding (enforce)'
assert open('/proc/self/attr/current').read().strip()==expected_profile
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
def controls(after=False):
    assert sibling.poll() is None
    observed=[]
    for t in targets:
        base='/proc/'+str(t['pid'])
        assert t['sentinel'].encode() in open(base+'/environ','rb').read()
        assert open(base+'/root'+private+'/private-marker').read()=='synthetic-private-file'
        assert open(base+'/cwd/private-marker').read()=='synthetic-private-file'
        assert open(base+'/fd/'+str(t['heldFd'])).read()=='synthetic-private-file'
        assert os.readlink(base+'/fd/'+str(t['controllerFd'])).startswith('pipe:[')
        if not closed and not after:
            with open(base+'/oom_score_adj','w') as f: f.write('100')
        oom=open(base+'/oom_score_adj').read().strip()
        process_start=open(base+'/stat').read().rsplit(')',1)[1].split()[19]
        observed.append({'name':t['name'],'pid':t['pid'],'alive':True,'environmentPositive':True,'rootPositive':True,'cwdPositive':True,'fileFdPositive':True,'controllerFdPositive':True,'processControlPositive':True,'oomValue':oom,'startTime':process_start,'oomInode':os.stat(base+'/oom_score_adj').st_ino})
    return observed
before=controls()
program=r"""
import ctypes,errno,json,os,subprocess,sys,threading
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
    alias=os.path.abspath('alias-'+t['name'])
    open(alias,'x').close()
    # Exact same fixed proc file; a bind alias tests pathname-rule coverage.
    alias_program="import os;f=open(os.environ['ACOS_FIXED_CONTROL_ALIAS'],'w');f.write('200');f.close();print('fixed-alias-write-complete',flush=True)"
    alias_command=['/usr/bin/bwrap','--unshare-user','--unshare-pid','--as-pid-1','--die-with-parent','--new-session','--ro-bind','/','/','--bind','/proc','/proc','--dev','/dev','--tmpfs','/tmp','--bind',os.getcwd(),os.getcwd(),'--bind',base+'/oom_score_adj',alias,'--setenv','ACOS_FIXED_CONTROL_ALIAS',alias,'--','/usr/bin/python3','-I','-S','-c',alias_program]
    try:
        attempt=subprocess.run(alias_command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=3)
        item['aliasControl']={'exitCode':attempt.returncode,'stdout':attempt.stdout[-1024:].decode(),'stderr':attempt.stderr[-2048:].decode(),'timeout':False}
    except subprocess.TimeoutExpired as error:
        item['aliasControl']={'exitCode':None,'stdout':(error.output or b'')[-1024:].decode(),'stderr':(error.stderr or b'')[-2048:].decode(),'timeout':True}
    observed.append(item)
fd=os.open('workspace-marker',os.O_RDONLY)
assert str(fd) in os.listdir('/proc/self/fd')
assert os.readlink('/proc/self/fd/'+str(fd)).endswith('workspace-marker')
os.close(fd)
open('written','w').write('positive-workspace-write')
thread_result=[]
thread=threading.Thread(target=lambda:thread_result.append('ordinary-thread-complete'))
thread.start();thread.join(timeout=2)
assert thread_result==['ordinary-thread-complete'] and not thread.is_alive()
child_program="import ctypes,errno,json,os;lib=ctypes.CDLL(None,use_errno=True);r=lib.unshare(0x10000000);status=dict(line.strip().split(':',1) for line in open('/proc/self/status') if ':' in line);print(json.dumps({'unshareResult':r,'unshareErrno':ctypes.get_errno(),'seccompFilters':int(status['Seccomp_filters'].strip())}),flush=True)"
inherited=subprocess.run(['/usr/bin/python3','-I','-S','-c',child_program],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=2)
assert inherited.returncode==0 and not inherited.stderr and len(inherited.stdout)<1024
status=dict(line.strip().split(':',1) for line in open('/proc/self/status') if ':' in line)
print(json.dumps({'pid':os.getpid(),'uid':os.getuid(),'gid':os.getgid(),'procSelf':os.readlink('/proc/self'),'profile':open('/proc/self/attr/current').read().strip(),'uidMap':open('/proc/self/uid_map').read().strip(),'gidMap':open('/proc/self/gid_map').read().strip(),'selfFdEnumerationAndClose':True,'workspaceRead':open('workspace-marker').read(),'workspaceWritten':True,'ordinaryThreadPositive':True,'ordinaryForkExecPositive':True,'seccompFilters':int(status['Seccomp_filters'].strip()),'descendantFilter':json.loads(inherited.stdout),'directPrivate':read_probe('/tmp/fixed-private/private-marker','synthetic-private-file'),'targets':observed}),flush=True)
"""
inner_helper='/opt/agentic-inner/bwrap' if filtered else '/usr/bin/bwrap'
import hashlib
helper_hash=hashlib.sha256(open(inner_helper,'rb').read()).hexdigest()
helper_metadata=os.stat(inner_helper)
assert helper_metadata.st_mode & 0o6022==0
assert owner_proof[inner_helper]['uid']==0 and owner_proof[inner_helper]['sha256']==helper_hash
command=[inner_helper,'--unshare-user','--unshare-pid','--as-pid-1','--die-with-parent','--new-session','--ro-bind','/','/','--bind','/proc','/proc','--dev','/dev','--tmpfs','/tmp','--bind',workspace,workspace,'--chdir',workspace,'--unsetenv','ACOS_FIXED_PRIVACY_SENTINEL','--','/usr/bin/python3','-I','-S','-c',program,json.dumps(targets)]
result=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=9)
assert len(result.stdout)<16384 and len(result.stderr)<4096
after=controls(after=True)
os.close(controller_read);os.close(controller_write);os.close(held)
sibling.stdin.close();sibling.wait(timeout=2)
print(json.dumps({'kind':'known-live-retained-proc-privacy-experiment-not-acceptance','closed':closed,'filtered':filtered,'innerHelper':inner_helper,'innerHelperSha256':helper_hash,'initialContainerOwnerProof':owner_proof,'nestedHelperOwnerUid':helper_metadata.st_uid,'profile':expected_profile,'before':before,'after':after,'commandExit':result.returncode,'stdout':result.stdout.decode(),'stderr':result.stderr.decode(),'siblingExit':sibling.returncode}),flush=True)
'''
information_read,information_write=os.pipe()
outer=subprocess.Popen(['/usr/bin/bwrap','--unshare-user','--unshare-pid','--as-pid-1','--die-with-parent','--new-session','--json-status-fd',str(information_write),'--ro-bind','/','/','--bind','/proc','/proc','--dev','/dev','--tmpfs','/tmp','--','/usr/bin/python3','-I','-S','-c',inner,json.dumps(owner_proof)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(information_write,),env={**os.environ,'ACOS_FIXED_PRIVACY_SENTINEL':'synthetic-parent-only'})
os.close(information_write)
stdout,stderr=outer.communicate(timeout=15)
assert len(stdout)<32768 and len(stderr)<4096
os.set_blocking(information_read,False)
information=os.read(information_read,8192);os.close(information_read)
print(json.dumps({'kind':'fixed-synthetic-proc-privacy-probe','outerExit':outer.returncode,'stdout':stdout.decode(),'stderr':stderr.decode(),'outerInformation':information.decode()}))
