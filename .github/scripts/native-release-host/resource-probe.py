"""Closed, current-user Windows resource observations. No WMI or shell startup."""
import sys
import json

result = {
    'schema': 'native-resource-probe@1', 'accepted': False,
    'phase': 'load_library', 'freeVirtualKiB': None, 'cFreeBytes': None,
    'fixtureFreeBytes': None, 'nativeErrorCode': None, 'hresult': None,
}


def phase(name):
    result['phase'] = name
    print('native_resource_phase:' + name, file=sys.stderr, flush=True)


try:
    phase('load_library')
    import ctypes
    from ctypes import wintypes
    if (sys.platform != 'win32' or ctypes.sizeof(ctypes.c_void_p) != 8
            or sys.version_info < (3, 12) or not sys.flags.isolated
            or not sys.flags.no_site or not sys.flags.dont_write_bytecode
            or len(sys.argv) != 3 or sys.argv[1] != '--fixture-root'):
        raise ValueError('native_probe_context_required')
    fixture = sys.argv[2]
    if len(fixture) < 3 or not fixture[0].isascii() or not fixture[0].isalpha() or fixture[1] != ':' or fixture[2] not in ('\\', '/'):
        raise ValueError('native_probe_fixture_required')
    # Search only the Windows system directory, never a writable DLL directory.
    kernel = ctypes.WinDLL('kernel32.dll', use_last_error=True, winmode=0x800)

    class MemoryStatus(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('load', wintypes.DWORD)] + [
            (name, ctypes.c_ulonglong) for name in (
                'total_phys', 'avail_phys', 'total_pagefile', 'avail_pagefile',
                'total_virtual', 'avail_virtual', 'avail_extended_virtual')]

    if ctypes.sizeof(MemoryStatus) != 64:
        raise ValueError('native_probe_memory_abi_required')

    memory = kernel.GlobalMemoryStatusEx
    memory.argtypes = [ctypes.POINTER(MemoryStatus)]
    memory.restype = wintypes.BOOL
    disk = kernel.GetDiskFreeSpaceExW
    disk.argtypes = [wintypes.LPCWSTR] + [ctypes.POINTER(ctypes.c_ulonglong)] * 3
    disk.restype = wintypes.BOOL

    def free_bytes(directory):
        available, total, free = (ctypes.c_ulonglong() for _ in range(3))
        if not disk(directory, ctypes.byref(available), ctypes.byref(total), ctypes.byref(free)):
            raise ctypes.WinError(ctypes.get_last_error())
        return available.value  # quota-aware space available to this user

    phase('memory')
    state = MemoryStatus()
    state.length = ctypes.sizeof(state)
    if not memory(ctypes.byref(state)):
        raise ctypes.WinError(ctypes.get_last_error())
    # Commit capacity, not the much larger unused x64 address space.
    result['freeVirtualKiB'] = state.avail_pagefile // 1024
    phase('c_disk')
    result['cFreeBytes'] = free_bytes('C:\\')
    phase('fixture_disk')
    result['fixtureFreeBytes'] = free_bytes(fixture)
    phase('complete')
    result['accepted'] = True
except Exception as error:
    code = getattr(error, 'winerror', None)
    if type(code) is int and 0 <= code <= 0xFFFFFFFF:
        result['nativeErrorCode'] = code
    # Never publish the error object, args, prose, paths or traceback.

print(json.dumps(result, ensure_ascii=True, separators=(',', ':')), flush=True)
raise SystemExit(0 if result['accepted'] else 1)
