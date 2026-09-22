import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// One document per entity. Tombstones prevent stale offline devices from
/// resurrecting deleted records. The durable outbox is isolated by Firebase UID.
class CloudSyncService {
  CloudSyncService(this.database);
  final FirebaseFirestore database;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _subscription;
  Timer? _retry;
  Timer? _resub;
  String? _uid;
  Map<String, String> _records = {};
  Map<String, String?> _pending = {};
  int? _lastSyncMillis;
  bool _flushing = false;
  bool _serverSeen = false;
  int _generation = 0;
  Future<void> _disk = Future.value();
  void Function(Map<String, String>)? onRecords;
  void Function(String status, String? error)? onStatus;
  CollectionReference<Map<String, dynamic>> get _collection =>
      database.collection('users').doc(_uid!).collection('records');

  int? get lastSyncMillis => _lastSyncMillis;

  Future<Map<String, String>> connect(String uid) async {
    await disconnect();
    _uid = uid;
    final generation = _generation;
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('cloud.$uid');
    if (saved != null) {
      try {
        final data = jsonDecode(saved) as Map<String, dynamic>;
        _records = Map<String, String>.from(data['records'] as Map);
        _pending = Map<String, String?>.from(data['pending'] as Map);
        _lastSyncMillis = data['lastSync'] as int?;
      } catch (error) {
        // Preserve corrupt data for recovery; don't turn a parse failure into
        // a blank workspace that gets uploaded over the user's cloud records.
        await prefs.setString('cloud.$uid.recovery', saved);
        _records = {};
        _pending = {};
        _lastSyncMillis = null;
        onStatus?.call(
            'Recovering from cloud', 'A damaged device cache was backed up.');
      }
    }
    _listen(generation);
    _retry =
        Timer.periodic(const Duration(seconds: 15), (_) => unawaited(flush()));
    unawaited(flush());
    return Map.of(_records);
  }

  /// (Re)subscribes to the live records stream.
  ///
  /// Initial sync (new device / empty cache) fetches all documents.
  /// Active devices with cached records subscribe only to records where
  /// `updatedAt > lastSync` (with a 5-second overlap), ensuring 0 unnecessary
  /// document reads on restart or when other tasks are modified.
  void _listen(int generation) {
    _subscription?.cancel();
    final isFullSync = _lastSyncMillis == null || _records.isEmpty;
    Query<Map<String, dynamic>> query = _collection;
    if (!isFullSync) {
      final overlapMs = _lastSyncMillis! > 5000 ? _lastSyncMillis! - 5000 : 0;
      final overlap = DateTime.fromMillisecondsSinceEpoch(overlapMs);
      query = _collection.where('updatedAt',
          isGreaterThan: Timestamp.fromDate(overlap));
    }
    _subscription =
        query.snapshots(includeMetadataChanges: true).listen((snapshot) {
      if (generation != _generation) return;
      _serverSeen = !snapshot.metadata.isFromCache;
      if (isFullSync && _serverSeen) {
        final ids = snapshot.docs.map((doc) => doc.id).toSet();
        _records.removeWhere(
            (id, _) => !ids.contains(id) && !_pending.containsKey(id));
      }
      int? maxUpdated;
      for (final doc in snapshot.docs) {
        final id = doc.id;
        final data = doc.data();
        final ts = data['updatedAt'];
        if (ts is Timestamp) {
          final ms = ts.millisecondsSinceEpoch;
          if (maxUpdated == null || ms > maxUpdated) maxUpdated = ms;
        } else if (ts is DateTime) {
          final ms = ts.millisecondsSinceEpoch;
          if (maxUpdated == null || ms > maxUpdated) maxUpdated = ms;
        }
        if (_pending.containsKey(id)) continue;
        if (data['deleted'] == true) {
          _records.remove(id);
        } else {
          if (data['payload'] is String) {
            _records[id] = data['payload'] as String;
          }
        }
      }
      if (maxUpdated != null && (maxUpdated > (_lastSyncMillis ?? 0))) {
        _lastSyncMillis = maxUpdated;
      }
      onRecords?.call(Map.of(_records));
      unawaited(_persist().catchError((Object error) {
        if (generation == _generation) {
          onStatus?.call('Device storage needs attention', error.toString());
        }
      }));
      onStatus?.call(
          _pending.isNotEmpty
              ? 'Changes waiting to sync'
              : snapshot.metadata.isFromCache
                  ? 'Offline · saved on this device'
                  : 'Synced',
          null);
    }, onError: (Object error) {
      if (generation != _generation) return;
      onStatus?.call('Sync needs attention', error.toString());
      _resub?.cancel();
      _resub = Timer(const Duration(seconds: 8), () {
        if (generation == _generation && _uid != null) _listen(generation);
      });
    });
  }

  Future<void> _persist() {
    final uid = _uid;
    if (uid == null) return Future.value();
    final encoded = jsonEncode({
      'records': _records,
      'pending': _pending,
      if (_lastSyncMillis != null) 'lastSync': _lastSyncMillis,
    });
    _disk = _disk.catchError((Object _) {}).then((_) async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('cloud.$uid', encoded);
    });
    return _disk;
  }

  Future<void> writeChanges(Map<String, String?> changes) async {
    if (_uid == null) throw StateError('Sign in before saving cloud changes.');
    if (changes.isEmpty) return;
    final generation = _generation;
    for (final entry in changes.entries) {
      _pending[entry.key] = entry.value;
      if (entry.value == null) {
        _records.remove(entry.key);
      } else {
        _records[entry.key] = entry.value!;
      }
    }
    await _persist();
    if (generation != _generation) return;
    onStatus?.call('Changes waiting to sync', null);
    unawaited(flush());
  }

  Map<String, dynamic> _document(String key, String? payload) => {
        'kind': key.split(':').first,
        'payload': payload ?? '',
        'deleted': payload == null,
        'updatedAt': FieldValue.serverTimestamp(),
      };

  /// Import only missing documents. Existing records AND tombstones win;
  /// interrupted imports can be retried without duplicating or resurrecting data.
  Future<void> importMissing(Map<String, String> legacy) async {
    final collection = _collection;
    final generation = _generation;
    for (final entry in legacy.entries) {
      if (generation != _generation)
        throw StateError('Account changed during import.');
      await database.runTransaction((transaction) async {
        final ref = collection.doc(entry.key);
        final snapshot = await transaction.get(ref);
        if (!snapshot.exists) {
          transaction.set(ref, _document(entry.key, entry.value));
        }
      });
    }
  }

  Future<void> flush() async {
    if (_uid == null || _flushing || _pending.isEmpty) return;
    _flushing = true;
    final generation = _generation;
    final collection = _collection;
    try {
      while (_pending.isNotEmpty && generation == _generation) {
        final entries = _pending.entries.take(50).toList();
        final deletedRemotely =
            await database.runTransaction((transaction) async {
          // Read all documents before writes. Deletion wins over any offline
          // edit to the same ID; recreating a task requires a fresh ID.
          final snapshots = <String, DocumentSnapshot<Map<String, dynamic>>>{};
          for (final entry in entries) {
            snapshots[entry.key] =
                await transaction.get(collection.doc(entry.key));
          }
          final tombstones = <String>{};
          for (final entry in entries) {
            if (snapshots[entry.key]!.data()?['deleted'] == true) {
              tombstones.add(entry.key);
            } else {
              transaction.set(
                  collection.doc(entry.key), _document(entry.key, entry.value));
            }
          }
          return tombstones;
        });
        if (generation != _generation) return;
        for (final entry in entries) {
          if (deletedRemotely.contains(entry.key)) {
            _pending.remove(entry.key);
            _records.remove(entry.key);
          } else if (_pending.containsKey(entry.key) &&
              _pending[entry.key] == entry.value) {
            _pending.remove(entry.key);
          }
        }
        if (deletedRemotely.isNotEmpty) onRecords?.call(Map.of(_records));
        await _persist();
      }
      if (generation == _generation) {
        // A remote edit can arrive while this ID is protected by the outbox.
        // Fetch updates after acknowledgement so that edit is not lost forever.
        final isFull = _lastSyncMillis == null;
        Query<Map<String, dynamic>> query = collection;
        if (!isFull) {
          final overlapMs =
              _lastSyncMillis! > 5000 ? _lastSyncMillis! - 5000 : 0;
          final overlap = DateTime.fromMillisecondsSinceEpoch(overlapMs);
          query = collection.where('updatedAt',
              isGreaterThan: Timestamp.fromDate(overlap));
        }
        final snapshot =
            await query.get(const GetOptions(source: Source.server));
        if (generation != _generation) return;
        if (isFull) {
          final remote = <String, String>{
            for (final doc in snapshot.docs)
              if (doc.data()['deleted'] != true &&
                  doc.data()['payload'] is String)
                doc.id: doc.data()['payload'] as String,
          };
          for (final entry in _pending.entries) {
            if (entry.value == null) {
              remote.remove(entry.key);
            } else {
              remote[entry.key] = entry.value!;
            }
          }
          _records = remote;
        } else {
          for (final doc in snapshot.docs) {
            if (_pending.containsKey(doc.id)) continue;
            final data = doc.data();
            if (data['deleted'] == true) {
              _records.remove(doc.id);
            } else if (data['payload'] is String) {
              _records[doc.id] = data['payload'] as String;
            }
          }
        }
        int? maxUpdated;
        for (final doc in snapshot.docs) {
          final ts = doc.data()['updatedAt'];
          if (ts is Timestamp) {
            final ms = ts.millisecondsSinceEpoch;
            if (maxUpdated == null || ms > maxUpdated) maxUpdated = ms;
          } else if (ts is DateTime) {
            final ms = ts.millisecondsSinceEpoch;
            if (maxUpdated == null || ms > maxUpdated) maxUpdated = ms;
          }
        }
        if (maxUpdated != null && (maxUpdated > (_lastSyncMillis ?? 0))) {
          _lastSyncMillis = maxUpdated;
        }
        _serverSeen = true;
        onRecords?.call(Map.of(_records));
        await _persist();
        if (generation == _generation) {
          onStatus?.call(
              _pending.isEmpty ? 'Synced' : 'Changes waiting to sync', null);
        }
      }
    } catch (error) {
      if (generation == _generation) {
        onStatus?.call('Changes saved locally · retrying', error.toString());
      }
    } finally {
      if (generation == _generation) _flushing = false;
    }
  }

  Future<void> disconnect() async {
    _generation++;
    _retry?.cancel();
    _resub?.cancel();
    await _subscription?.cancel();
    await _disk.catchError((Object _) {});
    _subscription = null;
    _uid = null;
    _records = {};
    _pending = {};
    _lastSyncMillis = null;
    _flushing = false;
    _serverSeen = false;
  }
}
