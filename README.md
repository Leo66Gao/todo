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
Settings → Account → Sync details shows pending uploads, confirmed cloud
activity, conflict copies, quota retry time, and the separate Calendar queue.

Notes and task notes also keep an account-scoped editor draft on this device
before their save timer runs. Reloading recovers unfinished drafts; an edited
field that changed elsewhere is preserved as a conflict copy. Cmd/Ctrl+S confirms
the device save, while cloud progress remains visible in Sync details. Oversized
note drafts can still be exported before shortening them.

Deleted tasks and notes go to Recently deleted (Settings) for 30 days, as
synced `settings:trash:*` records. Restoring, including Undo, gives the item a
new ID, because the cloud keeps a permanent tombstone for a deleted ID; links
to it (a milestone's parent, note links, note history) move to the new ID.
Settings → Data saves a whole-workspace backup (JSON) and restores one:
existing items return to their backed-up version, deleted ones come back
under new IDs, and nothing made since is removed. The `todo-sync` database is
Firestore Enterprise, which indexes nothing automatically: only the
`updatedAt` index in `firestore.indexes.json` exists, so `payload` is never
indexed.

Confirmations, task editors and Undo actions belong to the account that opened
them and are cancelled on account changes. Google Calendar event edits remain
visible immediately, but requests for the same event run in order; a failed
request rolls back only its own change and preserves later edits.

Data created before the first sign-in is offered for import automatically the
first time an account signs in on that device.

## Customizing the task form

Settings → Customize tasks: show/hide any field, drag to reorder them
(drag-reorder list), and manage colored labels. Subject management lives on
the Subjects tab, where every subject opens its own workspace: a description,
pinned notes, a short "Up next" list of tasks, Materials (links and other
course material) and every note, with folders and search. The description and
materials are stored on the subject record (`description`, `materials`); a
pinned note carries `pinnedAt` and sits at the top of note lists. A material
can be a file path (`path`): Chrome and Edge open it once the file has been
picked on that computer (the handle stays in that browser's IndexedDB, never
synced), showing PDFs, pictures, text and video in the app; other browsers copy
the path to paste into Finder or Explorer. Materials can be searched on the
subject (title, link, path or note) and from ⌘K. A subject can carry an exam
day (`examDate`, "YYYY-MM-DD"): the subject shows a countdown and can add
review sessions spread over the days before it, subject tiles show the
countdown, and Today lists exams in the next two weeks. The retiring
Flutter app drops these fields if it saves the same record.

## Focus timer on the phone

On Android the focus timer also runs outside the app (`FocusTimer.java`,
`FocusTimerPlugin.java`, `FocusTimerReceiver.java`): an ongoing notification
with a live countdown, the round and Pause/Resume and Stop, and an exact alarm
at the end of each round that alerts and moves on to the next one with the app
closed. The app sends the session whenever it changes (`lib/focus.ts`) and
takes back what was done from the notification when it returns.

Settings → Google Calendar → "Calendar alerts for tasks" turns off Google
Calendar's own 5-minute alert on exported task events (`calendarAlerts` in the
synced settings) for anyone relying on the app's reminders.

## Quick add

A new task's title is read for its details (`lib/quickAdd.ts`): a day
("fri", "tomorrow", "12 oct", "due 3/10"), a time or a time range ("18-20",
"6-8pm", "from 4 to 5:30", which also sets the length), a length ("2h",
"45 min"), a subject ("#physics", or its name in passing) and a priority
("!!", "p1", "urgent", "high priority", "asap", or "critical" at the end).
Each recognised phrase shows as a chip that can be dismissed. Moving a timed
task offers to shift the open tasks after it (the domino effect); completed
tasks stay put, and the shift can be undone from its toast.

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
