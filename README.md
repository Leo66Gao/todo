# todo_app

A personal study workspace — tasks, assignments, milestones, subjects and
notes — with cross-device sync.

## Run

```sh
flutter pub get
flutter run -d chrome --web-port=5000  # web (fixed port for Google OAuth)
flutter run -d macos                  # macOS (needs Xcode; see below)
```

## Sync across devices

Sign in with Google (Settings → ACCOUNT) on each device with the **same
account**. Everything — tasks, assignments, subtasks/milestones, subjects,
notes, folders and task-form preferences — is stored per-account in Firestore
(`todo-sync` database) and streams to every signed-in device. Offline edits
are queued and replayed when the connection returns; deletions win over
stale edits.

If two devices edit the same saved item while apart, sync keeps the newer
cloud item and saves the other version as a visible “conflict copy” for review.
Conflicting workspace preferences are preserved in a note. Deletions still
take precedence over stale edits.

Data created before the first sign-in is offered for import automatically the
first time an account signs in on that device.

## Mac app

The `macos/` target is scaffolded and pre-configured:

- URL scheme for Google Sign-In (reversed client ID from
  `lib/firebase_options.dart`);
- sandbox network entitlements for Firestore/Auth/Storage traffic.

Building it requires full Xcode (`xcode-select --install`, then Xcode from the
App Store) — `flutter run -d macos`. If Google Sign-In is unavailable on a
platform, the app still runs with a local-only workspace.

## Customizing the task form

Settings → Customize tasks: show/hide any field, drag to reorder them
(drag-reorder list), and manage colored labels. Subject management lives on
the Subjects tab, where every subject opens its own workspace (upcoming work,
notes, folders).

## Private GitHub backup

Future coding agents must follow `AGENTS.md`: review, test, commit and push each
completed change. GitHub updates after a successful push, not after every save.
Enable the secret scan on new clones with `git config core.hooksPath .githooks`
and install `gitleaks` before committing.

Firebase configuration and Android release signing files remain local and are
excluded from Git. On another development machine, restore
`lib/firebase_options.dart`, platform `google-services.json` /
`GoogleService-Info.plist` files from your Firebase project configuration, and
restore signing credentials through a secure channel. Never put credentials in
this repository. Local build outputs and scratch files are also excluded.
