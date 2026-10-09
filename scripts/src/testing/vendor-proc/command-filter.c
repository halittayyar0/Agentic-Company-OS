/* Nonrelease x86_64 command-stage experiment. Source is distributed with the
 * matching LGPL-2.0-or-later Bubblewrap source and fixed build instructions. */
#if !defined(__x86_64__) || defined(__ILP32__)
#error "ACOS command filter requires native x86_64 Linux"
#endif
#include <stddef.h>
#include <linux/audit.h>
#include <sys/syscall.h>

#define ACOS_DENY_SYSCALL(nr) \
  BPF_JUMP (BPF_JMP | BPF_JEQ | BPF_K, (nr), 0, 1), \
  BPF_STMT (BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)

static void
acos_command_filter_apply (void)
{
  const unsigned int namespace_flags = CLONE_NEWUSER | CLONE_NEWNS |
    CLONE_NEWPID | CLONE_NEWNET | CLONE_NEWUTS | CLONE_NEWIPC | CLONE_NEWCGROUP;
  struct sock_filter instructions[] = {
    BPF_STMT (BPF_LD | BPF_W | BPF_ABS, offsetof (struct seccomp_data, arch)),
    BPF_JUMP (BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
    BPF_STMT (BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT (BPF_LD | BPF_W | BPF_ABS, offsetof (struct seccomp_data, nr)),
    /* Reject x32's alternate syscall-number encoding before native matching. */
    BPF_JUMP (BPF_JMP | BPF_JGE | BPF_K, 0x40000000U, 0, 1),
    BPF_STMT (BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
    ACOS_DENY_SYSCALL (__NR_mount),
    ACOS_DENY_SYSCALL (__NR_umount2),
    ACOS_DENY_SYSCALL (__NR_pivot_root),
    ACOS_DENY_SYSCALL (__NR_setns),
    ACOS_DENY_SYSCALL (__NR_unshare),
    ACOS_DENY_SYSCALL (__NR_fsopen),
    ACOS_DENY_SYSCALL (__NR_fsconfig),
    ACOS_DENY_SYSCALL (__NR_fsmount),
    ACOS_DENY_SYSCALL (__NR_fspick),
    ACOS_DENY_SYSCALL (__NR_open_tree),
    ACOS_DENY_SYSCALL (__NR_move_mount),
    ACOS_DENY_SYSCALL (__NR_mount_setattr),
    /* classic BPF cannot inspect clone3's pointed-to flags. libc may fall
     * back to clone, whose namespace flags are inspected below. */
    BPF_JUMP (BPF_JMP | BPF_JEQ | BPF_K, __NR_clone3, 0, 1),
    BPF_STMT (BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
    BPF_JUMP (BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 0, 3),
    BPF_STMT (BPF_LD | BPF_W | BPF_ABS, offsetof (struct seccomp_data, args[0])),
    BPF_JUMP (BPF_JMP | BPF_JSET | BPF_K, namespace_flags, 0, 1),
    BPF_STMT (BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT (BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = {
    .len = sizeof (instructions) / sizeof (instructions[0]),
    .filter = instructions
  };
  if (prctl (PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0)
    die_with_error ("Cannot set command no-new-privileges");
  if (prctl (PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0)
    die_with_error ("Cannot enforce mandatory command syscall restrictions");
}

#undef ACOS_DENY_SYSCALL
