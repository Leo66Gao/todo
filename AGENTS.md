# Working on this app

The user wants completed app changes backed up to the private GitHub origin.

- Work in this repository. Read `README.md` before making changes.
- Before starting, inspect git status and fetch origin when available. Preserve other agents' and the user's uncommitted work. Never reset or force-push to resolve conflicts.
- After each completed logical change, run relevant checks, review the diff, stage only the intended files, commit, and push to the current branch on origin before reporting completion. This is standing user authorization to push app changes. If working on a feature branch, push that branch and report it; do not merge without authorization.
- Do not promise GitHub is updated unless the push succeeds. Report authentication, network, or conflict blockers clearly.
- Keep the repository private. Never commit signing keys, signing passwords, OAuth tokens, service-account credentials, environment files, personal workspace data, build outputs, or ignored Firebase configuration files. Do not force-add ignored files.
- On every new clone, run `git config core.hooksPath .githooks` and install `gitleaks` (on macOS: `brew install gitleaks`). The pre-commit hook scans staged content; it must not be bypassed.
- File saves alone do not sync to GitHub. Commit and push completed changes, including documentation/configuration changes. Do not install a blind file-watcher that uploads unreviewed files.
