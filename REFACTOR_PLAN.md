# REFACTOR_PLAN.md — todo_app

## 1. Discovery Summary

| Item | Finding |
|---|---|
| Framework | **Flutter** (Dart), Material 3, not a JS/Web stack |
| Toolchain | Flutter 3.38.3 / Dart 3.10.1 installed |
| State management | `provider` + `ChangeNotifier` (`TaskProvider`) |
| Persistence | `shared_preferences` — keys `tasks`, `projects`, `tags` (**must not change**) |
| Cloud sync | `google_sign_in` + `googleapis` (Calendar v3) via `lib/services/google_calendar_service.dart` |
| Main file | `lib/main.dart` — **2,407 lines**, single file containing models, state, theme, 4 screens, widgets, dialogs, utilities |
| Test file | `test/widget_test.dart` — default Flutter counter test, **broken** (expects a counter that doesn't exist; fails against real app) |
| Analyzer | 16 issues (deprecations + 1 missing include); no errors |
| Dead code | `lib/lib/services/` (empty dir), `assets/audio/` (empty), unused deps, redundant states |

### Dependencies (from pubspec.yaml)

| Package | Status |
|---|---|
| `shared_preferences ^2.2.0` | Used — update to latest |
| `google_fonts ^5.1.0` | Used — update to latest |
| `intl ^0.18.1` | Used — update to latest (0.20.x; `DateFormat` API stable) |
| `table_calendar ^3.0.9` | Used — update to latest |
| `fl_chart ^0.63.0` | **UNUSED — remove** |
| `uuid ^3.0.7` | Used — update to latest |
| `provider ^6.0.5` | Used — update to latest |
| `flutter_reorderable_list ^1.1.3` | **UNUSED — remove** |
| `flutter_secure_storage ^9.2.4` | **UNUSED — remove** |
| `google_sign_in ^6.2.1` | Used — update to latest |
| `googleapis ^13.1.0` | Used — update to latest (verify breaking API changes) |
| `googleapis_auth ^1.6.0` | Used — update to latest |
| `http` | **Used directly but only transitive** — must be declared explicitly |
| `flutter_lints` | **Missing** — referenced by `analysis_options.yaml` (include_file_not_found warning), not in dev_dependencies — add |

### Critical build blocker
`pubspec.yaml` SDK constraint is `>=2.19.0 <3.0.0`, incompatible with the installed Dart 3.10.1 — a fresh `flutter pub get` **will fail**. Must be relaxed to `>=3.0.0 <4.0.0`.

---

## 2. Files to DELETE

| File / Dir | Reason |
|---|---|
| `lib/lib/services/` (empty dir) | Dead nested structure (accidental duplicate of `lib/services/`) |
| `assets/audio/` (empty dir) | Unused, not referenced by pubspec |
| `test/widget_test.dart` | Broken default counter test; replaced with real tests |

## 3. Files to CREATE (split of `lib/main.dart`)

| File | Contents | Approx. LOC |
|---|---|---|
| `lib/models/task.dart` | `Task`, `SubTask`, `TaskType`, `TaskPriority` — **serialization identical** | ~150 |
| `lib/models/project.dart` | `Project` | ~25 |
| `lib/state/task_provider.dart` | `TaskProvider` (moved verbatim, lightly cleaned) | ~300 |
| `lib/services/storage_service.dart` | NEW wrapper encapsulating SharedPreferences keys/migrations (keys unchanged) | ~60 |
| `lib/utils/time_parser.dart` | `parseTimeFromTitle`, `ParsedTimeResult` | ~40 |
| `lib/utils/task_formatters.dart` | `formatDuration`, `difficultyColor` (moved from TaskCard) | ~20 |
| `lib/theme/app_theme.dart` | `buildAppTheme()` (moved verbatim, deprecations fixed) | ~45 |
| `lib/widgets/task_card.dart` | `TaskCard` | ~160 |
| `lib/widgets/focus_timer_widget.dart` | `FocusTimerWidget` | ~190 |
| `lib/widgets/weekly_strip.dart` | `_buildWeeklyStrip` → `WeeklyDateStrip` | ~65 |
| `lib/screens/dashboard_page.dart` | `DashboardPage` | ~100 |
| `lib/screens/calendar_page.dart` | `CalendarPage` | ~170 |
| `lib/screens/assignments_page.dart` | `AssignmentsPage` | ~105 |
| `lib/screens/settings_page.dart` | `SettingsPage` | ~185 |
| `lib/screens/task_detail_sheet.dart` | `_showTaskDetails` → `TaskDetailSheet` | ~175 |
| `lib/screens/add_task_sheet.dart` | `_showAddTaskDialog` → `AddTaskSheet` | ~420 |
| `lib/main.dart` | **Rewritten** as slim entry: imports, `main()`, `MyApp` | ~60 |
| `test/task_model_test.dart` | Serialization round-trip + legacy-field defaults | ~80 |
| `test/task_provider_test.dart` | Add/edit/delete/toggle/subtask/reorder/persistence logic | ~120 |
| `test/widget_smoke_test.dart` | App boots, FAB opens New Task sheet, nav works | ~60 |
| `REFACTOR_PLAN.md` | This document | — |

## 4. Patterns to REPLACE (behavior-neutral)

1. **God file** → single-responsibility files (see table above).
2. `print(...)` (5 call sites) → `debugPrint` wrapped in `kDebugMode` guard (error-path diagnostics only).
3. `Colors.x.withOpacity(a)` (10 sites) → `Colors.x.withValues(alpha: a)` (identical rendering, removes deprecation).
4. `MaterialStateProperty` / `MaterialState` → `WidgetStateProperty` / `WidgetState` (SegmentedButton styling).
5. `ColorScheme.background` param → `surface` (deprecated since Flutter 3.18).
6. Unnecessary `import 'package:flutter/services.dart'` → removed (fully covered by material.dart).
7. `ColorScheme` + theme constants duplicated inline → centralized in `lib/theme/app_theme.dart` (same values).
8. Dead/duplicated local states:
   - `_pages` `late List<Widget>` field in `_HomePageState` rebuilt every build → computed in `build` (same result).
   - `_durationSliderVal = 30` assigned twice at init → single init expression.
   - `_buildCheckbox` `color: isDone ? transparent : transparent` (both branches identical) → single `Colors.transparent`.
   - Empty `FocusTimerWidget.initState` override → deleted.
9. `.then()`-style async → already `async/await`; keep, wrap unawaited fire-and-forget sync calls (`syncTaskToCalendar`, `removeTaskFromCalendar`) in `unawaited()` from `dart:async`.
10. Repeated `Uuid().v4()` allocations → one module-level `_uuid` instance.
11. Repeated duplicated `Row(Icon(...))` date/time picker tile UI in AddTaskSheet → private `_PickerTile` widget (identical rendering).
12. Redundant `ValueKey(t.id)` on TaskCard inside a `Dismissible` already keyed `Key(t.id)` — keep (harmless, may be relied upon); no change.
13. `GoogleAuthClient` — keep as-is (correct implementation).
14. Missing explicit `http` dependency → declared in pubspec (currently works only by transitive luck).

## 5. Untouched (behavior/visual invariants)

- **All LocalStorage/SharedPreferences key names**: `tasks`, `projects`, `tags` — unchanged; no schema migration needed (defaults identical: 2 seed projects, `['General','Urgent']` tags).
- **All colors, sizes, fonts, shadows, radii, durations, animations** — copied verbatim; only API names change (`withValues` renders identically).
- **Every user flow**: add/edit/delete/swipe-dismiss/long-press-edit/toggle/reorder/focus-timer/±10min/date-strip/calendar dots/assignments progress/subtasks/settings/clear-all.
- **Google Calendar sync semantics**: create/patch/delete on sign-in state, event-ID reuse, auto-remove on complete, 5-min reminders, all-day vs timed events, `_syncError` surfacing.
- **Natural-language time parsing** (`parseTimeFromTitle`) — copied verbatim.
- **`reorderTasks` visible-list algorithm** — copied verbatim.
- Emoji snackbar texts, "Minimal ToDo" title, `HomePage` nav destinations — unchanged.
- Platform folders (`android/`, `ios/`, `web/`, `windows/`, etc.) — untouched.

## 6. a11y additions (invisible to visuals)

- `Semantics(label: 'Mark as done', button: true)` on the checkbox GestureDetector in TaskCard (no visual change).
- `Semantics(label: 'Delete task')` on Dismissible backgrounds.
- `Tooltip` omitted where it would change hover behavior; keyboard accessibility is preserved via existing Material buttons (FAB, icons). GestureDetector-based interactive cards get `Semantics(button: true)` only.

## 7. Error handling (no behavior change)

- Google service already catches and surfaces `lastError`; convert `print` → guarded `debugPrint`, keep `_lastError` contract intact.
- `loadData`/`saveData` get try/catch with a single silent-retry + `syncError`-style notice only where a failure path already exists — **no new UI** (golden rule). Persistence failures currently propagate; keep propagation semantics to avoid changing UX.

## 8. Verification (Step 4)

1. `flutter pub get` — resolves cleanly with updated constraints/deps.
2. `flutter analyze` — **0 issues** (was 16).
3. `flutter test` — new suite green: model round-trip, provider logic, widget smoke (was: 1 broken test).
4. `flutter build apk --debug` (or web) — proves full compile.
5. Manual Regression Checklist (delivered at handover):
   - Add (incl. time-in-title parsing, date/time merge) ✓
   - Edit via long-press ✓ / details sheet ✓
   - Delete via swipe ✓ / subtask delete ✓
   - Toggle complete (pale state, strikethrough, calendar event removal when signed in) ✓
   - Filter: date strip selection, calendar day selection, assignments (not-done, date-sorted) ✓
   - Reorder (checkbox drag) ✓ · Focus timer start/pause/±10 ✓ · Clear All Data ✓

## 9. Dependency upgrade targets

- Remove: `fl_chart`, `flutter_reorderable_list`, `flutter_secure_storage`
- Add: `http`, `flutter_lints` (dev)
- Update: `shared_preferences`, `google_fonts`, `intl`, `table_calendar`, `uuid`, `provider`, `google_sign_in`, `googleapis`, `googleapis_auth` → latest stable compatible versions; audit breaking changes (`googleapis` majors, `intl` 0.20) during integration.
- SDK: `>=3.0.0 <4.0.0`

## 10. Risk register

| Risk | Mitigation |
|---|---|
| `googleapis` major bump breaks Calendar API calls | Pin to latest major that keeps `events.insert/patch/delete` + `EventReminders` API; verify via analyze + build |
| `intl` 0.20 removes/changes `DateFormat` | All formats (`MMMM yyyy`, `EEEE, d`, `MMM d`, `yMMMd`, `Hm`) stable across versions; verified by tests |
| Provider rebuild timing change from `Provider.of` → same calls | Widgets keep `Provider.of`/`Consumer` usage exactly as today |
| Split introduces import-cycle / missing export | All shared widgets imported explicitly; analyzer + compiler verify |
| `table_calendar` minor bump changes marker/gesture internals | Version pinned to latest of same 3.x line; rendering code untouched |

---

*This plan preserves every pixel and every behavior. Any item you disagree with (especially the dependency upgrades or file split layout) can be scoped out before execution begins.*
