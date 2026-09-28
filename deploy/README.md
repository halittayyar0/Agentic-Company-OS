# Chromium container security profile

`chromium-seccomp.json` derives from the [Playwright Docker profile](https://github.com/microsoft/playwright/blob/ae935a43d9e376e4759548f6b3c6905c7b282333/utils/docker/seccomp_profile.json), commit `ae935a43d9e376e4759548f6b3c6905c7b282333`. Its upstream SHA-256 is `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.

Copyright Microsoft Corporation. Distributed under Apache-2.0; see [license](./PLAYWRIGHT-LICENSE.txt). Local modifications: JSON formatting and an explicit `clone3` ENOSYS result so modern libc can fall back to `clone` without allowing `clone3`, plus allowing `chroot` inside the new user namespace while all host capabilities remain dropped. Chromium needs this syscall to enter its sandbox; the inherited CAP_SYS_CHROOT condition denied it when Docker dropped all capabilities.

The profile denies unlisted syscalls and allows `clone`, `setns` and `unshare` for Chromium user namespaces, following [Playwright guidance](https://playwright.dev/docs/docker#crawling-and-scraping). Compose and the CI production-profile containers use the same profile. Read-only application files, a non-root user, dropped capabilities and no-new-privileges remain enabled. The profile does not bypass host AppArmor/user-namespace restrictions, provide network isolation, or authorize access to private services.
