"""Controlled source experiment only. Does not modify production tool identity."""
import hashlib
import json
from pathlib import Path
import tarfile

archive = Path('/source/bubblewrap-source.tar.gz')
expected = 'd038cebff7a83e2ea0039f652e19b18f708e99b93ab2372341d488c393fc1a5a'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected
root = Path('/source/tree')
root.mkdir(mode=0o755)
with tarfile.open(archive, 'r:gz') as bundle:
    entries = bundle.getmembers()
    assert len(entries) == 50
    names = set()
    for entry in entries:
        name = Path(entry.name)
        assert name.parts[0] == 'bubblewrap' and not name.is_absolute()
        assert '..' not in name.parts and entry.name not in names
        names.add(entry.name)
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if entry.isfile():
            assert 0 <= entry.size <= 1024 * 1024
            stream = bundle.extractfile(entry)
            assert stream is not None
            target.write_bytes(stream.read())
            target.chmod(entry.mode & 0o755)
        else:
            assert entry.issym() and entry.name == 'bubblewrap/LICENSE' and entry.linkname == 'COPYING'
            target.symlink_to('COPYING')
source = root / 'bubblewrap/bubblewrap.c'
original = source.read_bytes()
anchor = b'      namespace_ids_read (pid);'
assert original.count(anchor) == 1
changed = original.replace(anchor, b'      if (opt_info_fd != -1 || opt_json_status_fd != -1)\n        namespace_ids_read (pid);')
(root / 'bubblewrap.c.modified').write_bytes(changed)
Path('/source/provenance.json').write_text(json.dumps({
    'kind': 'sole-conditional-vendor-experiment-not-product-acceptance',
    'archiveSha256': expected,
    'sourceSha256': hashlib.sha256(original).hexdigest(),
    'changedSourceSha256': hashlib.sha256(changed).hexdigest(),
    'license': 'LGPL-2.0-or-later',
    'scope': 'same source/toolchain; no production digest or admission modification',
}, indent=2))
