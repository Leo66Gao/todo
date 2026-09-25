# Todo — web

The desktop web client for Todo. It shares the Flutter app's Firebase project,
Firestore records (`todo-sync` database) and local-storage format, so the two
apps see the same data.

```sh
cp .env.example .env.local   # fill in the Firebase web config
npm install
npm run dev -- --port 3100
npm test                     # unit tests
npm run build                # static site in out/
```

- `src/lib` — the data model and its Flutter-compatible encoding, sync
  (`cloudSync.ts`) and Google Calendar.
- `src/store/workspace.ts` — workspace state and every edit to it.
- `src/shell` — layout, routing, keyboard shortcuts.
- `src/features` — one folder per screen.
- `src/ui` — shared controls, overlays and motion settings.
