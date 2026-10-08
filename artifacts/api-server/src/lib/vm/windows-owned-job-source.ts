/** Compiled with the Windows PowerShell/.NET Framework supplied by Windows.
 * Public source, no package download or runtime credential in compiler input.
 * Job lifetime is separate from Codex's filesystem/network sandbox. */
export const WINDOWS_OWNED_JOB_SOURCE = String.raw`
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public static class AcosOwnedJob {
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct Counters {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public Limits BasicLimitInformation; public Counters IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint cb; public string reserved, desktop, title;
    public uint x, y, xSize, ySize, xChars, yChars, fillAttribute, flags;
    public ushort showWindow, reservedSize; public IntPtr reservedBytes, stdin, stdout, stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, uint size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr kind, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo process);

  static void Check(bool value) { if (!value) throw new InvalidOperationException("owned_job_failed"); }
  static void Record(string directory, string name, string value) {
    string temporary = Path.Combine(directory, "tmp-" + Guid.NewGuid().ToString("N"));
    File.WriteAllText(temporary, value, new UTF8Encoding(false));
    File.Move(temporary, Path.Combine(directory, name));
  }
  static void Drain(IntPtr job) {
    Check(TerminateJobObject(job, 125));
    for (int i = 0; i < 100; i++) {
      Accounting accounting;
      Check(QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
      if (accounting.ActiveProcesses == 0) return;
      Thread.Sleep(50);
    }
    throw new InvalidOperationException("owned_job_not_drained");
  }

  public static int Main(string[] args) {
    IntPtr job = IntPtr.Zero, parent = IntPtr.Zero, attributes = IntPtr.Zero, handleList = IntPtr.Zero;
    IntPtr[] streams = new IntPtr[3]; ProcessInfo child = new ProcessInfo();
    bool assigned = false, created = false, initializedAttributes = false, drained = false, recorded = false;
    string directory = null, nonce = null;
    uint childCode = 125;
    try {
      uint parentId = 0; Guid runId = Guid.Empty;
      Check(args.Length == 4 && UInt32.TryParse(args[2], out parentId) && parentId > 0 && Guid.TryParse(args[3], out runId));
      directory = Path.GetFullPath(args[1]); nonce = args[3];
      string executable = Path.GetFullPath(args[0]);
      Check(!executable.Contains("\"") && File.Exists(executable) && Directory.Exists(directory));
      parent = OpenProcess(0x00100000, false, parentId); Check(parent != IntPtr.Zero);
      Check(WaitForSingleObject(parent, 0) == 258 && !File.Exists(Path.Combine(directory, "stop.json")));
      job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
      ExtendedLimits limits = new ExtendedLimits();
      // No BREAKAWAY_OK or SILENT_BREAKAWAY_OK. Closing the last owned handle
      // also kills members if this supervisor crashes.
      limits.BasicLimitInformation.LimitFlags = 0x00002000;
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
      IntPtr current = GetCurrentProcess();
      for (int i = 0; i < 3; i++) Check(DuplicateHandle(current, GetStdHandle(-10-i), current, out streams[i], 0, true, 2));
      IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      attributes = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); initializedAttributes = true;
      handleList = Marshal.AllocHGlobal(3 * IntPtr.Size);
      for (int i = 0; i < 3; i++) Marshal.WriteIntPtr(handleList, i * IntPtr.Size, streams[i]);
      Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x00020002), handleList, new IntPtr(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
      StartupEx startup = new StartupEx(); startup.startup.cb = (uint)Marshal.SizeOf(typeof(StartupEx));
      startup.startup.flags = 0x00000100; startup.startup.stdin = streams[0]; startup.startup.stdout = streams[1]; startup.startup.stderr = streams[2]; startup.attributes = attributes;
      // SUSPENDED closes the process-creation/job-assignment race. The child
      // receives only stdio handles, never the job or parent-control handles.
      Check(CreateProcess(executable, new StringBuilder("\"" + executable + "\" app-server --listen stdio://"), IntPtr.Zero, IntPtr.Zero, true, 0x08080004, IntPtr.Zero, Environment.CurrentDirectory, ref startup, out child));
      created = true; Check(AssignProcessToJobObject(job, child.process)); assigned = true;
      Check(WaitForSingleObject(parent, 0) == 258 && !File.Exists(Path.Combine(directory, "stop.json")));
      Record(directory, "ready.json", "{\"runId\":\"" + nonce + "\",\"childPid\":" + child.processId + "}");
      Check(ResumeThread(child.thread) != UInt32.MaxValue);
      while (true) {
        uint wait = WaitForSingleObject(child.process, 100);
        Check(wait == 0 || wait == 258);
        if (wait == 0) { Check(GetExitCodeProcess(child.process, out childCode)); break; }
        if (WaitForSingleObject(parent, 0) != 258 || File.Exists(Path.Combine(directory, "stop.json"))) break;
      }
      Drain(job); drained = true;
      Record(directory, "stopped.json", "{\"runId\":\"" + nonce + "\",\"activeProcesses\":0,\"childExitCode\":" + childCode + "}");
      recorded = true;
      return childCode <= 255 ? (int)childCode : 125;
    } catch {
      // Failure never writes a false zero-process receipt. An assigned job is
      // still killed when its private handle closes in finally.
      return 126;
    } finally {
      if (assigned && !drained) { try { Drain(job); drained = true; } catch {} }
      if (created && !assigned) { drained = TerminateProcess(child.process, 126) && WaitForSingleObject(child.process, 5000) == 0; }
      // A failed CreateProcess with no process handle/id proves no target ran.
      // Other startup failures need the same actual zero-members proof.
      if (!created && child.process == IntPtr.Zero && child.processId == 0) drained = true;
      if (drained && !recorded && directory != null && nonce != null) {
        try { Record(directory, "stopped.json", "{\"runId\":\"" + nonce + "\",\"activeProcesses\":0,\"childExitCode\":126,\"startFailed\":true}"); } catch {}
      }
      if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
      if (child.process != IntPtr.Zero) CloseHandle(child.process);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (parent != IntPtr.Zero) CloseHandle(parent);
      if (initializedAttributes) DeleteProcThreadAttributeList(attributes);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      foreach (IntPtr stream in streams) if (stream != IntPtr.Zero) CloseHandle(stream);
    }
  }
}
`;
