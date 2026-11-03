# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/JNbot-app/JNbot-desktop/security/advisories/new)
or by emailing usserwout@gmail.com. Include steps to reproduce and the affected
version.

You can expect an initial response within a week. Once a fix is released, the
issue will be disclosed in the release notes.

## Scope

Of particular interest:

- Plugin and profile-script signature verification
- Remote access (`jnbot serve --remote-access`, mobile and web clients)
- The cloud relay in `cloud/`
- Anything that leaks Minecraft account tokens or other credentials

Only the latest release is supported.
