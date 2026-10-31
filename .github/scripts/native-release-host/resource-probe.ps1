param([Parameter(Mandatory=$true)][string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Closed numeric projection only. No host paths, exception text or inherited
# management-provider requirements enter a public receipt.
$result = [ordered]@{schema='native-resource-probe@1';accepted=$false;phase='compile';freeVirtualKiB=$null;cFreeBytes=$null;fixtureFreeBytes=$null;nativeErrorCode=$null;hresult=$null}
try {
    if (-not [Environment]::Is64BitProcess -or $FixtureRoot -notmatch '^[A-Za-z]:[\\/]') { throw 'native_probe_context_required' }
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AcosNativeResources {
    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatus {
        public uint Length, Load;
        public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile;
        public ulong TotalVirtual, AvailVirtual, AvailExtendedVirtual;
    }
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetDiskFreeSpaceExW(string directory, out ulong callerAvailable, out ulong total, out ulong free);
    public static ulong AvailableCommitKiB() {
        var status = new MemoryStatus();
        status.Length = (uint)Marshal.SizeOf(typeof(MemoryStatus));
        if (!GlobalMemoryStatusEx(ref status)) throw new Win32Exception(Marshal.GetLastWin32Error());
        // Available commit honors process/job limits. AvailVirtual is only
        // x64 address space and must never be used as model memory admission.
        return status.AvailPageFile / 1024UL;
    }
    public static ulong CallerAvailableBytes(string directory) {
        ulong available, total, free;
        if (!GetDiskFreeSpaceExW(directory, out available, out total, out free)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return available; // respects the actual caller's disk quota
    }
}
'@
    $result.phase = 'memory'
    $result.freeVirtualKiB = [AcosNativeResources]::AvailableCommitKiB()
    $result.phase = 'c_disk'
    $result.cFreeBytes = [AcosNativeResources]::CallerAvailableBytes('C:\')
    $result.phase = 'fixture_disk'
    $result.fixtureFreeBytes = [AcosNativeResources]::CallerAvailableBytes($FixtureRoot)
    $result.phase = 'complete'
    $result.accepted = $true
} catch {
    $failure = $_.Exception
    $result.hresult = [int]$failure.HResult
    for ($depth=0; $depth -lt 8 -and $null -ne $failure; $depth++) {
        if ($failure -is [ComponentModel.Win32Exception]) { $result.nativeErrorCode = [int]$failure.NativeErrorCode; break }
        $failure = $failure.InnerException
    }
}
[Console]::WriteLine(($result | ConvertTo-Json -Compress))
if (-not $result.accepted) { exit 1 }
