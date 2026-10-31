# Disposable CI fixture only. Unit tests compile and check in-memory descriptors;
# they never call Protect/Restore against the operator's filesystem.
$ErrorActionPreference = 'Stop'
if (-not ('NativeReleaseReadonlyAcl' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.ComponentModel;

public static class NativeReleaseReadonlyAcl {
    public static int JournalEntries { get; private set; }
    const uint Mutation = 0x000d0156; // data/append/EA/attributes/delete-child/delete/DACL/owner
    const uint AncestorMutation = 0x000d0040; // delete-child/delete/DACL/owner
    const int MaxEntries = 400000;
    sealed class Saved { public string Path; public bool Directory; public byte[] Descriptor; }
    [StructLayout(LayoutKind.Sequential)] struct GenericMapping { public uint Read,Write,Execute,All; }
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool DuplicateToken(IntPtr existing, int level, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool AccessCheck(byte[] descriptor, IntPtr token, uint desired, ref GenericMapping mapping, IntPtr privileges, ref uint size, out uint granted, out bool allowed);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name, uint desired, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(IntPtr handle, System.Text.StringBuilder text, uint length, uint flags);
    [DllImport("advapi32.dll", SetLastError=true)] static extern uint GetSecurityInfo(IntPtr handle, int objectType, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll", SetLastError=true)] static extern uint SetSecurityInfo(IntPtr handle, int objectType, uint information, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    static string Full(string value) { var full=System.IO.Path.GetFullPath(value);return full.Length==3 ? full : full.TrimEnd('\\'); }
    static string Long(string value) { return value.StartsWith(@"\\?\",StringComparison.Ordinal) ? value : @"\\?\"+value; }
    static bool Within(string value,string root) { return value.Equals(root,StringComparison.OrdinalIgnoreCase)||value.StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase); }
    static string Resolve(string value) {
        IntPtr h=CreateFile(Long(value),0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero);
        if(h==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { var result=new System.Text.StringBuilder(32768); uint count=GetFinalPathNameByHandle(h,result,(uint)result.Capacity,0); if(count==0||count>=result.Capacity) throw new InvalidOperationException("readonly_target_resolution_failed"); var resolved=result.ToString(); if(!resolved.StartsWith(@"\\?\",StringComparison.Ordinal)||resolved.StartsWith(@"\\?\UNC\",StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("local_control_target_required"); return Full(resolved.Substring(4)); } finally {CloseHandle(h);}
    }
    static FileSystemSecurity Security(string file,bool directory) {
        // OPEN_REPARSE_POINT opens the link object's own ACL, never its target.
        IntPtr handle=CreateFile(Long(file),0x00020000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
        if(handle==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr owner,group,dacl,sacl,descriptor=IntPtr.Zero;
        try {
            uint error=GetSecurityInfo(handle,1,7,out owner,out group,out dacl,out sacl,out descriptor);if(error!=0)throw new Win32Exception((int)error);
            uint length=GetSecurityDescriptorLength(descriptor);if(length<20||length>1048576)throw new InvalidOperationException("bounded_control_descriptor_required");
            var bytes=new byte[length];Marshal.Copy(descriptor,bytes,0,(int)length);
            FileSystemSecurity security=directory ? (FileSystemSecurity)new DirectorySecurity() : new FileSecurity();
            security.SetSecurityDescriptorBinaryForm(bytes,AccessControlSections.Access|AccessControlSections.Owner|AccessControlSections.Group);return security;
        }finally{if(descriptor!=IntPtr.Zero)LocalFree(descriptor);CloseHandle(handle);}
    }
    static void Set(string file,bool directory,FileSystemSecurity security) {
        IntPtr handle=CreateFile(Long(file),0x00040000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
        if(handle==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
        var bytes=Bytes(security);var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
        try {bool present,defaulted;IntPtr dacl;if(!GetSecurityDescriptorDacl(pin.AddrOfPinnedObject(),out present,out dacl,out defaulted)||!present)throw new InvalidOperationException("control_dacl_required");uint error=SetSecurityInfo(handle,1,4|(security.AreAccessRulesProtected?0x80000000u:0x20000000u),IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero);if(error!=0)throw new Win32Exception((int)error);}finally{pin.Free();CloseHandle(handle);}
    }
    static byte[] Bytes(FileSystemSecurity security) {return security.GetSecurityDescriptorBinaryForm();}
    static uint Granted(byte[] descriptor) {
        using(var identity=WindowsIdentity.GetCurrent()) {
            IntPtr token;
            if(!DuplicateToken(identity.Token,2,out token))throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                var mapping=new GenericMapping {Read=0x120089,Write=0x120116,Execute=0x1200a0,All=0x1f01ff};
                uint size=65536,granted;bool allowed;IntPtr buffer=Marshal.AllocHGlobal((int)size);
                try {if(!AccessCheck(descriptor,token,0x02000000,ref mapping,buffer,ref size,out granted,out allowed))throw new Win32Exception(Marshal.GetLastWin32Error());if(!allowed)throw new InvalidOperationException("control_read_access_denied");return granted;}finally{Marshal.FreeHGlobal(buffer);}
            }finally{CloseHandle(token);}
        }
    }
    public static bool HasMutation(string sddl) {var descriptor=new RawSecurityDescriptor(sddl);var bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);return (Granted(bytes)&Mutation)!=0;}
    static List<KeyValuePair<string,uint>> Inventory(string[] input) {
        if(input==null||input.Length==0||input.Length>12)throw new InvalidOperationException("bounded_control_roots_required");
        var roots=input.Select(Full).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        foreach(var root in roots) {if(root.Length<4||!Resolve(root).Equals(root,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("regular_absolute_control_root_required");}
        var controls=new Dictionary<string,uint>(StringComparer.OrdinalIgnoreCase);
        var queue=new Queue<string>(roots);
        while(queue.Count>0) {
            var file=queue.Dequeue();if(controls.ContainsKey(file))continue;
            var attributes=File.GetAttributes(Long(file));
            controls.Add(file,Mutation);if(controls.Count>MaxEntries)throw new InvalidOperationException("control_inventory_limit");
            if((attributes&FileAttributes.ReparsePoint)!=0) {
                var target=Resolve(file);
                if(!roots.Any(root=>Within(target,root)))throw new InvalidOperationException("control_link_target_outside_readonly_roots");
                queue.Enqueue(target);continue;
            }
            if((attributes&FileAttributes.Directory)!=0)foreach(var child in Directory.EnumerateFileSystemEntries(Long(file)))queue.Enqueue(Full(child.StartsWith(@"\\?\",StringComparison.Ordinal)?child.Substring(4):child));
        }
        foreach(var root in roots) {
            var parent=System.IO.Path.GetDirectoryName(root);
            while(!String.IsNullOrEmpty(parent)) {
                parent=Full(parent);if(parent.Length==2)parent+="\\";
                if(!Resolve(parent).TrimEnd('\\').Equals(parent.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("control_ancestor_redirected");
                if(!controls.ContainsKey(parent))controls.Add(parent,AncestorMutation);
                parent=System.IO.Path.GetDirectoryName(parent);
            }
        }
        return controls.OrderBy(x=>x.Key.Length).ThenBy(x=>x.Key,StringComparer.OrdinalIgnoreCase).ToList();
    }
    public static int Protect(string[] roots,string sid,string backup) {
        var inventory=Inventory(roots);var identity=new SecurityIdentifier(sid);
        JournalEntries=0;
        using(var stream=new FileStream(backup,FileMode.CreateNew,FileAccess.Write,FileShare.Read))using(var writer=new BinaryWriter(stream)) {
            writer.Write("native-readonly-acl@1");writer.Flush();
            foreach(var item in inventory) {
                var directory=(File.GetAttributes(Long(item.Key))&FileAttributes.Directory)!=0;
                var acl=Security(item.Key,directory);var original=Bytes(acl);
                // System ancestors (e.g. TrustedInstaller-owned Program Files)
                // often already deny ordinary mutation and aren't admin-writable.
                // Never take ownership or enable restore privilege. Leave those
                // alone; the REAL ordinary-token Verify still checks them all.
                if(item.Value==AncestorMutation&&(Granted(original)&0x00040000)==0)continue;
                writer.Write(item.Key);writer.Write(directory);writer.Write(original.Length);writer.Write(original);writer.Flush();stream.Flush(true);
                JournalEntries++;
                // Explicit on EVERY object: an inherited deny can lose to an
                // explicit group allow on a descendant. Preserve all other SIDs.
                acl.AddAccessRule(new FileSystemAccessRule(identity,FileSystemRights.ReadAndExecute,AccessControlType.Allow));
                acl.AddAccessRule(new FileSystemAccessRule(identity,(FileSystemRights)item.Value,AccessControlType.Deny));
                Set(item.Key,directory,acl);
            }
        }
        return inventory.Count;
    }
    public static int Verify(string[] roots) {
        var inventory=Inventory(roots);
        foreach(var item in inventory) {
            var directory=(File.GetAttributes(Long(item.Key))&FileAttributes.Directory)!=0;
            uint granted=Granted(Bytes(Security(item.Key,directory)));
            if((granted&item.Value)!=0)throw new InvalidOperationException("effective_control_write_access_remains");
            if(item.Value==Mutation&&(granted&0x120089)!=0x120089)throw new InvalidOperationException("effective_control_read_access_missing");
        }
        return inventory.Count;
    }
    public static int Restore(string backup) {
        var saved=new List<Saved>();
        using(var reader=new BinaryReader(new FileStream(backup,FileMode.Open,FileAccess.Read,FileShare.Read))) {
            if(reader.ReadString()!="native-readonly-acl@1")throw new InvalidOperationException("readonly_backup_invalid");
            while(reader.BaseStream.Position<reader.BaseStream.Length) {
                var item=new Saved();
                // A partially written final record preceded no ACL mutation.
                try {item.Path=reader.ReadString();item.Directory=reader.ReadBoolean();int size=reader.ReadInt32();if(size<20||size>1048576)throw new InvalidOperationException("readonly_backup_invalid");item.Descriptor=reader.ReadBytes(size);if(item.Descriptor.Length!=size)break;}catch(EndOfStreamException){break;}
                if(item.Path.Length>32768||saved.Count>=MaxEntries+512)throw new InvalidOperationException("readonly_backup_invalid");saved.Add(item);
            }
        }
        bool okay=true;
        for(int index=saved.Count-1;index>=0;index--) {var item=saved[index];try {var acl=Security(item.Path,item.Directory);acl.SetSecurityDescriptorBinaryForm(item.Descriptor,AccessControlSections.Access);Set(item.Path,item.Directory,acl);}catch{okay=false;}}
        if(!okay)throw new InvalidOperationException("readonly_acl_restore_incomplete");
        return saved.Count;
    }
}
'@
}

function Assert-DisposableReadonlyAclHost {
    if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or $env:GITHUB_RUN_ATTEMPT -cne '1' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch') { throw 'readonly_acl_requires_original_disposable_host' }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'readonly_acl_parent_must_be_disposable_administrator' }
}
