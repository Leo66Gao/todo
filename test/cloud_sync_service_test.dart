import 'dart:convert';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/services/cloud_sync_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));
  Future<void> settle() async {
    for (var i = 0; i < 20; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  test('two devices receive edits and deletion without replacing other tasks',
      () async {
    final db = FakeFirebaseFirestore();
    final a = CloudSyncService(db), b = CloudSyncService(db);
    addTearDown(a.disconnect);
    addTearDown(b.disconnect);
    Map<String, String> view = {};
    b.onRecords = (records) => view = records;
    await a.connect('alice');
    await b.connect('alice');
    await a.writeChanges({'task:a': '{"title":"Essay"}'});
    await settle();
    expect(view['task:a'], contains('Essay'));
    await b.writeChanges({'task:b': '{"title":"Math"}'});
    await settle();
    await a.writeChanges({'task:a': '{"title":"Essay revised"}'});
    await settle();
    expect(view.keys, containsAll(['task:a', 'task:b']));
    await a.writeChanges({'task:a': null});
    await settle();
    expect(view.containsKey('task:a'), false);
    expect(view['task:b'], contains('Math'));
  });
  test('server snapshot removes stale cached records absent from cloud',
      () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
        'cloud.alice',
        jsonEncode({
          'records': {'task:stale': 'old'},
          'pending': <String, String>{},
        }));
    final sync = CloudSyncService(FakeFirebaseFirestore());
    addTearDown(sync.disconnect);
    Map<String, String> view = {};
    sync.onRecords = (records) => view = records;
    await sync.connect('alice');
    await settle();
    expect(view, isEmpty);
  });
  test('writes while disconnected fail instead of silently losing changes',
      () async {
    final sync = CloudSyncService(FakeFirebaseFirestore());
    expect(sync.writeChanges({'task:a': 'saved'}), throwsStateError);
  });
  test('stale edit cannot resurrect a tombstone', () async {
    final db = FakeFirebaseFirestore();
    await db
        .doc('users/alice/records/task:a')
        .set({'kind': 'task', 'payload': '', 'deleted': true});
    final sync = CloudSyncService(db);
    addTearDown(sync.disconnect);
    await sync.connect('alice');
    await sync.writeChanges({'task:a': '{"title":"Stale offline edit"}'});
    await settle();
    expect(
        (await db.doc('users/alice/records/task:a').get()).data()!['deleted'],
        true);
  });
  test(
      'migration is idempotent and preserves existing cloud edits and deletions',
      () async {
    final db = FakeFirebaseFirestore();
    final sync = CloudSyncService(db);
    addTearDown(sync.disconnect);
    await sync.connect('alice');
    await db
        .doc('users/alice/records/task:a')
        .set({'kind': 'task', 'payload': 'newer', 'deleted': false});
    await db
        .doc('users/alice/records/task:b')
        .set({'kind': 'task', 'payload': '', 'deleted': true});
    final legacy = {
      'task:a': 'older',
      'task:b': 'deleted locally stale',
      'task:c': 'import me'
    };
    await sync.importMissing(legacy);
    await sync.importMissing(legacy);
    final docs = await db.collection('users/alice/records').get();
    expect(docs.docs.length, 3);
    expect(
        (await db.doc('users/alice/records/task:a').get()).data()!['payload'],
        'newer');
    expect(
        (await db.doc('users/alice/records/task:b').get()).data()!['deleted'],
        true);
  });
  test('persisted outbox replays only into its original account', () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
        'cloud.alice',
        jsonEncode({
          'records': {'task:a': 'saved'},
          'pending': {'task:a': 'saved'}
        }));
    final db = FakeFirebaseFirestore();
    final sync = CloudSyncService(db);
    addTearDown(sync.disconnect);
    await sync.connect('bob');
    await settle();
    expect((await db.collection('users/bob/records').get()).docs, isEmpty);
    await sync.connect('alice');
    await settle();
    expect(
        (await db.doc('users/alice/records/task:a').get()).data()!['payload'],
        'saved');
    await sync.connect('bob');
    await settle();
    expect((await db.collection('users/bob/records').get()).docs, isEmpty);
  });
  test('damaged cache is backed up and recovered from cloud', () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('cloud.alice', 'broken json');
    final db = FakeFirebaseFirestore();
    await db
        .doc('users/alice/records/task:a')
        .set({'kind': 'task', 'payload': 'safe', 'deleted': false});
    final sync = CloudSyncService(db);
    addTearDown(sync.disconnect);
    Map<String, String> view = {};
    sync.onRecords = (records) => view = records;
    await sync.connect('alice');
    await settle();
    expect(view['task:a'], 'safe');
    expect(prefs.getString('cloud.alice.recovery'), 'broken json');
  });

  test('new device without local cache performs full sync and receives all records',
      () async {
    final db = FakeFirebaseFirestore();
    final past = DateTime.now().subtract(const Duration(days: 30));
    // Simulate past records created in the cloud long ago
    await db.doc('users/alice/records/task:past1').set({
      'kind': 'task',
      'payload': '{"title":"Past task 1"}',
      'deleted': false,
      'updatedAt': Timestamp.fromDate(past),
    });
    await db.doc('users/alice/records/project:p1').set({
      'kind': 'project',
      'payload': '{"name":"School"}',
      'deleted': false,
      'updatedAt': Timestamp.fromDate(past),
    });
    await db.doc('users/alice/records/note:n1').set({
      'kind': 'note',
      'payload': '{"title":"Study note"}',
      'deleted': false,
      'updatedAt': Timestamp.fromDate(past),
    });

    final newDeviceSync = CloudSyncService(db);
    addTearDown(newDeviceSync.disconnect);
    Map<String, String> view = {};
    newDeviceSync.onRecords = (records) => view = records;

    // Connect as a brand new device with no cached data
    await newDeviceSync.connect('alice');
    await settle();

    // New device must have received all past records
    expect(view.length, 3);
    expect(view['task:past1'], contains('Past task 1'));
    expect(view['project:p1'], contains('School'));
    expect(view['note:n1'], contains('Study note'));
    expect(newDeviceSync.lastSyncMillis, isNotNull);
  });

  test('active device delta sync receives only updated records and keeps existing records',
      () async {
    final db = FakeFirebaseFirestore();
    final past = DateTime.now().subtract(const Duration(days: 5));
    // Simulate existing cloud records
    await db.doc('users/alice/records/task:1').set({
      'kind': 'task',
      'payload': '{"title":"Task 1"}',
      'deleted': false,
      'updatedAt': Timestamp.fromDate(past),
    });
    await db.doc('users/alice/records/task:2').set({
      'kind': 'task',
      'payload': '{"title":"Task 2"}',
      'deleted': false,
      'updatedAt': Timestamp.fromDate(past),
    });

    // Simulate an active device that already has task:1 and task:2 cached from last sync
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'cloud.alice',
      jsonEncode({
        'records': {
          'task:1': '{"title":"Task 1"}',
          'task:2': '{"title":"Task 2"}',
        },
        'pending': <String, String>{},
        'lastSync': past.millisecondsSinceEpoch,
      }),
    );

    final activeDevice = CloudSyncService(db);
    addTearDown(activeDevice.disconnect);
    Map<String, String> view = {};
    activeDevice.onRecords = (records) => view = records;

    await activeDevice.connect('alice');
    await settle();

    // Verify initial load from device cache
    expect(view.length, 2);
    expect(view['task:1'], contains('Task 1'));
    expect(view['task:2'], contains('Task 2'));

    // Another device now updates task:2 only (with a current timestamp)
    final now = DateTime.now();
    await db.doc('users/alice/records/task:2').set({
      'kind': 'task',
      'payload': '{"title":"Task 2 updated"}',
      'deleted': false,
      'updatedAt': Timestamp.fromDate(now),
    });
    await settle();

    // Active device receives the delta for task:2, while task:1 remains intact in memory
    expect(view.length, 2);
    expect(view['task:1'], contains('Task 1'));
    expect(view['task:2'], contains('Task 2 updated'));
  });

  test('active device delta sync correctly processes tombstones for deleted tasks',
      () async {
    final db = FakeFirebaseFirestore();
    final past = DateTime.now().subtract(const Duration(days: 2));

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'cloud.alice',
      jsonEncode({
        'records': {
          'task:1': '{"title":"Keep me"}',
          'task:2': '{"title":"Delete me"}',
        },
        'pending': <String, String>{},
        'lastSync': past.millisecondsSinceEpoch,
      }),
    );

    final activeDevice = CloudSyncService(db);
    addTearDown(activeDevice.disconnect);
    Map<String, String> view = {};
    activeDevice.onRecords = (records) => view = records;

    await activeDevice.connect('alice');
    await settle();
    expect(view.length, 2);

    // Another device deletes task:2 with a tombstone and new timestamp
    final now = DateTime.now();
    await db.doc('users/alice/records/task:2').set({
      'kind': 'task',
      'payload': '',
      'deleted': true,
      'updatedAt': Timestamp.fromDate(now),
    });
    await settle();

    // Delta sync should remove task:2 and keep task:1
    expect(view.containsKey('task:2'), false);
    expect(view['task:1'], contains('Keep me'));
  });
}
