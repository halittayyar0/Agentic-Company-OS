import argparse, hashlib, json, os, re, stat, sys, traceback, zipfile
from pathlib import Path

OLLAMA_BYTES=1468053171
OLLAMA_SHA='e5ecff02dfc7cae8ddf6d6b7a7ac5f727ffeedf4491f44ae75ff5b0820dbbbd5'
BASE_COMMIT='ea9c571be0f81f4590453086e6675ff654ab1458'
BASE_BYTES=76115232
BASE_SHA='6d8f6ab631f527d5cfc1e7c63c5584e3e6b4f89d7c38dc900cd291378193c80a'
BASE_PROVENANCE_SHA='89d013141e724c9b11055c92e78a5d883f3c1bee8584911dcca26cf442cbb36c'
ARCHIVE='Agentic-Company-OS-win32-x64.zip'
PROVENANCE='Agentic-Company-OS-win32-x64.provenance.json'

def stream_hash(stream):
    digest=hashlib.sha256()
    while data:=stream.read(1048576):digest.update(data)
    return digest.hexdigest()

def file_hash(file):
    assert file.is_file() and not file.is_symlink()
    with file.open('rb') as stream:return stream_hash(stream)

def check_file(file,size,digest):
    assert re.fullmatch('[a-f0-9]{64}',digest)
    assert file.stat().st_size==size and file_hash(file)==digest

def safe_name(name):
    assert isinstance(name,str) and 0<len(name)<=1024
    assert not re.search(r'[\\:<>"|?*\x00-\x1f\x7f]',name) and not name.startswith('/')
    for part in name.rstrip('/').split('/'):
        assert part not in ('','.','..') and not part.endswith(('.',' '))
        assert not re.fullmatch(r'(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?',part,re.I)

def entries(archive):
    rows=archive.infolist();assert 0<len(rows)<20000
    seen=set()
    for item in rows:
        safe_name(item.filename)
        key=item.filename.casefold();assert key not in seen;seen.add(key)
        assert not stat.S_ISLNK(item.external_attr>>16)
        assert not item.flag_bits&1
    return rows

def small_json(archive,name,limit=4*1024*1024):
    item=archive.getinfo(name);assert 0<item.file_size<=limit
    return json.loads(archive.read(item))

def inspect_native_archive(file,source,node,postgres,version):
    assert re.fullmatch('[a-f0-9]{40}',source)
    with zipfile.ZipFile(file) as archive:
        rows=entries(archive)
        manifest=small_json(archive,'native-distribution.json')
        assert set(manifest)=={'schemaVersion','commit','target','nodeVersion','postgresVersion','files'}
        assert manifest['schemaVersion']==1 and manifest['commit']==source
        assert manifest['target']=='win32-x64'
        assert manifest['nodeVersion']==node and manifest['postgresVersion']==postgres
        inventory=manifest['files'];assert isinstance(inventory,list) and 0<len(inventory)<=20000
        expected=set();total=0
        for row in inventory:
            assert set(row)=={'path','bytes','sha256'}
            name=row['path'];safe_name(name);assert name not in expected and not name.endswith('/')
            assert name!='native-distribution.json';expected.add(name)
            assert type(row['bytes']) is int and 0<=row['bytes']<=128*1024*1024
            assert re.fullmatch('[a-f0-9]{64}',row['sha256'])
            total+=row['bytes'];assert total<=2*1024*1024*1024
            item=archive.getinfo(name);assert item.file_size==row['bytes']
            with archive.open(item) as stream:assert stream_hash(stream)==row['sha256']
        actual={row.filename for row in rows if not row.is_dir()}
        assert actual==expected|{'native-distribution.json'}
        assert {'native-release.json','runtime/node/node.exe','runtime/postgres/bin/postgres.exe','scripts/src/setup/bootstrap.mjs'}<=expected
        release=small_json(archive,'native-release.json',16384)
        assert release=={'schemaVersion':1,'applicationVersion':version,'commit':source,'upgradeProtocol':1}
    return {'commit':source,'target':'win32-x64','nodeVersion':node,'postgresVersion':postgres,'applicationVersion':version,'upgradeProtocol':1,'files':len(inventory),'sha256':file_hash(file)}

def owned_root(value):
    raw=Path(value);assert raw.is_absolute() and not raw.is_symlink()
    root=raw.resolve();parent=Path(os.environ['RUNNER_TEMP']).resolve()
    assert root.parent==parent and root.name.startswith('acos-native-release-host-')
    marker=root/'.owned-native-release-host'
    assert marker.is_file() and not marker.is_symlink()
    assert marker.read_text()=='Private synthetic native release proof\n'
    return root

def save(file,value):
    with file.open('x',encoding='utf8') as stream:json.dump(value,stream,indent=2);stream.write('\n')

def prepare_ollama(root,file):
    check_file(file,OLLAMA_BYTES,OLLAMA_SHA)
    output=root/'ollama-runtime';output.mkdir(mode=0o700)
    files=[]
    with zipfile.ZipFile(file) as archive:
        for item in entries(archive):
            name=item.filename
            if item.is_dir() or not(name=='ollama.exe' or re.fullmatch(r'lib/ollama/[A-Za-z0-9+_.-]+',name)):continue
            target=output.joinpath(*name.split('/'))
            assert target.resolve().is_relative_to(output.resolve())
            target.parent.mkdir(parents=True,exist_ok=True)
            with archive.open(item) as source,target.open('xb') as destination:
                while data:=source.read(1048576):destination.write(data)
            files.append({'path':name,'bytes':item.file_size,'sha256':file_hash(target)})
    assert len(files)==44
    report={'accepted':True,'runtimeVersion':'0.40.3','archiveSha256':OLLAMA_SHA,'archive':str(file),'runtimeRoot':str(output),'files':files,'executedCode':False}
    save(root/'ollama-input.json',report)
    return len(files)

def prepare_native(root,file,source,artifact_sha,artifact_bytes):
    assert re.fullmatch('[a-f0-9]{40}',source)
    assert 0<artifact_bytes<=256*1024*1024
    check_file(file,artifact_bytes,artifact_sha)
    with zipfile.ZipFile(file) as envelope:
        rows=entries(envelope)
        assert {row.filename for row in rows}=={ARCHIVE,PROVENANCE}
        provenance=small_json(envelope,PROVENANCE,16384)
        assert provenance['schemaVersion']==1 and provenance['commit']==source and provenance['target']=='win32-x64'
        assert provenance['dirty'] is False and provenance['development'] is False
        assert provenance['node']['version']=='24.22.1' and provenance['postgres']['version']=='17.11'
        assert provenance['archive']==ARCHIVE and re.fullmatch('[a-f0-9]{64}',provenance['sha256'])
        output=root/'native-input';output.mkdir(mode=0o700)
        for name in [ARCHIVE,PROVENANCE]:
            with envelope.open(name) as src,(output/name).open('xb') as dst:
                while data:=src.read(1048576):dst.write(data)
    inspected=inspect_native_archive(output/ARCHIVE,source,'24.22.1','17.11','0.5.9')
    assert inspected['sha256']==provenance['sha256'] and inspected['files']==provenance['files']
    inspected.update({'accepted':True,'artifactSha256':artifact_sha,'archive':str(output/ARCHIVE),'provenance':str(output/PROVENANCE),'provenanceSha256':file_hash(output/PROVENANCE),'executedCode':False})
    save(root/'native-input.json',inspected)
    return inspected['files']

def prepare_baseline(root,file,provenance_file):
    check_file(file,BASE_BYTES,BASE_SHA)
    check_file(provenance_file,1002,BASE_PROVENANCE_SHA)
    provenance=json.loads(provenance_file.read_text())
    assert provenance['commit']==BASE_COMMIT and provenance['sha256']==BASE_SHA
    assert provenance['target']=='win32-x64' and provenance['dirty'] is False and provenance['development'] is False
    inspected=inspect_native_archive(file,BASE_COMMIT,'24.21.0','17.10','0.5.7')
    assert inspected['files']==provenance['files']==2295
    inspected.update({'accepted':True,'archive':str(file),'provenance':str(provenance_file),'provenanceSha256':BASE_PROVENANCE_SHA,'executedCode':False,'scope':'Actual published old upgrade input, not current runtime-security acceptance'})
    save(root/'baseline-input.json',inspected)
    return inspected['files']

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['ollama','native','baseline'])
    parser.add_argument('--owned-root',required=True)
    parser.add_argument('--archive',required=True)
    parser.add_argument('--application-commit')
    parser.add_argument('--artifact-sha')
    parser.add_argument('--artifact-bytes',type=int)
    parser.add_argument('--provenance')
    args=parser.parse_args();root=owned_root(args.owned_root)
    try:
        file=Path(args.archive).resolve()
        if args.action=='ollama':count=prepare_ollama(root,file)
        elif args.action=='native':count=prepare_native(root,file,args.application_commit,args.artifact_sha,args.artifact_bytes)
        else:count=prepare_baseline(root,file,Path(args.provenance).resolve())
    except Exception:
        failure=root/('private-'+args.action+'-input-failure.txt')
        with failure.open('x',encoding='utf8') as stream:stream.write(traceback.format_exc())
        print(json.dumps({'action':args.action,'accepted':False,'failureCode':'input_preparation_failed'}));return 1
    print(json.dumps({'action':args.action,'accepted':True,'verifiedFiles':count,'executedCode':False}));return 0

if __name__=='__main__':sys.exit(main())
