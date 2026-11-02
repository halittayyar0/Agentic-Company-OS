/* Owner-private metadata only. No file contents, subprocesses or privilege changes. */
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#define NTDDI_VERSION 0x0A000004
#include <windows.h>
#include <aclapi.h>
#include <winternl.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#ifndef ACOS_SOURCE_SHA256
#error Build with the reviewed source digest
#endif

typedef NTSTATUS (NTAPI *CREATE_DIRECTORY)(PHANDLE, ACCESS_MASK,
    POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG,
    ULONG, ULONG, PVOID, ULONG);
typedef struct {
    HANDLE token;
    TOKEN_USER *user;
    BYTE system[SECURITY_MAX_SID_SIZE];
    BYTE administrators[SECURITY_MAX_SID_SIZE];
} IDENTITY;

static int emit(HANDLE pipe, const char *text) {
    DWORD written = 0;
    size_t size = strlen(text);
    return size <= MAXDWORD && WriteFile(pipe, text, (DWORD)size, &written, NULL)
        && written == (DWORD)size;
}

static WCHAR *environment(const WCHAR *name) {
    DWORD size = GetEnvironmentVariableW(name, NULL, 0);
    WCHAR *value;
    if (size < 2 || size > 32768) return NULL;
    value = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, (SIZE_T)size * sizeof(WCHAR));
    if (!value) return NULL;
    if (GetEnvironmentVariableW(name, value, size) != size - 1) {
        HeapFree(GetProcessHeap(), 0, value);
        return NULL;
    }
    return value;
}

static int flag(const WCHAR *name, int *value) {
    WCHAR buffer[3];
    DWORD size = GetEnvironmentVariableW(name, buffer, 3);
    if (size != 1 || (buffer[0] != L'0' && buffer[0] != L'1')) return 0;
    *value = buffer[0] == L'1';
    return 1;
}

static int integer(const WCHAR *name, uint64_t *value) {
    WCHAR buffer[24];
    DWORD size = GetEnvironmentVariableW(name, buffer, 24);
    uint64_t number = 0;
    DWORD i;
    if (!size || size > 20 || (size > 1 && buffer[0] == L'0')) return 0;
    for (i = 0; i < size; ++i) {
        unsigned digit;
        if (buffer[i] < L'0' || buffer[i] > L'9') return 0;
        digit = (unsigned)(buffer[i] - L'0');
        if (number > (UINT64_MAX - digit) / 10) return 0;
        number = number * 10 + digit;
    }
    if (!number) return 0;
    *value = number;
    return 1;
}

static int identity(IDENTITY *result) {
    DWORD size = 0;
    DWORD sidSize = SECURITY_MAX_SID_SIZE;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &result->token)) return 0;
    if (GetTokenInformation(result->token, TokenUser, NULL, 0, &size)
        || GetLastError() != ERROR_INSUFFICIENT_BUFFER || size < sizeof(TOKEN_USER) || size > 65536) return 0;
    result->user = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, size);
    if (!result->user || !GetTokenInformation(result->token, TokenUser,
        result->user, size, &size) || !IsValidSid(result->user->User.Sid)) return 0;
    if (!CreateWellKnownSid(WinLocalSystemSid, NULL, result->system, &sidSize)) return 0;
    sidSize = SECURITY_MAX_SID_SIZE;
    return CreateWellKnownSid(WinBuiltinAdministratorsSid, NULL,
        result->administrators, &sidSize) != 0;
}

static int object(HANDLE handle, int directory, BY_HANDLE_FILE_INFORMATION *info) {
    if (GetFileType(handle) != FILE_TYPE_DISK || !GetFileInformationByHandle(handle, info)) return 0;
    return !(info->dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
        && ((info->dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) == directory
        && info->dwVolumeSerialNumber != 0
        && (info->nFileIndexHigh != 0 || info->nFileIndexLow != 0);
}

static uint64_t inode(const BY_HANDLE_FILE_INFORMATION *info) {
    return ((uint64_t)info->nFileIndexHigh << 32) | info->nFileIndexLow;
}

static int same_object(const BY_HANDLE_FILE_INFORMATION *left,
    const BY_HANDLE_FILE_INFORMATION *right) {
    return left->dwVolumeSerialNumber == right->dwVolumeSerialNumber
        && inode(left) == inode(right);
}

static int private_acl(HANDLE handle, int directory, const IDENTITY *who) {
    PSECURITY_DESCRIPTOR descriptor = NULL;
    PSID owner = NULL;
    PACL acl = NULL;
    SECURITY_DESCRIPTOR_CONTROL control;
    DWORD revision = 0;
    ACL_SIZE_INFORMATION size;
    DWORD index;
    int full = 0;
    int accepted = 0;
    GENERIC_MAPPING mapping = {FILE_GENERIC_READ, FILE_GENERIC_WRITE,
        FILE_GENERIC_EXECUTE, FILE_ALL_ACCESS};
    if (GetSecurityInfo(handle, SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &owner, NULL, &acl, NULL, &descriptor) != ERROR_SUCCESS) goto done;
    if (!owner || !IsValidSid(owner) || !EqualSid(owner, who->user->User.Sid)
        || !acl || !IsValidAcl(acl)
        || !GetSecurityDescriptorControl(descriptor, &control, &revision)
        || (directory && !(control & SE_DACL_PROTECTED))
        || !GetAclInformation(acl, &size, sizeof(size), AclSizeInformation)
        || size.AclBytesInUse < sizeof(ACL)) goto done;
    for (index = 0; index < size.AceCount; ++index) {
        ACE_HEADER *header = NULL;
        ACCESS_ALLOWED_ACE *ace;
        SID *sid;
        SIZE_T offset = offsetof(ACCESS_ALLOWED_ACE, SidStart);
        DWORD rights;
        if (!GetAce(acl, index, (LPVOID *)&header) || !header
            || (BYTE *)header < (BYTE *)acl
            || (SIZE_T)((BYTE *)header - (BYTE *)acl) > size.AclBytesInUse - sizeof(ACE_HEADER)
            || header->AceSize > size.AclBytesInUse - (DWORD)((BYTE *)header - (BYTE *)acl)
            || header->AceSize < offset + offsetof(SID, SubAuthority)
            || header->AceType != ACCESS_ALLOWED_ACE_TYPE
            || (header->AceFlags & ~(OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
                | NO_PROPAGATE_INHERIT_ACE | INHERIT_ONLY_ACE | INHERITED_ACE))) goto done;
        ace = (ACCESS_ALLOWED_ACE *)header;
        sid = (SID *)&ace->SidStart;
        if (sid->SubAuthorityCount > SID_MAX_SUB_AUTHORITIES
            || GetSidLengthRequired(sid->SubAuthorityCount) > header->AceSize - offset
            || !IsValidSid(sid)
            || (!EqualSid(sid, who->user->User.Sid) && !EqualSid(sid, (PSID)who->system))) goto done;
        rights = ace->Mask;
        MapGenericMask(&rights, &mapping);
        if (EqualSid(sid, who->user->User.Sid) && !(header->AceFlags & INHERIT_ONLY_ACE)
            && (rights & FILE_ALL_ACCESS) == FILE_ALL_ACCESS) full = 1;
    }
    accepted = full;
done:
    if (descriptor) LocalFree(descriptor);
    return accepted;
}

static PACL new_acl(const IDENTITY *who, int directory) {
    EXPLICIT_ACCESSW rules[2];
    PACL acl = NULL;
    ZeroMemory(rules, sizeof(rules));
    rules[0].grfAccessPermissions = FILE_ALL_ACCESS;
    rules[0].grfAccessMode = SET_ACCESS;
    rules[0].grfInheritance = directory ? SUB_CONTAINERS_AND_OBJECTS_INHERIT : NO_INHERITANCE;
    BuildTrusteeWithSidW(&rules[0].Trustee, who->user->User.Sid);
    rules[1] = rules[0];
    BuildTrusteeWithSidW(&rules[1].Trustee, (PSID)who->system);
    if (SetEntriesInAclW(2, rules, NULL, &acl) != ERROR_SUCCESS) return NULL;
    return acl;
}

static int empty_directory(HANDLE handle) {
    const DWORD capacity = 16384;
    BYTE *buffer = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, capacity);
    unsigned batch;
    int empty = 0;
    if (!buffer) return 0;
    for (batch = 0; batch < 3; ++batch) {
        FILE_ID_BOTH_DIR_INFO *entry;
        SIZE_T offset = 0;
        if (!GetFileInformationByHandleEx(handle,
            batch ? FileIdBothDirectoryInfo : FileIdBothDirectoryRestartInfo, buffer, capacity)) {
            empty = GetLastError() == ERROR_NO_MORE_FILES;
            goto done;
        }
        for (;;) {
            if (offset > capacity - offsetof(FILE_ID_BOTH_DIR_INFO, FileName)) goto done;
            entry = (FILE_ID_BOTH_DIR_INFO *)(buffer + offset);
            if (entry->FileNameLength > capacity - offset - offsetof(FILE_ID_BOTH_DIR_INFO, FileName)) goto done;
            if (!((entry->FileNameLength == 2 && entry->FileName[0] == L'.')
                || (entry->FileNameLength == 4 && entry->FileName[0] == L'.' && entry->FileName[1] == L'.'))) goto done;
            if (!entry->NextEntryOffset) break;
            if (entry->NextEntryOffset < offsetof(FILE_ID_BOTH_DIR_INFO, FileName)
                || entry->NextEntryOffset > capacity - offset) goto done;
            offset += entry->NextEntryOffset;
        }
    }
done:
    HeapFree(GetProcessHeap(), 0, buffer);
    return empty;
}

static WCHAR *extended(const WCHAR *path) {
    SIZE_T length = wcslen(path);
    WCHAR *result;
    SIZE_T prefix;
    const WCHAR *body;
    if (!length || length > 32750 || wcschr(path, L'/')) return NULL;
    if (wcsncmp(path, L"\\\\?\\", 4) == 0) {
        int drive = length > 7 && path[5] == L':' && path[6] == L'\\'
            && ((path[4] >= L'A' && path[4] <= L'Z') || (path[4] >= L'a' && path[4] <= L'z'));
        int unc = length > 8 && CompareStringOrdinal(path + 4, 4, L"UNC\\", 4, TRUE) == CSTR_EQUAL;
        if (!drive && !unc) return NULL;
        prefix = 0; body = path;
    }
    else if (length > 3 && path[1] == L':' && path[2] == L'\\'
        && ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z'))) {
        prefix = 4; body = path;
    } else if (length > 5 && path[0] == L'\\' && path[1] == L'\\' && path[2] != L'.') {
        prefix = 8; body = path + 2;
    } else return NULL;
    result = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, (length + prefix + 1) * sizeof(WCHAR));
    if (!result) return NULL;
    if (prefix == 4) wcscpy_s(result, length + prefix + 1, L"\\\\?\\");
    else if (prefix == 8) wcscpy_s(result, length + prefix + 1, L"\\\\?\\UNC\\");
    wcscat_s(result, length + prefix + 1, body);
    return result;
}

static int canonical_parent(HANDLE handle, WCHAR *expected) {
    WCHAR *actual = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, 32768 * sizeof(WCHAR));
    DWORD length;
    SIZE_T expectedLength = wcslen(expected);
    int same = 0;
    if (!actual) return 0;
    length = GetFinalPathNameByHandleW(handle, actual, 32768, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!length || length >= 32768) goto done;
    while (length > 7 && actual[length - 1] == L'\\') actual[--length] = 0;
    while (expectedLength > 7 && expected[expectedLength - 1] == L'\\') expected[--expectedLength] = 0;
    same = CompareStringOrdinal(actual, -1, expected, -1, TRUE) == CSTR_EQUAL;
done:
    HeapFree(GetProcessHeap(), 0, actual);
    return same;
}

static HANDLE open_object(const WCHAR *path, DWORD access, int pinned) {
    HANDLE value = CreateFileW(path, access, FILE_SHARE_READ | FILE_SHARE_WRITE
        | (pinned ? 0 : FILE_SHARE_DELETE), NULL, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    return value ? value : INVALID_HANDLE_VALUE;
}

static int acknowledge_creation(HANDLE handle, const char *receipt) {
    BYTE input[8] = {0};
    DWORD length = 0;
    /* FILE_DISPOSITION_ON_CLOSE, MS-FSCC FileDispositionInformationEx. Some
       desktop SDK headers expose the structure without the driver macro. */
    FILE_DISPOSITION_INFO_EX commit = {0x00000008UL};
    if (!emit(GetStdHandle(STD_ERROR_HANDLE), "ACOS_PRIVATE_STORAGE_CREATED ")
        || !emit(GetStdHandle(STD_ERROR_HANDLE), receipt)
        || !emit(GetStdHandle(STD_ERROR_HANDLE), "\n")) return 0;
    while (length < sizeof(input)) {
        DWORD read = 0;
        if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), input + length,
            (DWORD)sizeof(input) - length, &read, NULL)) {
            if (GetLastError() == ERROR_BROKEN_PIPE) break;
            return 0;
        }
        if (!read) break;
        if (read > sizeof(input) - length) return 0;
        length += read;
    }
    if (length != 7 || memcmp(input, "COMMIT\n", 7) != 0 || !empty_directory(handle)) return 0;
    /* The parent has recorded the identity before ACK. Before this point an
       abrupt death closes the provisional delete-on-close handle safely. */
    return SetFileInformationByHandle(handle, FileDispositionInfoEx, &commit, sizeof(commit)) != 0;
}

static int initialize_directory(WCHAR *target, int exclusive, const IDENTITY *who) {
    HANDLE handle = INVALID_HANDLE_VALUE, parent = INVALID_HANDLE_VALUE;
    WCHAR *leaf, *parentPath = NULL;
    BY_HANDLE_FILE_INFORMATION info, parentInfo;
    SECURITY_DESCRIPTOR descriptor;
    PACL acl = NULL;
    UNICODE_STRING name;
    OBJECT_ATTRIBUTES attributes;
    IO_STATUS_BLOCK statusBlock;
    CREATE_DIRECTORY create;
    HMODULE nativeModule;
    NTSTATUS status;
    int created = 0, result = 1;
    char output[192];
    if (!exclusive) {
        handle = open_object(target, READ_CONTROL | FILE_READ_ATTRIBUTES, 0);
        if (handle != INVALID_HANDLE_VALUE) goto inspect;
        if (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND) goto done;
    }
    leaf = wcsrchr(target, L'\\');
    if (!leaf || !leaf[1] || wcscmp(leaf + 1, L".") == 0 || wcscmp(leaf + 1, L"..") == 0
        || wcschr(leaf + 1, L':') || wcslen(leaf + 1) > 255) goto done;
    parentPath = _wcsdup(target);
    if (!parentPath) goto done;
    parentPath[(leaf - target == 6 && target[5] == L':') ? 7 : leaf - target] = 0;
    parent = open_object(parentPath, FILE_ADD_SUBDIRECTORY | FILE_LIST_DIRECTORY
        | READ_CONTROL | FILE_READ_ATTRIBUTES, 1);
    if (parent == INVALID_HANDLE_VALUE || !object(parent, 1, &parentInfo)
        || !canonical_parent(parent, parentPath)) goto done;
    acl = new_acl(who, 1);
    if (!acl || !InitializeSecurityDescriptor(&descriptor, SECURITY_DESCRIPTOR_REVISION)
        || !SetSecurityDescriptorOwner(&descriptor, who->user->User.Sid, FALSE)
        || !SetSecurityDescriptorDacl(&descriptor, TRUE, acl, FALSE)
        || !SetSecurityDescriptorControl(&descriptor, SE_DACL_PROTECTED, SE_DACL_PROTECTED)) goto done;
    ZeroMemory(&attributes, sizeof(attributes));
    ZeroMemory(&statusBlock, sizeof(statusBlock));
    name.Buffer = leaf + 1;
    name.Length = (USHORT)(wcslen(leaf + 1) * sizeof(WCHAR));
    name.MaximumLength = name.Length;
    attributes.Length = sizeof(attributes);
    attributes.RootDirectory = parent;
    attributes.ObjectName = &name;
    attributes.Attributes = 0x40; /* OBJ_CASE_INSENSITIVE; no undocumented parsing flags. */
    attributes.SecurityDescriptor = &descriptor;
    nativeModule = GetModuleHandleW(L"ntdll.dll");
    if (!nativeModule) goto done;
    create = (CREATE_DIRECTORY)GetProcAddress(nativeModule, "NtCreateFile");
    if (!create) goto done;
    status = create(&handle, READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY
        | SYNCHRONIZE | DELETE, &attributes, &statusBlock, NULL, FILE_ATTRIBUTE_DIRECTORY,
        FILE_SHARE_READ | FILE_SHARE_WRITE, 2 /* FILE_CREATE */,
        1 /* FILE_DIRECTORY_FILE */ | 0x20 /* FILE_SYNCHRONOUS_IO_NONALERT */
            | 0x1000 /* FILE_DELETE_ON_CLOSE until parent acknowledges identity */
            | 0x200000 /* FILE_OPEN_REPARSE_POINT; never follow an existing leaf */, NULL, 0);
    if (status == (NTSTATUS)0xC0000035L) {
        handle = INVALID_HANDLE_VALUE;
        if (exclusive) { result = 17; goto done; }
        handle = open_object(target, READ_CONTROL | FILE_READ_ATTRIBUTES, 0);
        if (handle == INVALID_HANDLE_VALUE) goto done;
    } else if (status < 0) { handle = INVALID_HANDLE_VALUE; goto done; }
    else {
        if (statusBlock.Information != 2 /* FILE_CREATED */) goto done;
        created = 1;
        if (!empty_directory(handle)) goto done;
    }
inspect:
    if (!object(handle, 1, &info) || !canonical_parent(handle, target)
        || !private_acl(handle, 1, who)) goto done;
    if (_snprintf_s(output, sizeof(output), _TRUNCATE,
        "{\"protocol\":1,\"created\":%s,\"device\":\"%lu\",\"inode\":\"%llu\"}",
        created ? "true" : "false", (unsigned long)info.dwVolumeSerialNumber,
        (unsigned long long)inode(&info)) < 0) goto done;
    if (created && !acknowledge_creation(handle, output)) goto done;
    if (!emit(GetStdHandle(STD_OUTPUT_HANDLE), output)) goto done;
    result = 0;
done:
    if (result && created && handle && handle != INVALID_HANDLE_VALUE && empty_directory(handle)) {
        FILE_DISPOSITION_INFO remove = {TRUE};
        /* Only the still-open object returned by FILE_CREATE; never recurse. */
        SetFileInformationByHandle(handle, FileDispositionInfo, &remove, sizeof(remove));
    }
    if (handle && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    if (parent && parent != INVALID_HANDLE_VALUE) CloseHandle(parent);
    if (acl) LocalFree(acl);
    if (parentPath) free(parentPath);
    return result;
}

static int check(WCHAR *target, int directory, int create, const IDENTITY *who) {
    HANDLE handle = INVALID_HANDLE_VALUE, ownerHandle = INVALID_HANDLE_VALUE;
    BY_HANDLE_FILE_INFORMATION info, reopened;
    PSECURITY_DESCRIPTOR descriptor = NULL;
    PSID owner = NULL;
    PACL acl = NULL;
    LARGE_INTEGER size;
    uint64_t expectedDevice, expectedInode;
    SECURITY_INFORMATION changes = DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
    int changeOwner = 0, result = 1;
    BOOL administrator = FALSE;
    if (!integer(L"ACOS_PRIVATE_STORAGE_DEVICE", &expectedDevice)
        || !integer(L"ACOS_PRIVATE_STORAGE_INODE", &expectedInode) || (create && directory)) goto done;
    handle = open_object(target, READ_CONTROL | FILE_READ_ATTRIBUTES | (create ? WRITE_DAC : 0), create);
    if (handle == INVALID_HANDLE_VALUE || !object(handle, directory, &info)
        || !canonical_parent(handle, target)
        || info.dwVolumeSerialNumber != expectedDevice || inode(&info) != expectedInode) goto done;
    if (create) {
        if (!GetFileSizeEx(handle, &size) || size.QuadPart != 0
            || GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION,
                &owner, NULL, NULL, NULL, &descriptor) != ERROR_SUCCESS || !owner || !IsValidSid(owner)) goto done;
        if (!EqualSid(owner, who->user->User.Sid)) {
            if (!EqualSid(owner, (PSID)who->administrators)
                || !CheckTokenMembership(NULL, (PSID)who->administrators, &administrator) || !administrator) goto done;
            ownerHandle = open_object(target, READ_CONTROL | FILE_READ_ATTRIBUTES | WRITE_DAC | WRITE_OWNER, 1);
            if (ownerHandle == INVALID_HANDLE_VALUE || !object(ownerHandle, 0, &reopened)
                || !canonical_parent(ownerHandle, target)
                || !same_object(&info, &reopened) || !GetFileSizeEx(ownerHandle, &size) || size.QuadPart != 0) goto done;
            changeOwner = 1;
            changes |= OWNER_SECURITY_INFORMATION;
        }
        acl = new_acl(who, 0);
        if (!acl || SetSecurityInfo(changeOwner ? ownerHandle : handle, SE_FILE_OBJECT,
            changes, changeOwner ? who->user->User.Sid : NULL, NULL, acl, NULL) != ERROR_SUCCESS) goto done;
    }
    if (!private_acl(handle, directory, who) || !object(handle, directory, &reopened)
        || !same_object(&info, &reopened) || !emit(GetStdHandle(STD_OUTPUT_HANDLE), "PRIVATE_OK")) goto done;
    result = 0;
done:
    if (descriptor) LocalFree(descriptor);
    if (acl) LocalFree(acl);
    if (ownerHandle && ownerHandle != INVALID_HANDLE_VALUE) CloseHandle(ownerHandle);
    if (handle && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    return result;
}

int wmain(int argc, WCHAR **argv) {
    IDENTITY who = {0};
    WCHAR *input = NULL, *target = NULL;
    int result = 1, directory, create, exclusive;
    BOOL administrator = FALSE;
    if (!emit(GetStdHandle(STD_ERROR_HANDLE), "ACOS_PRIVATE_STORAGE_STARTED")) goto done;
    if (argc != 2) goto done;
    if (wcscmp(argv[1], L"--build-info") == 0) {
        result = emit(GetStdHandle(STD_OUTPUT_HANDLE),
            "{\"protocol\":1,\"target\":\"win32-x64\",\"sourceSha256\":\"" ACOS_SOURCE_SHA256 "\"}") ? 0 : 1;
        goto done;
    }
    if (!identity(&who)) goto done;
    if (wcscmp(argv[1], L"--token-role") == 0) {
        if (!CheckTokenMembership(NULL, who.administrators, &administrator)) goto done;
        result = emit(GetStdHandle(STD_OUTPUT_HANDLE), administrator ? "administrator" : "ordinary") ? 0 : 1;
        goto done;
    }
    input = environment(L"ACOS_PRIVATE_STORAGE_TARGET");
    if (!input || !(target = extended(input))) goto done;
    if (wcscmp(argv[1], L"--initialize-directory") == 0) {
        if (!flag(L"ACOS_PRIVATE_STORAGE_EXCLUSIVE", &exclusive)) goto done;
        result = initialize_directory(target, exclusive, &who);
    } else if (wcscmp(argv[1], L"--check") == 0) {
        if (!flag(L"ACOS_PRIVATE_STORAGE_DIRECTORY", &directory)
            || !flag(L"ACOS_PRIVATE_STORAGE_CREATE", &create)) goto done;
        result = check(target, directory, create, &who);
    }
done:
    if (target) HeapFree(GetProcessHeap(), 0, target);
    if (input) HeapFree(GetProcessHeap(), 0, input);
    if (who.user) HeapFree(GetProcessHeap(), 0, who.user);
    if (who.token) CloseHandle(who.token);
    if (result) emit(GetStdHandle(STD_ERROR_HANDLE), "PRIVATE_STORAGE_FAILED");
    return result;
}
