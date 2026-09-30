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

## Android app

The Android app is the web app in a native shell (Capacitor), in
`webapp/android/`. It keeps the Flutter app's ID (`com.example.todo_app`), so it
installs as an update over it when signed with the same key.

It needs JDK 21 and the Android SDK, plus three local files that stay out of
Git:

- `webapp/android/app/google-services.json` (from the Firebase console),
- `webapp/android/keystore.properties` (`storeFile`, `storePassword`,
  `keyAlias`, `keyPassword`: the key the installed app was signed with),
- `webapp/android/local.properties` (`sdk.dir=…`).

```sh
cd webapp
npm run build && npx cap sync android
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Native pieces live in `webapp/src/lib/native.ts` (sign-in, Google tokens,
system bars, back button, haptics) and in the small plugins next to
`MainActivity.java`.

## Flutter app (retiring)

```sh
flutter pub get
flutter run
```

Flutter creates `build/` and `.dart_tool/` as local build output; they can be
regenerated. The Android app above replaces it.

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

The web app stores records and pending changes atomically in IndexedDB,
migrating the older localStorage cache after the new copy is durable. Competing
offline tab edits are preserved as conflict copies. Firestore quota errors pause
automatic sync (daily quotas until the next Pacific midnight reset), while edits
remain on the device. Oversized records stay local without blocking other uploads.
The `records.updatedAt` index in `firestore.indexes.json` keeps incremental sync
from scanning entire record collections in Firestore Enterprise.

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
