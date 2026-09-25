import 'dart:async';
import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/cloud_sync_service.dart';
import '../utils/note_content.dart';
import '../models/workspace_settings.dart';
import '../models/study_note.dart';
import '../models/subject_folder.dart';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:uuid/uuid.dart';

import '../models/project.dart';
import '../models/subtask.dart';
import '../models/task.dart';
import '../services/google_calendar_service.dart';
import '../services/storage_service.dart';
import 'calendar_outbox.dart';

class TaskProvider extends ChangeNotifier {
  final StorageService _storage = StorageService();
  final GoogleCalendarService _calendarService;
  final _uuid = const Uuid();

  List<Task> _tasks = [];
  List<Project> _projects = [];
  List<String> _tags = [];

  User? _currentUser;
  String? _syncError;

  List<Task> get tasks => [..._tasks, ..._milestones];
  List<Project> get projects => _projects;
  List<String> get tags => _tags;
  User? get currentUser => _currentUser;
  String? get syncError => _syncError;

  CloudSyncService? _cloud;
  StreamSubscription<User?>? _authSubscription;
  Future<void> _authQueue = Future.value();
  Future<void> _localSave = Future.value();
  Map<String, String> _baseline = {};
  Map<String, String> _unreadableRecords = {};
  List<StudyNote> _notes = [];
  List<SubjectFolder> _folders = [];
  WorkspaceSettings _workspaceSettings = WorkspaceSettings();
  List<StudyNote> get notes => List.unmodifiable(_notes);
  List<SubjectFolder> get folders => List.unmodifiable(_folders);
  WorkspaceSettings get workspaceSettings => _workspaceSettings;
  bool _disposed = false;
  bool isLoading = true;
  bool authBusy = false;
  String cloudStatus = 'Local only';
  String? cloudError;
  String? _recordDecodeError;
  bool get cloudAvailable => _cloud != null;
  bool get calendarConnected =>
      _calendarOwnerUid == _currentUser?.uid &&
      _calendarService.currentUserEmail == _currentUser?.email;
  bool _calendarEnabled = false;
  String? _calendarOwnerUid;
  Map<String, Map<String, dynamic>> _calendarOutbox = {};
  Future<void> _calendarQueue = Future.value();
  Future<void> _calendarDisk = Future.value();
  Timer? _calendarRetry;
  bool _importAvailable = false;
  bool get importAvailable => _importAvailable;

  /// Set before handing the browser to Google's OAuth redirect when
  /// connecting Calendar on web, so the connection can be completed on return.
  static const _calendarRedirectKey = 'calendar.connectPending';
  late final Future<void> ready;

  TaskProvider({GoogleCalendarService? calendarService})
      : _calendarService = calendarService ?? GoogleCalendarService() {
    ready = _initialize();
  }

  @visibleForTesting
  void connectCalendarForTesting(User user) {
    _currentUser = user;
    _calendarOwnerUid = user.uid;
    _calendarEnabled = true;
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  Future<void> _initialize() async {
    try {
      await loadData();
      if (Firebase.apps.isNotEmpty) {
        _cloud = CloudSyncService(FirebaseFirestore.instanceFor(
            app: Firebase.app(), databaseId: 'todo-sync'));
        _cloud!.onRecords = (records) {
          final before = {for (final task in _tasks) task.id: task};
          _applyRecords(records);
          _reconcileCalendarChanges(before);
          notifyListeners();
        };
        _cloud!.onStatus = (status, error) {
          cloudStatus = status;
          cloudError = error ?? _recordDecodeError;
          notifyListeners();
        };
        final firstAccount = Completer<void>();
        _authSubscription =
            FirebaseAuth.instance.authStateChanges().listen((user) {
          _authQueue = _authQueue
              .then((_) => _switchAccount(user))
              .catchError((Object error) {
            cloudError = error.toString();
            isLoading = false;
            notifyListeners();
          }).whenComplete(() {
            if (!firstAccount.isCompleted) firstAccount.complete();
          });
        });
        await firstAccount.future;
        // Completes a Calendar connection that returned via OAuth redirect.
        await _resumeCalendarRedirect();
      }
    } catch (error) {
      cloudError = 'Could not load your saved data: $error';
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _switchAccount(User? user) async {
    if (_currentUser?.uid == user?.uid) return;
    isLoading = true;
    notifyListeners();
    await _localSave;
    await _calendarDisk;
    await _cloud!.disconnect();
    _calendarRetry?.cancel();
    _calendarOwnerUid = null;
    _calendarEnabled = false;
    _calendarOutbox = {};
    await _calendarService.clearSession();

    final prefs = await SharedPreferences.getInstance();
    var legacyOwner = prefs.getString('legacyOwner');
    if (user != null && legacyOwner == null) {
      // Freeze the pre-account workspace for the first account to import.
      // Signed-out work created later uses a different key and is never offered
      // to this or any subsequent account.
      await prefs.setString(
          'legacyWorkspace.${user.uid}', jsonEncode(_encodeRecords()));
      await prefs.setString('legacyOwner', user.uid);
      await prefs.remove('activeGuestWorkspace');
      legacyOwner = user.uid;
    }

    _currentUser = null;
    cloudError = null;
    _recordDecodeError = null;
    _tasks = [];
    _projects = [];
    _tags = [];
    _notes = [];
    _folders = [];
    _workspaceSettings = WorkspaceSettings();
    _baseline = {};
    _unreadableRecords = {};
    if (user == null) {
      await loadData();
      cloudStatus = 'Local only';
      _importAvailable = false;
    } else {
      final records = await _cloud!.connect(user.uid);
      _currentUser = user;
      _applyRecords(records);
      await _restoreCalendarForAccount(user);
      _importAvailable = legacyOwner == user.uid &&
          prefs.getBool('legacyImported.${user.uid}') != true;
      if (_importAvailable) unawaited(importLocalData());
    }
    isLoading = false;
    notifyListeners();
  }

  Future<void> signInWithGoogle() async {
    if (_cloud == null || authBusy) return;
    authBusy = true;
    cloudError = null;
    notifyListeners();
    try {
      if (kIsWeb) {
        await FirebaseAuth.instance.signInWithPopup(GoogleAuthProvider());
      } else {
        final account = await GoogleSignIn(scopes: ['email']).signIn();
        if (account != null) {
          final tokens = await account.authentication;
          await FirebaseAuth.instance.signInWithCredential(
              GoogleAuthProvider.credential(
                  idToken: tokens.idToken, accessToken: tokens.accessToken));
        }
      }
    } catch (error) {
      if ((error is FirebaseAuthException && error.code == 'popup-blocked') ||
          error.toString().contains('popup-blocked')) {
        cloudError =
            'Popup blocked by browser. Click the popup icon in your address bar to allow popups, then try again.';
      } else {
        cloudError = 'Sign-in failed: $error';
      }
    } finally {
      authBusy = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    if (authBusy) return;
    authBusy = true;
    notifyListeners();
    try {
      if (calendarConnected) await _calendarService.signOut();
      await FirebaseAuth.instance.signOut();
      if (!kIsWeb) await GoogleSignIn().signOut();
      await _authQueue;
    } catch (error) {
      cloudError = 'Sign-out failed: $error';
    } finally {
      authBusy = false;
      notifyListeners();
    }
  }

  Future<void> connectCalendar() async {
    final user = _currentUser;
    if (user == null || authBusy) return;
    authBusy = true;
    _syncError = null;
    notifyListeners();
    try {
      if (kIsWeb) {
        // Web never opens a popup: browsers block them (and the GIS consent
        // window is a popup too), which left the account impossible to
        // connect. Mark the intent, then hand the whole page to Google's
        // OAuth redirect; [_resumeCalendarRedirect] finishes the job when the
        // browser comes back.
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_calendarRedirectKey, user.uid);
        authBusy = false;
        notifyListeners();
        final provider = GoogleAuthProvider()
          ..addScope(GoogleCalendarService.scopes.single);
        await user.reauthenticateWithRedirect(provider);
        return;
      }
      var email = await _calendarService.authorize(
        interactive: true,
        email: user.email,
        uid: user.uid,
      );
      if (_currentUser?.uid != user.uid) {
        await _calendarService.clearSession();
        return;
      }
      if (email == null) {
        throw StateError(_calendarService.lastError ??
            'Google Calendar permission was not granted.');
      }
      if (email != user.email) {
        await _calendarService.clearSession();
        _syncError = 'Connect the same Google account used for your workspace.';
        return;
      }
      if (!await _calendarService.verifyAccess()) {
        throw StateError(_calendarService.lastError ??
            'Google Calendar could not be reached.');
      }
      _calendarOwnerUid = user.uid;
      _calendarEnabled = true;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('calendar.enabled.${user.uid}', true);
      for (final task in _tasks.where((task) => !task.isDone)) {
        await _storeCalendarAction(user.uid, _upsertAction(user.uid, task));
      }
      _startCalendarRetry();
      await _scheduleCalendarFlush();
    } catch (error) {
      await _calendarService.clearSession();
      if ((error is FirebaseAuthException && error.code == 'popup-blocked') ||
          error.toString().contains('popup-blocked') ||
          error.toString().contains('popup_failed_to_open') ||
          error.toString().contains('Popup blocked by browser')) {
        _syncError =
            'Popup blocked by browser. Click the popup icon in your address bar to allow popups, then try again.';
      } else {
        _syncError = 'Calendar connection failed: $error';
      }
    } finally {
      authBusy = false;
      notifyListeners();
    }
  }

  /// Web: finishes a Calendar connection that came back through the OAuth
  /// redirect flow instead of a popup. Safe to call on every start — it does
  /// nothing unless a connection was left pending.
  Future<void> _resumeCalendarRedirect() async {
    if (!kIsWeb) return;
    final prefs = await SharedPreferences.getInstance();
    final pendingUid = prefs.getString(_calendarRedirectKey);
    if (pendingUid == null) return;
    await prefs.remove(_calendarRedirectKey);
    try {
      final result = await FirebaseAuth.instance.getRedirectResult();
      final credential = result.credential;
      final token =
          credential is OAuthCredential ? credential.accessToken : null;
      final user = result.user;
      final email = user?.email;
      if (token == null || user == null || email == null ||
          user.uid != pendingUid) {
        _syncError = 'Calendar connection was cancelled.';
        return;
      }
      _calendarService.connectWithAccessToken(
          email: email, accessToken: token, uid: user.uid);
      if (!await _calendarService.verifyAccess()) {
        throw StateError(_calendarService.lastError ??
            'Google Calendar could not be reached.');
      }
      _calendarOwnerUid = user.uid;
      _calendarEnabled = true;
      await prefs.setBool('calendar.enabled.${user.uid}', true);
      for (final task in _tasks.where((task) => !task.isDone)) {
        await _storeCalendarAction(user.uid, _upsertAction(user.uid, task));
      }
      _startCalendarRetry();
      await _scheduleCalendarFlush();
    } catch (error) {
      await _calendarService.clearSession();
      _syncError = 'Calendar connection failed: $error';
    } finally {
      notifyListeners();
    }
  }

  Map<String, String> _encodeRecords() => {
        for (final t in _tasks) 'task:${t.id}': jsonEncode(t.toJson()),
        for (final p in _projects) 'project:${p.id}': jsonEncode(p.toJson()),
        for (final n in _notes) 'note:${n.id}': jsonEncode(n.toJson()),
        for (final f in _folders) 'folder:${f.id}': jsonEncode(f.toJson()),
        'settings:workspace': jsonEncode(_workspaceSettings.toJson()),
        'settings:tags': jsonEncode(_tags),
        'settings:order': jsonEncode(_tasks.map((t) => t.id).toList()),
        ..._unreadableRecords,
      };

  void _applyRecords(Map<String, String> records) {
    final tasks = <Task>[];
    final projects = <Project>[];
    final notes = <StudyNote>[];
    final folders = <SubjectFolder>[];
    _unreadableRecords = {};
    for (final entry in records.entries) {
      try {
        final value = jsonDecode(entry.value);
        if (entry.key == 'settings:order' || entry.key == 'settings:tags') {
          List<String>.from(value as List);
        }
        if (entry.key == 'settings:workspace') {
          WorkspaceSettings.fromJson(value);
        }
        if (entry.key.startsWith('task:')) tasks.add(Task.fromJson(value));
        if (entry.key.startsWith('project:'))
          projects.add(Project.fromJson(value));
        if (entry.key.startsWith('note:')) notes.add(StudyNote.fromJson(value));
        if (entry.key.startsWith('folder:'))
          folders.add(SubjectFolder.fromJson(value));
      } catch (_) {
        // Keep the original payload in subsequent saves so a malformed record
        // does not prevent other tasks loading or get accidentally deleted.
        _unreadableRecords[entry.key] = entry.value;
      }
    }
    _recordDecodeError = _unreadableRecords.isEmpty
        ? null
        : '${_unreadableRecords.length} saved records could not be opened. Their data has been preserved.';
    records = Map.of(records)
      ..removeWhere((key, _) => _unreadableRecords.containsKey(key));
    final order = records['settings:order'] == null
        ? <dynamic>[]
        : jsonDecode(records['settings:order']!) as List;
    final rank = {for (var i = 0; i < order.length; i++) order[i]: i};
    tasks.sort((a, b) =>
        (rank[a.id] ?? order.length).compareTo(rank[b.id] ?? order.length));
    _tasks = tasks;
    _projects = projects;
    _notes = notes;
    _folders = folders;
    _tags = records['settings:tags'] == null
        ? ['General', 'Urgent']
        : List<String>.from(jsonDecode(records['settings:tags']!));
    _workspaceSettings = records['settings:workspace'] == null
        ? WorkspaceSettings()
        : WorkspaceSettings.fromJson(
            jsonDecode(records['settings:workspace']!));
    _baseline = _encodeRecords();
  }

  Future<void> importLocalData() async {
    final uid = _currentUser?.uid;
    if (uid == null || !_importAvailable) return;
    try {
      final legacy = await _readMigrationRecords(uid);
      if (_currentUser?.uid != uid) return;
      await _cloud!.importMissing(legacy);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('legacyImported.$uid', true);
      if (_currentUser?.uid == uid) _importAvailable = false;
    } catch (error) {
      // The device copy is untouched — say so plainly so a failed import never
      // reads as data loss, and point at the retry instead of guessing at the
      // cause (permissions, connectivity or otherwise).
      cloudError = 'Local data is safe. Retry the import from Settings: $error';
    }
    notifyListeners();
  }

  Future<Map<String, String>?> _readGuestMap(
      SharedPreferences prefs, String key) async {
    final raw = prefs.get(key);
    if (raw == null) return null;
    try {
      return Map<String, String>.from(jsonDecode(raw as String));
    } catch (_) {
      await prefs.setString('$key.recovery', raw.toString());
      cloudError = 'Damaged device data was backed up for recovery.';
      return null;
    }
  }

  Future<Map<String, String>> _readGuestRecords() async {
    final prefs = await SharedPreferences.getInstance();
    final activeGuest = await _readGuestMap(prefs, 'activeGuestWorkspace');
    if (activeGuest != null) return activeGuest;

    // The old device workspace is only visible before it has been claimed by
    // the first account. Once claimed, signed-out work starts empty and is
    // stored independently under activeGuestWorkspace.
    if (prefs.getString('legacyOwner') != null) return {};
    final guest = await _readGuestMap(prefs, 'guestWorkspace');
    if (guest != null) return guest;
    final tasks = await _storage.loadTasks();
    final projects = await _storage.loadProjects();
    final tags = await _storage.loadTags();
    if (_storage.hadRecovery) {
      cloudError = 'Damaged device data was backed up for recovery.';
    }
    return {
      for (final t in tasks)
        'task:${t.id}': jsonEncode(t.toJson()),
      for (final p in projects)
        'project:${p.id}': jsonEncode(p.toJson()),
      'settings:tags': jsonEncode(tags),
    };
  }

  Future<Map<String, String>> _readMigrationRecords(String uid) async {
    final prefs = await SharedPreferences.getInstance();
    final snapshot = prefs.getString('legacyWorkspace.$uid');
    if (snapshot == null) return {};
    return Map<String, String>.from(jsonDecode(snapshot));
  }

  // Calendar sync is a durable, account-scoped outbox. It serializes API work
  // so Firestore snapshots cannot make two in-flight requests create events.
  String _calendarOutboxKey(String uid) => 'calendar.outbox.$uid';

  String _deterministicEventId(String uid, Task task) {
    final bytes = utf8.encode('$uid:${task.id}:${task.calendarEventRevision}');
    return 'td${bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}';
  }

  Map<String, dynamic> _upsertAction(String uid, Task task) => {
        'operation': 'upsert',
        'taskId': task.id,
        'eventId': task.googleEventId ?? _deterministicEventId(uid, task),
        'revision': task.calendarEventRevision,
        'title': task.title,
        'description': notePlainText(task.notes),
        'startTime': (task.startTime ?? task.date).toIso8601String(),
        'isAllDay': task.startTime == null,
        'durationMinutes': task.startTime != null && task.durationMinutes == 0
            ? 30
            : task.durationMinutes,
      };

  /// Enqueues a delete for every event this task may currently own: the linked
  /// event, the deterministic ID of its current revision (an in-flight export
  /// may still be creating it), and any queued export's target. The matching
  /// upsert slot is cleared first so a completion can never be followed by a
  /// create. Deletes of events that never existed are harmless — Calendar
  /// answers 404/410, which the service treats as success.
  Future<void> _enqueueCalendarDeletion(String uid, Task task) async {
    final pendingUpsert = _calendarOutbox.remove('upsert:${task.id}');
    final eventIds = <String>{
      if (task.googleEventId != null) task.googleEventId!,
      _deterministicEventId(uid, task),
      if (pendingUpsert != null) pendingUpsert['eventId'] as String,
    };
    for (final eventId in eventIds) {
      await _storeCalendarAction(uid, {
        'operation': 'delete',
        'taskId': task.id,
        'eventId': eventId,
        'revision': task.calendarEventRevision,
      });
    }
  }

  bool _hasCalendarExport(Task task) =>
      task.googleEventId != null || hasPendingUpsert(_calendarOutbox, task.id);

  Future<void> _restoreCalendarForAccount(User user) async {
    final prefs = await SharedPreferences.getInstance();
    _calendarOwnerUid = user.uid;
    _calendarEnabled = prefs.getBool('calendar.enabled.${user.uid}') == true;
    final saved = prefs.getString(_calendarOutboxKey(user.uid));
    if (saved != null) {
      try {
        final decoded = jsonDecode(saved) as Map<String, dynamic>;
        // Re-key under canonical slots so outboxes persisted by older builds
        // (keyed by raw task ID, where a reopen could overwrite a pending
        // delete) are migrated and every entry is removable by its key.
        _calendarOutbox = normalizeCalendarOutbox(decoded);
      } catch (_) {
        _calendarOutbox = {};
      }
    }
    if (_calendarEnabled || !kIsWeb) {
      final restoredEmail = await _calendarService.authorize(
        interactive: false,
        email: user.email,
        uid: user.uid,
      );
      if (_currentUser?.uid != user.uid) return;
      if (restoredEmail != null && restoredEmail != user.email) {
        await _calendarService.clearSession();
      } else if (restoredEmail != null &&
          await _calendarService.verifyAccess()) {
        _calendarEnabled = true;
        await prefs.setBool('calendar.enabled.${user.uid}', true);
      } else if (restoredEmail != null) {
        await _calendarService.clearSession();
      }
    }
    if (!_calendarEnabled) return;
    _startCalendarRetry();
    if (calendarConnected) {
      for (final task in _tasks) {
        if (task.isDone && _hasCalendarExport(task)) {
          // Only advance the lifecycle if there isn't already a pending delete
          // for this exact event (deletes are keyed by `delete:<eventId>`).
          final hasPendingDelete =
              _calendarOutbox.containsKey('delete:${task.googleEventId}');
          if (!hasPendingDelete) {
            task.calendarEventRevision++;
            unawaited(saveData());
          }
          await _enqueueCalendarDeletion(user.uid, task);
        } else if (!task.isDone) {
          await _storeCalendarAction(user.uid, _upsertAction(user.uid, task));
        }
      }
      unawaited(_scheduleCalendarFlush());
    }
  }

  void _startCalendarRetry() {
    _calendarRetry?.cancel();
    _calendarRetry = Timer.periodic(const Duration(seconds: 30), (_) {
      unawaited(_keepCalendarAlive());
    });
  }

  Future<void> _keepCalendarAlive() async {
    final user = _currentUser;
    if (user == null || !_calendarEnabled) return;
    if (!calendarConnected) {
      final email = await _calendarService.authorize(
        interactive: false,
        email: user.email,
        uid: user.uid,
      );
      if (_currentUser?.uid != user.uid) return;
      if (email != null && email == user.email) {
        notifyListeners();
      }
    }
    if (calendarConnected) unawaited(_scheduleCalendarFlush());
  }

  Future<void> _persistCalendarOutbox(String uid) async {
    final encoded = jsonEncode(_calendarOutbox);
    final key = _calendarOutboxKey(uid);
    _calendarDisk = _calendarDisk.catchError((Object _) {}).then((_) async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(key, encoded);
    });
    await _calendarDisk;
  }

  Future<void> _storeCalendarAction(
      String uid, Map<String, dynamic> action) async {
    if (_calendarOwnerUid != uid || _currentUser?.uid != uid) return;
    _calendarOutbox[calendarActionKey(action)] = action;
    await _persistCalendarOutbox(uid);
  }

  Future<void> syncTaskToCalendar(Task task) async {
    final uid = _currentUser?.uid;
    if (uid == null || !_calendarEnabled || task.isDone) return;
    final action = _upsertAction(uid, task);
    _calendarOutbox[calendarActionKey(action)] = action;
    await _persistCalendarOutbox(uid);
    if (_calendarOwnerUid != uid || _currentUser?.uid != uid) return;
    _calendarQueue = _calendarQueue.catchError((Object _) {}).then((_) async {
      await _flushCalendarOutbox(uid);
    });
    await _calendarQueue;
  }

  Future<void> removeTaskFromCalendar(Task task) async {
    final uid = _currentUser?.uid;
    if (uid == null || !_calendarEnabled) return;
    await _enqueueCalendarDeletion(uid, task);
    if (_calendarOwnerUid != uid || _currentUser?.uid != uid) return;
    _calendarQueue = _calendarQueue.catchError((Object _) {}).then((_) async {
      await _flushCalendarOutbox(uid);
    });
    await _calendarQueue;
  }

  Future<void> _scheduleCalendarFlush() {
    final uid = _currentUser?.uid;
    if (uid == null) return Future.value();
    _calendarQueue = _calendarQueue.catchError((Object _) {}).then((_) async {
      await _flushCalendarOutbox(uid);
    });
    return _calendarQueue;
  }

  Future<void> _flushCalendarOutbox(String uid) async {
    if (!calendarConnected ||
        _calendarOwnerUid != uid ||
        _currentUser?.uid != uid) return;
    String? firstError;
    for (final action in _calendarOutbox.values.toList()) {
      if (_calendarOwnerUid != uid || _currentUser?.uid != uid) return;
      final taskId = action['taskId'] as String;
      final eventId = action['eventId'] as String;
      var success = false;
      String? resultingId;
      if (action['operation'] == 'delete') {
        success = await _calendarService.deleteEvent(eventId);
      } else {
        final taskIndex = _tasks.indexWhere((task) => task.id == taskId);
        if (taskIndex < 0 || _tasks[taskIndex].isDone) {
          final slotKey = calendarActionKey(action);
          if (identical(_calendarOutbox[slotKey], action) ||
              jsonEncode(_calendarOutbox[slotKey]) == jsonEncode(action)) {
            _calendarOutbox.remove(slotKey);
            await _persistCalendarOutbox(uid);
          }
          continue;
        }
        final currentTask = _tasks[taskIndex];
        final isAllDay =
            action['isAllDay'] as bool? ?? currentTask.startTime == null;
        success = await _calendarService.updateEvent(
          eventId: eventId,
          title: action['title'] as String,
          description: action['description'] as String?,
          startTime: DateTime.parse(action['startTime'] as String),
          durationMinutes: action['durationMinutes'] as int,
          isAllDay: isAllDay,
          taskId: taskId,
          ownerUid: uid,
        );
        if (!success &&
            (_calendarService.lastErrorStatus == 404 ||
                _calendarService.lastErrorStatus == 410)) {
          resultingId = await _calendarService.insertEvent(
            eventId: eventId,
            title: action['title'] as String,
            description: action['description'] as String?,
            startTime: DateTime.parse(action['startTime'] as String),
            durationMinutes: action['durationMinutes'] as int,
            isAllDay: isAllDay,
            taskId: taskId,
            ownerUid: uid,
          );
          success = resultingId != null;
        }
      }
      if (_calendarOwnerUid != uid || _currentUser?.uid != uid) return;
      if (!success) {
        firstError ??=
            _calendarService.lastError ?? 'Calendar sync is waiting to retry.';
        _syncError = firstError;
        notifyListeners();
        // A malformed legacy event must not prevent unrelated tasks from
        // syncing. Authentication, permission, and transient failures still
        // stop the pass so the app does not repeat requests with a bad session.
        if (_calendarService.lastErrorStatus != 400) return;
        continue;
      }
      if (action['operation'] == 'upsert') {
        final index = _tasks.indexWhere((task) => task.id == taskId);
        final id = resultingId ?? eventId;
        final actionRevision = action['revision'] as int?;
        final isStale = index < 0 ||
            _tasks[index].isDone ||
            (actionRevision != null &&
                _tasks[index].calendarEventRevision != actionRevision);
        if (isStale) {
          // The request may have created an event after the task was completed,
          // deleted, or reopened. Keep a delete even if the upsert slot has
          // since been replaced by a newer revision.
          await _storeCalendarAction(uid, {
            'operation': 'delete',
            'taskId': taskId,
            'eventId': id,
            'revision': actionRevision,
          });
        } else {
          if (_tasks[index].googleEventId != id) {
            _tasks[index].googleEventId = id;
            await saveData();
          }
        }
      } else {
        // A delete only clears the linked event if the task has not since been
        // reopened (which bumps the revision, superseding this delete).
        final index = _tasks.indexWhere((task) => task.id == taskId);
        final actionRevision = action['revision'] as int?;
        final superseded = index >= 0 &&
            actionRevision != null &&
            _tasks[index].calendarEventRevision != actionRevision;
        if (index >= 0 &&
            !superseded &&
            _tasks[index].isDone &&
            _tasks[index].googleEventId == eventId) {
          _tasks[index].googleEventId = null;
          await saveData();
        }
      }
      // Remove by the composite slot key (delete:<eventId> / upsert:<taskId>),
      // and only if no newer action replaced this one while it was in flight.
      final slotKey = calendarActionKey(action);
      final current = _calendarOutbox[slotKey];
      if (current != null && jsonEncode(current) == jsonEncode(action)) {
        _calendarOutbox.remove(slotKey);
        await _persistCalendarOutbox(uid);
      }
    }
    if (_calendarOutbox.isNotEmpty && firstError == null) {
      // A stale upsert can enqueue its delete after the pass was snapshotted.
      unawaited(_scheduleCalendarFlush());
    }
    _syncError = firstError;
    notifyListeners();
  }

  void _reconcileCalendarChanges(Map<String, Task> before) {
    final uid = _currentUser?.uid;
    if (uid == null || !_calendarEnabled) return;
    final current = {for (final task in _tasks) task.id: task};
    for (final oldTask in before.values) {
      if (!current.containsKey(oldTask.id)) {
        unawaited(removeTaskFromCalendar(oldTask));
      }
    }
    for (final task in current.values) {
      final old = before[task.id];
      if (task.isDone) {
        if (old?.isDone != true &&
            (task.googleEventId != null ||
                (old != null && _hasCalendarExport(old)))) {
          if (old != null &&
              task.calendarEventRevision == old.calendarEventRevision) {
            task.calendarEventRevision++;
            unawaited(saveData());
          }
          unawaited(removeTaskFromCalendar(task));
        }
      } else if (old == null ||
          jsonEncode(old.toJson()) != jsonEncode(task.toJson())) {
        unawaited(syncTaskToCalendar(task));
      }
    }
  }

  Future<void> loadData() async {
    if (_currentUser != null) return;
    _applyRecords(await _readGuestRecords());
    notifyListeners();
  }

  Future<void> saveData() async {
    final next = _encodeRecords();
    final changes = <String, String?>{
      for (final e in next.entries)
        if (_baseline[e.key] != e.value) e.key: e.value,
      for (final key in _baseline.keys)
        if (!next.containsKey(key)) key: null,
    };
    _baseline = next;
    notifyListeners();
    if (_currentUser != null) {
      try {
        await _cloud!.writeChanges(changes);
      } catch (error) {
        cloudError = 'Could not save changes: $error';
        notifyListeners();
      }
    } else {
      final payload = jsonEncode(next);
      final tasks = _tasks.map((t) => jsonEncode(t.toJson())).toList();
      _localSave = _localSave.catchError((Object _) {}).then((_) async {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('activeGuestWorkspace', payload);
        // Preserve the original tasks key for compatibility with older builds.
        await prefs.setStringList('tasks', tasks);
      });
      await _localSave;
    }
  }

  Future<void> updateWorkspaceSettings(WorkspaceSettings settings) async {
    _workspaceSettings = settings;
    await saveData();
  }

  /// 'system' | 'light' | 'dark' — drives MaterialApp.themeMode.
  Future<void> setThemeMode(String mode) async {
    if (_workspaceSettings.themeMode == mode) return;
    _workspaceSettings = _workspaceSettings.copyWith(themeMode: mode);
    await saveData();
  }

  void addNote(StudyNote note) {
    _notes.add(note);
    unawaited(saveData());
  }

  void updateNote(StudyNote note) {
    final index = _notes.indexWhere((n) => n.id == note.id);
    if (index < 0) return;
    _notes[index] = note;
    unawaited(saveData());
  }

  void deleteNote(String id) {
    _notes.removeWhere((n) => n.id == id);
    unawaited(saveData());
  }

  void addFolder(SubjectFolder folder) {
    _folders.add(folder);
    unawaited(saveData());
  }

  void deleteFolder(String id) {
    _folders.removeWhere((f) => f.id == id);
    for (final note in _notes.where((n) => n.folderId == id)) {
      note.folderId = null;
    }
    unawaited(saveData());
  }

  Future<void> clearWorkspace() async {
    if (_calendarEnabled) {
      for (final task in _tasks) {
        unawaited(removeTaskFromCalendar(task));
      }
    }
    _tasks = [];
    _projects = [];
    _notes = [];
    _folders = [];
    _tags = [];
    _workspaceSettings = WorkspaceSettings();
    await saveData();
  }

  @override
  void dispose() {
    _disposed = true;
    _calendarRetry?.cancel();
    _authSubscription?.cancel();
    _cloud?.disconnect();
    super.dispose();
  }

  Iterable<Task> get _milestones sync* {
    for (final parent in _tasks) {
      for (final sub in parent.subtasks) {
        if (sub.date == null) continue;
        yield Task(
            id: 'milestone:${parent.id}:${sub.id}',
            title: sub.title,
            date: sub.date!,
            isDone: parent.isDone || sub.isDone,
            priority: sub.priority ?? parent.priority,
            difficulty: sub.difficulty ?? parent.difficulty,
            projectId: parent.projectId,
            category: parent.category,
            parentTaskId: parent.id);
      }
    }
  }

  (Task, SubTask)? _milestone(String id) {
    for (final parent in _tasks) {
      for (final sub in parent.subtasks) {
        if (id == 'milestone:${parent.id}:${sub.id}') return (parent, sub);
      }
    }
    return null;
  }

  void scheduleSubtask(String taskId, String subtaskId, DateTime? date) {
    for (final task in _tasks.where((t) => t.id == taskId)) {
      for (final sub in task.subtasks.where((s) => s.id == subtaskId)) {
        sub.date = date;
      }
    }
    unawaited(saveData());
  }

  void addTask(Task task) {
    _tasks.add(task);
    if (_calendarEnabled) {
      unawaited(syncTaskToCalendar(task));
    }
    unawaited(saveData());
  }

  void updateTask(Task task) {
    final milestone = _milestone(task.id);
    if (milestone != null) {
      milestone.$2.title = task.title;
      milestone.$2.date = task.date;
      milestone.$2.isDone = task.isDone;
      unawaited(saveData());
      return;
    }
    final index = _tasks.indexWhere((t) => t.id == task.id);
    if (index != -1) {
      final previous = _tasks[index];
      if (!previous.isDone &&
          task.isDone &&
          _hasCalendarExport(previous) &&
          task.calendarEventRevision == previous.calendarEventRevision) {
        task.calendarEventRevision++;
      }
      _tasks[index] = task;
      if (_calendarEnabled) {
        if (task.isDone) {
          unawaited(removeTaskFromCalendar(task));
        } else {
          unawaited(syncTaskToCalendar(task));
        }
      }
      unawaited(saveData());
    }
  }

  void updateTaskRemainingTime(String taskId, int newRemainingMinutes) {
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index != -1) {
      _tasks[index].remainingMinutes = newRemainingMinutes;

      // Auto-complete if time runs out
      if (newRemainingMinutes <= 0 && !_tasks[index].isDone) {
        _tasks[index].isDone = true;
        if (_hasCalendarExport(_tasks[index])) {
          _tasks[index].calendarEventRevision++;
          if (_calendarEnabled) {
            unawaited(removeTaskFromCalendar(_tasks[index]));
          }
        }
      }
      unawaited(saveData());
    }
  }

  void deleteTask(String id) {
    final milestone = _milestone(id);
    if (milestone != null) {
      deleteSubtask(milestone.$1.id, milestone.$2.id);
      return;
    }
    final taskIndex = _tasks.indexWhere((t) => t.id == id);
    if (taskIndex != -1) {
      final task = _tasks[taskIndex];
      if (_calendarEnabled) {
        unawaited(removeTaskFromCalendar(task));
      }
      _tasks.removeAt(taskIndex);
      unawaited(saveData());
    }
  }

  void toggleTask(String id) {
    final milestone = _milestone(id);
    if (milestone != null) {
      if (!milestone.$1.isDone) toggleSubtask(milestone.$1.id, milestone.$2.id);
      return;
    }
    final index = _tasks.indexWhere((t) => t.id == id);
    if (index != -1) {
      _tasks[index].isDone = !_tasks[index].isDone;
      // Restrained tactile confirmation for completing/undoing work.
      unawaited(HapticFeedback.lightImpact());

      if (_tasks[index].isDone) {
        // A new revision prevents the next uncomplete from reusing a deleted
        // Google event ID, which Calendar retains as a cancellation tombstone.
        if (_hasCalendarExport(_tasks[index])) {
          _tasks[index].calendarEventRevision++;
          if (_calendarEnabled) {
            unawaited(removeTaskFromCalendar(_tasks[index]));
          }
        }
      } else if (_calendarEnabled) {
        // Task unchecked: Add back to calendar
        unawaited(syncTaskToCalendar(_tasks[index]));
      }
      unawaited(saveData());
    }
  }

  // SUBTASK MANAGEMENT

  void addSubtask(String taskId, String subtaskTitle) {
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index != -1) {
      _tasks[index].subtasks = [
        ..._tasks[index].subtasks,
        SubTask(id: _uuid.v4(), title: subtaskTitle),
      ];
      unawaited(saveData());
    }
  }

  /// Adds a fully configured subtask (milestone date, priority, difficulty).
  void addSubtaskFull(String taskId, SubTask subtask) {
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index != -1) {
      _tasks[index].subtasks = [..._tasks[index].subtasks, subtask];
      unawaited(saveData());
    }
  }

  /// Replaces an existing subtask (matched by id) in place.
  void updateSubtask(String taskId, SubTask subtask) {
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index == -1) return;
    final subIndex =
        _tasks[index].subtasks.indexWhere((s) => s.id == subtask.id);
    if (subIndex == -1) return;
    _tasks[index].subtasks[subIndex] = subtask;
    unawaited(saveData());
  }

  void toggleSubtask(String taskId, String subtaskId) {
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index != -1) {
      final sIndex =
          _tasks[index].subtasks.indexWhere((s) => s.id == subtaskId);
      if (sIndex != -1) {
        _tasks[index].subtasks[sIndex].isDone =
            !_tasks[index].subtasks[sIndex].isDone;
        unawaited(saveData());
      }
    }
  }

  void deleteSubtask(String taskId, String subtaskId) {
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index != -1) {
      _tasks[index].subtasks.removeWhere((s) => s.id == subtaskId);
      unawaited(saveData());
    }
  }

  // Drag-to-reschedule: moves a task to another day, keeping its start time.
  void rescheduleTask(String taskId, DateTime newDate) {
    final milestone = _milestone(taskId);
    if (milestone != null) {
      scheduleSubtask(milestone.$1.id, milestone.$2.id, newDate);
      return;
    }
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index == -1) return;

    final task = _tasks[index];
    task.date = DateTime(newDate.year, newDate.month, newDate.day);
    if (task.startTime != null) {
      task.startTime = DateTime(
        newDate.year,
        newDate.month,
        newDate.day,
        task.startTime!.hour,
        task.startTime!.minute,
      );
    }
    updateTask(task); // handles Google Calendar sync + saving
  }

  // Tasks from before [reference] that are still not done.
  List<Task> getOverdueTasks(DateTime reference) {
    final cutoff = DateTime(reference.year, reference.month, reference.day);
    final list =
        tasks.where((t) => !t.isDone && t.date.isBefore(cutoff)).toList();
    list.sort((a, b) => a.date.compareTo(b.date));
    return list;
  }

  // Domino effect: shifts every timed task on [day] that starts after
  // [afterTime] by [delta] (the amount the edited task moved). Everything is
  // passed explicitly from the pre-edit state so it can't depend on stale
  // task lookups.
  void applyDominoShift({
    required String excludeId,
    required DateTime day,
    required DateTime afterTime,
    required Duration delta,
  }) {
    var changed = false;

    for (final other in _tasks) {
      if (other.id == excludeId) continue;
      if (other.startTime == null) continue;
      if (!isSameDay(other.date, day)) continue;
      if (!other.startTime!.isAfter(afterTime)) continue;

      final shifted = other.startTime!.add(delta);
      other.date = DateTime(shifted.year, shifted.month, shifted.day);
      other.startTime = shifted;
      changed = true;
      if (kDebugMode) {
        debugPrint('domino: "${other.title}" -> ${other.startTime}');
      }
      if (_calendarEnabled && other.googleEventId != null) {
        unawaited(syncTaskToCalendar(other));
      }
    }

    if (changed) unawaited(saveData());
  }

  void updateTaskNotes(String taskId, String notes) {
    final index = _tasks.indexWhere((t) => t.id == taskId);
    if (index == -1) return;

    _tasks[index].notes = notes;
    if (_calendarEnabled && _tasks[index].googleEventId != null) {
      unawaited(syncTaskToCalendar(_tasks[index]));
    }
    unawaited(saveData());
  }

  void addProject(Project project) {
    _projects.add(project);
    unawaited(saveData());
  }

  void updateProject(Project project) {
    final index = _projects.indexWhere((p) => p.id == project.id);
    if (index == -1) return;
    _projects[index] = project;
    unawaited(saveData());
  }

  void deleteProject(String id) {
    _projects.removeWhere((p) => p.id == id);

    for (final t in _tasks) {
      if (t.projectId == id) t.projectId = null;
    }
    unawaited(saveData());
  }

  void reorderTasks(int oldIndex, int newIndex, List<Task> visible) {
    if (oldIndex < 0 || oldIndex >= visible.length) return;

    if (newIndex < 0) newIndex = 0;
    if (newIndex > visible.length) newIndex = visible.length;

    final idToMove = visible[oldIndex].id;
    final globalOld = _tasks.indexWhere((t) => t.id == idToMove);

    if (globalOld == -1) return;

    final moving = _tasks.removeAt(globalOld);

    if (newIndex >= visible.length) {
      _tasks.add(moving);
    } else {
      final idAtNewVisible = visible[newIndex].id;
      final globalNew = _tasks.indexWhere((t) => t.id == idAtNewVisible);

      if (globalNew == -1) {
        _tasks.add(moving);
      } else {
        _tasks.insert(globalNew, moving);
      }
    }
    unawaited(saveData());
  }

  List<Task> getTasksForDate(DateTime date) {
    final list = tasks.where((t) => isSameDay(t.date, date)).toList();
    final List<Task> active = [];
    final List<Task> completed = [];
    for (final t in list) {
      if (t.isDone) {
        completed.add(t);
      } else {
        active.add(t);
      }
    }

    // Timed tasks float to the top in chronological order (13:00 above
    // 17:45); untimed tasks keep their manual order below them.
    final timed = active.where((t) => t.startTime != null).toList()
      ..sort((a, b) => a.startTime!.compareTo(b.startTime!));
    final untimed = active.where((t) => t.startTime == null).toList();

    return [...timed, ...untimed, ...completed];
  }

  List<Task> getTasksForProject(String projectId) {
    return tasks.where((t) => t.projectId == projectId).toList();
  }

  List<Task> get assignments {
    return _tasks.where((t) => t.type == TaskType.assignment).toList();
  }
}
