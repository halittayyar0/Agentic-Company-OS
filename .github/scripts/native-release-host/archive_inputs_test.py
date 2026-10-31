import hashlib, json, tempfile, unittest, zipfile
from pathlib import Path
from archive_inputs import inspect_native_archive

SOURCE='a'*40
def bundle(path, changes=None, extra=None, wrong_hash=False):
    release={'schemaVersion':1,'applicationVersion':'0.5.9','commit':SOURCE,'upgradeProtocol':1}
    payload={'runtime/node/node.exe':b'not executed unit fixture',
             'runtime/postgres/bin/postgres.exe':b'not executed unit fixture',
             'scripts/src/setup/bootstrap.mjs':b'not executed unit fixture',
             'native-release.json':json.dumps(release).encode()}
    manifest={'schemaVersion':1,'commit':SOURCE,'target':'win32-x64','nodeVersion':'24.22.1','postgresVersion':'17.11',
              'files':[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in payload.items()]}
    if changes: manifest.update(changes)
    if wrong_hash:payload['runtime/node/node.exe']=b'changed after inventory'
    with zipfile.ZipFile(path,'w') as archive:
        for name,data in payload.items():archive.writestr(name,data)
        archive.writestr('native-distribution.json',json.dumps(manifest))
        if extra:archive.writestr(extra,b'not inventoried')

class ArchiveAdmission(unittest.TestCase):
    def setUp(self):
        self.owned=tempfile.TemporaryDirectory(prefix='acos-native-input-unit-')
        self.addCleanup(self.owned.cleanup)
        self.file=Path(self.owned.name)/'unit.zip'
    def inspect(self):return inspect_native_archive(self.file,SOURCE,'24.22.1','17.11','0.5.9')
    def test_manifest_source_runtime_and_every_actual_byte_are_bound(self):
        bundle(self.file);self.assertEqual(self.inspect()['files'],4)
        for change in [{'commit':'b'*40},{'nodeVersion':'24.21.0'},{'postgresVersion':'17.10'},{'target':'linux-x64'}]:
            bundle(self.file,changes=change)
            with self.assertRaises(AssertionError):self.inspect()
        bundle(self.file,wrong_hash=True)
        with self.assertRaises(AssertionError):self.inspect()
    def test_uninventoried_or_traversing_entries_are_refused_without_extraction(self):
        for extra in ['extra.txt','../escape.txt','/absolute.txt','runtime\\alternate.txt','C:alternate.txt']:
            bundle(self.file,extra=extra)
            with self.assertRaises(AssertionError):self.inspect()
        self.assertEqual(sorted(p.name for p in Path(self.owned.name).iterdir()),['unit.zip'])

if __name__=='__main__':unittest.main()
