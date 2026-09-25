import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

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
  Map<String, String?> _bases = {};
  Map<String, String> _pendingIds = {};
  int? _lastSyncMillis;
  bool _flushing = false;
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
        _bases = data['bases'] is Map
            ? Map<String, String?>.from(data['bases'] as Map)
            : {};
        _pendingIds = data['pendingIds'] is Map
            ? Map<String, String>.from(data['pendingIds'] as Map)
            : {};
        _lastSyncMillis = data['lastSync'] as int?;
      } catch (error) {
        // Preserve corrupt data for recovery; don't turn a parse failure into
        // a blank workspace that gets uploaded over the user's cloud records.
        await prefs.setString('cloud.$uid.recovery', saved);
        _records = {};
        _pending = {};
        _bases = {};
        _pendingIds = {};
        _lastSyncMillis = null;
        onStatus?.call(
            'Recovering from cloud', 'A damaged device cache was backed up.');
      }
    }
    // Older caches have pending writes without operation IDs. Give them stable
    // IDs before replay so a retry cannot create multiple conflict copies.
    if (_pending.keys.any((key) => !_pendingIds.containsKey(key))) {
      for (final key in _pending.keys) {
        _pendingIds.putIfAbsent(key, () => const Uuid().v4());
      }
      await _persist();
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
  /// Active devices with cached records subscribe to records where
  /// `updatedAt > lastSync - 5 seconds`. The overlap avoids missing writes
  /// around a reconnect; matching records in that window can be read again.
  void _listen(int generation) {
    _subscription?.cancel();
    final isFullSync = _lastSyncMillis == null || _records.isEmpty;
    var checkedFullServerSnapshot = false;
    var deliveredInitialRecords = false;
    String? lastStatus;
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
      var recordsChanged = false;
      if (isFullSync &&
          !snapshot.metadata.isFromCache &&
          !checkedFullServerSnapshot) {
        checkedFullServerSnapshot = true;
        final ids = snapshot.docs.map((doc) => doc.id).toSet();
        final oldCount = _records.length;
        _records.removeWhere(
            (id, _) => !ids.contains(id) && !_pending.containsKey(id));
        recordsChanged = _records.length != oldCount;
      }
      int? maxUpdated;
      for (final change in snapshot.docChanges) {
        final doc = change.doc;
        final id = doc.id;
        if (change.type == DocumentChangeType.removed) {
          if (isFullSync && !_pending.containsKey(id)) {
            recordsChanged = _records.remove(id) != null || recordsChanged;
          }
          continue;
        }
        final data = doc.data();
        final ts = data?['updatedAt'];
        if (ts is Timestamp) {
          final ms = ts.millisecondsSinceEpoch;
          if (maxUpdated == null || ms > maxUpdated) maxUpdated = ms;
        } else if (ts is DateTime) {
          final ms = ts.millisecondsSinceEpoch;
          if (maxUpdated == null || ms > maxUpdated) maxUpdated = ms;
        }
        if (_pending.containsKey(id)) continue;
        if (data?['deleted'] == true) {
          recordsChanged = _records.remove(id) != null || recordsChanged;
        } else {
          if (data?['payload'] is String) {
            final payload = data!['payload'] as String;
            if (_records[id] != payload) {
              _records[id] = payload;
              recordsChanged = true;
            }
          }
        }
      }
      var watermarkChanged = false;
      if (maxUpdated != null && (maxUpdated > (_lastSyncMillis ?? 0))) {
        _lastSyncMillis = maxUpdated;
        watermarkChanged = true;
      }
      if (recordsChanged || !deliveredInitialRecords) {
        deliveredInitialRecords = true;
        onRecords?.call(Map.of(_records));
      }
      if (recordsChanged || watermarkChanged) {
        unawaited(_persist().catchError((Object error) {
          if (generation == _generation) {
            onStatus?.call('Device storage needs attention', error.toString());
          }
        }));
      }
      final status = _pending.isNotEmpty
          ? 'Changes waiting to sync'
          : snapshot.metadata.isFromCache
              ? 'Offline · saved on this device'
              : 'Synced';
      if (status != lastStatus) {
        lastStatus = status;
        onStatus?.call(status, null);
      }
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
      'bases': _bases,
      'pendingIds': _pendingIds,
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
      if (!_pending.containsKey(entry.key))
        _bases[entry.key] = _records[entry.key];
      _pending[entry.key] = entry.value;
      _pendingIds[entry.key] = const Uuid().v4();
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

  /// A conflicting local edit becomes a visible copy. Settings (which have a
  /// fixed record ID) and unreadable payloads become notes containing the raw
  /// local value so they can still be recovered by the user.
  MapEntry<String, String>? _conflictCopy(
      String key, String payload, String copyId) {
    final kind = key.split(':').first;
    try {
      if (kind != 'settings') {
        final value = Map<String, dynamic>.from(jsonDecode(payload) as Map);
        value['id'] = copyId;
        final nameKey = kind == 'folder' ? 'name' : 'title';
        value[nameKey] = '${value[nameKey] ?? 'Untitled'} (conflict copy)';
        if (kind == 'task') {
          value['googleEventId'] = null;
          value['calendarEventRevision'] = 0;
          value['isConflictCopy'] = true;
        }
        final encoded = jsonEncode(value);
        if (encoded.length <= 690000 && utf8.encode(encoded).length <= 900000) {
          return MapEntry('$kind:$copyId', encoded);
        }
      }
    } catch (_) {
      // A malformed record can still be preserved in a readable note.
    }
    final now = DateTime.now().toIso8601String();
    final note = jsonEncode({
      'id': copyId,
      'title': 'Sync conflict: $key',
      'content': 'Local version of $key:\n\n$payload',
      'createdAt': now,
      'updatedAt': now,
    });
    if (note.length <= 690000 && utf8.encode(note).length <= 900000) {
      return MapEntry('note:$copyId', note);
    }
    return null;
  }

  Future<void> _archiveOversizedConflict(
      String uid, String operationId, String key, String payload) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('cloud.$uid.conflict.$operationId',
        jsonEncode({'key': key, 'payload': payload}));
  }

  /// Import only missing documents. Existing records AND tombstones win;
  /// interrupted imports can be retried without duplicating or resurrecting data.
  Future<void> importMissing(Map<String, String> legacy) async {
    final collection = _collection;
    final generation = _generation;
    final entries = legacy.entries.toList();
    for (var start = 0; start < entries.length; start += 50) {
      if (generation != _generation) {
        throw StateError('Account changed during import.');
      }
      final end = start + 50 < entries.length ? start + 50 : entries.length;
      final chunk = entries.sublist(start, end);
      await database.runTransaction((transaction) async {
        final existing = <String, bool>{};
        for (final entry in chunk) {
          existing[entry.key] =
              (await transaction.get(collection.doc(entry.key))).exists;
        }
        for (final entry in chunk) {
          if (!existing[entry.key]!) {
            transaction.set(
                collection.doc(entry.key), _document(entry.key, entry.value));
          }
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
        final operationIds = {
          for (final entry in entries) entry.key: _pendingIds[entry.key]!
        };
        final bases = <String, String?>{
          for (final entry in entries)
            if (_bases.containsKey(entry.key)) entry.key: _bases[entry.key]
        };
        final outcome = await database.runTransaction((transaction) async {
          // Read all documents before writes. Deletion wins over any offline
          // edit to the same ID; recreating a task requires a fresh ID.
          final snapshots = <String, DocumentSnapshot<Map<String, dynamic>>>{};
          for (final entry in entries) {
            snapshots[entry.key] =
                await transaction.get(collection.doc(entry.key));
          }
          final tombstones = <String>{};
          final conflicts = <String, String>{};
          final copies = <String, MapEntry<String, String>>{};
          final oversized = <String>{};
          for (final entry in entries) {
            final remote = snapshots[entry.key]!;
            if (remote.data()?['deleted'] == true) {
              tombstones.add(entry.key);
              continue;
            }
            if (entry.value == null || !remote.exists) continue;
            final remotePayload = remote.data()?['payload'] as String?;
            if (remotePayload == entry.value) continue;
            final baseKnown = bases.containsKey(entry.key);
            if (baseKnown && remotePayload == bases[entry.key]) continue;
            conflicts[entry.key] = remotePayload ?? '';
          }
          final candidates = <String, MapEntry<String, String>?>{
            for (final entry in entries)
              if (conflicts.containsKey(entry.key))
                entry.key: _conflictCopy(
                    entry.key, entry.value!, operationIds[entry.key]!)
          };
          // Read prospective copy documents before making any writes. Existing
          // copies are kept when a transaction is retried after an ack failure.
          final copySnapshots =
              <String, DocumentSnapshot<Map<String, dynamic>>>{};
          for (final key in conflicts.keys) {
            final copy = candidates[key];
            if (copy != null) {
              copySnapshots[key] =
                  await transaction.get(collection.doc(copy.key));
            }
          }
          for (final entry in entries) {
            if (tombstones.contains(entry.key)) continue;
            if (conflicts.containsKey(entry.key)) {
              final copy = candidates[entry.key];
              if (copy == null) {
                oversized.add(entry.key);
              } else {
                final existing = copySnapshots[entry.key]!;
                if (!existing.exists) {
                  transaction.set(collection.doc(copy.key),
                      _document(copy.key, copy.value));
                }
                copies[entry.key] = MapEntry(copy.key,
                    existing.data()?['payload'] as String? ?? copy.value);
              }
            } else if (snapshots[entry.key]!.data()?['payload'] !=
                    entry.value ||
                !snapshots[entry.key]!.exists) {
              transaction.set(
                  collection.doc(entry.key), _document(entry.key, entry.value));
            } else {
              // This exact write already reached the server before an earlier
              // attempt lost its acknowledgement.
            }
          }
          return (
            tombstones: tombstones,
            conflicts: conflicts,
            copies: copies,
            oversized: oversized
          );
        });
        if (generation != _generation) return;
        for (final key in outcome.oversized) {
          final entry = entries.firstWhere((entry) => entry.key == key);
          await _archiveOversizedConflict(
              _uid!, operationIds[key]!, key, entry.value!);
        }
        var recordsChanged = false;
        for (final entry in entries) {
          final sameOperation =
              _pendingIds[entry.key] == operationIds[entry.key];
          if (outcome.tombstones.contains(entry.key)) {
            _pending.remove(entry.key);
            _bases.remove(entry.key);
            _pendingIds.remove(entry.key);
            _records.remove(entry.key);
            recordsChanged = true;
          } else if (outcome.conflicts.containsKey(entry.key)) {
            final copy = outcome.copies[entry.key];
            if (copy != null) {
              _records[copy.key] = copy.value;
              recordsChanged = true;
            }
            if (sameOperation) {
              _records[entry.key] = outcome.conflicts[entry.key]!;
              _pending.remove(entry.key);
              _bases.remove(entry.key);
              _pendingIds.remove(entry.key);
              recordsChanged = true;
            }
          } else if (sameOperation) {
            _pending.remove(entry.key);
            _bases.remove(entry.key);
            _pendingIds.remove(entry.key);
          } else {
            // Another local edit arrived while the transaction was running.
            // Its base is the value just written by this transaction.
            _bases[entry.key] = entry.value;
          }
        }
        if (recordsChanged) onRecords?.call(Map.of(_records));
        await _persist();
        if (outcome.conflicts.isNotEmpty) {
          onStatus?.call(
              'Sync conflicts saved as copies',
              outcome.oversized.isEmpty
                  ? null
                  : 'An oversized local version was backed up on this device.');
        }
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
        var recordsChanged = isFull;
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
              recordsChanged = _records.remove(doc.id) != null || recordsChanged;
            } else if (data['payload'] is String) {
              final payload = data['payload'] as String;
              if (_records[doc.id] != payload) {
                _records[doc.id] = payload;
                recordsChanged = true;
              }
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
        var watermarkChanged = false;
        if (maxUpdated != null && (maxUpdated > (_lastSyncMillis ?? 0))) {
          _lastSyncMillis = maxUpdated;
          watermarkChanged = true;
        }
        if (recordsChanged) onRecords?.call(Map.of(_records));
        if (recordsChanged || watermarkChanged) await _persist();
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
    _bases = {};
    _pendingIds = {};
    _lastSyncMillis = null;
    _flushing = false;
  }
}
