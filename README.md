# Todo web app

A personal study workspace — tasks, assignments, milestones, subjects and
notes — with cross-device sync.

## Web app

The web app lives in `webapp/` (Next.js, React, TypeScript, Tailwind CSS and
Motion). It reads and writes the same Firebase records as the Flutter app, so
both stay in sync.

```sh
cd webapp
cp .env.example .env.local   # then fill in the Firebase web config
npm install
npm run dev -- --port 3100
```

`npm test` runs the unit tests (record encoding, dates, time entry, note
text). `npm run build` writes a static site to `webapp/out/`, which Firebase
Hosting serves (`firebase deploy --only hosting`). `.env.local` holds the
Firebase web config and stays out of Git.

Use a port listed in your Google OAuth authorized JavaScript origins when
testing sign-in and Google Calendar. On macOS, AirPlay Receiver may occupy port
5000.

## Mobile app

```sh
flutter pub get
flutter run
```

Flutter creates `build/` and `.dart_tool/` as local build output; they can be
regenerated. The Flutter web build is no longer deployed; `webapp/` replaces
it.

## Sync across devices

Sign in with Google (Settings → Account) on each device with the **same
account**. Everything — tasks, assignments, subtasks/milestones, subjects,
notes, folders and task-form preferences — is stored per-account in Firestore
(`todo-sync` database) and streams to every signed-in device. Offline edits
are queued and replayed when the connection returns; deletions win over
stale edits.

The web app's appearance (Standard or Liquid Glass, Light/Dark/System, and
glass background and effects) is saved on each device, not synced.

If two devices edit the same saved item while apart, sync keeps the newer
cloud item and saves the other version as a visible “conflict copy” for review.
Conflicting workspace preferences are preserved in a note. Deletions still
take precedence over stale edits.

Data created before the first sign-in is offered for import automatically the
first time an account signs in on that device.

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
