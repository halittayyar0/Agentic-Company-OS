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
proc_guard = Path('/source/proc-info-guard.c').read_bytes()
main_anchor = b'int\nmain (int    argc,'
assert changed.count(main_anchor) == 1
changed = changed.replace(main_anchor, proc_guard + b'\n' + main_anchor)
guard_anchor = b'  if (proc_fd == -1)\n    die_with_error ("Can\'t open /proc");'
assert changed.count(guard_anchor) == 1
guard = b'''

  /* Explicit information must refer to our current proc/PID view. Refuse
   * before cloning so a diagnostic mismatch cannot leave a setup child. */
  if (opt_info_fd != -1 || opt_json_status_fd != -1)
    {
      char proc_self_pid[32];
      char expected_proc_self_pid[32];
      ssize_t proc_self_length = readlinkat (proc_fd, "self", proc_self_pid,
                                           sizeof (proc_self_pid));
      int expected_proc_self_length = snprintf (expected_proc_self_pid,
                                               sizeof (expected_proc_self_pid),
                                               "%ld", (long) getpid ());
      if (proc_self_length < 0)
        die_with_error ("Reading proc self for namespace information");
      if (expected_proc_self_length < 0 ||
          (size_t) expected_proc_self_length >= sizeof (expected_proc_self_pid) ||
          proc_self_length != expected_proc_self_length ||
          memcmp (proc_self_pid, expected_proc_self_pid,
                  (size_t) expected_proc_self_length) != 0)
        die ("Cannot report namespace IDs with mismatched procfs PID numbering");
      cleanup_fd int proc_status_fd = TEMP_FAILURE_RETRY (
        openat (proc_fd, "self/status", O_RDONLY | O_CLOEXEC));
      if (proc_status_fd == -1 ||
          !acos_proc_status_matches (proc_status_fd, getpid ()))
        die ("Cannot report namespace IDs with mismatched procfs PID namespace");
    }
'''
changed = changed.replace(guard_anchor, guard_anchor + guard)
(root / 'bubblewrap.c.modified').write_bytes(changed)
command_filter = Path('/source/command-filter.c').read_bytes()
function_anchor = b'static void\nseccomp_programs_apply (void)'
assert changed.count(function_anchor) == 1
filtered = changed.replace(function_anchor, command_filter + b'\n' + function_anchor)
filter_anchor = b'  SeccompProgram *program;\n\n  for (program = seccomp_programs;'
assert filtered.count(filter_anchor) == 1
filtered = filtered.replace(filter_anchor, b'  SeccompProgram *program;\n\n  acos_command_filter_apply ();\n\n  for (program = seccomp_programs;')
(root / 'bubblewrap.c.filtered').write_bytes(filtered)
Path('/source/provenance.json').write_text(json.dumps({
    'kind': 'conditional-and-preclone-information-view-guard-experiment-not-product-acceptance',
    'archiveSha256': expected,
    'sourceSha256': hashlib.sha256(original).hexdigest(),
    'changedSourceSha256': hashlib.sha256(changed).hexdigest(),
    'filteredSourceSha256': hashlib.sha256(filtered).hexdigest(),
    'commandFilterSha256': hashlib.sha256(command_filter).hexdigest(),
    'procInformationGuardSha256': hashlib.sha256(proc_guard).hexdigest(),
    'filterScope': 'mandatory inner helper only; after namespace setup before execution; no opt-out',
    'license': 'LGPL-2.0-or-later',
    'scope': 'same source/toolchain; no production digest or admission modification',
}, indent=2))
