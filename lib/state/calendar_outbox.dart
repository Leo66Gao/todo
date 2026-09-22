/// Pure helpers for the durable Google Calendar outbox in
/// `TaskProvider`. Extracted so the keying scheme is unit-testable without a
/// signed-in Firebase session.
///
/// The outbox is a persisted map of pending Calendar operations. Upserts for a
/// task collapse into a single `upsert:<taskId>` slot (latest snapshot wins).
/// Deletes are keyed by the event they remove (`delete:<eventId>`) so that
/// completing then quickly reopening a task cannot overwrite a still-pending
/// deletion — the two live in separate slots, and the flush's revision guard
/// discards whichever side has been superseded.
library;

/// Outbox slot for [action].
String calendarActionKey(Map<String, dynamic> action) =>
    action['operation'] == 'delete'
        ? 'delete:${action['eventId']}'
        : 'upsert:${action['taskId']}';

/// Whether an export for [taskId] is queued (or in flight — entries stay in
/// the outbox until their request completes).
bool hasPendingUpsert(Map<String, Map<String, dynamic>> outbox, String taskId) =>
    outbox.containsKey('upsert:$taskId');

/// Whether a delete for [eventId] is queued or in flight. A reopened task must
/// not reuse such an event ID: Calendar retains deleted IDs as tombstones and
/// rejects re-creation with a 409 conflict.
bool hasPendingDelete(
        Map<String, Map<String, dynamic>> outbox, String? eventId) =>
    eventId != null && outbox.containsKey('delete:$eventId');

/// Re-keys a decoded outbox so every entry sits under its canonical slot.
///
/// Outboxes persisted by older builds were keyed by raw task ID, which let a
/// reopen overwrite a pending delete. Normalizing on load migrates them and
/// guarantees the flush can always find (and remove) an entry by its key.
Map<String, Map<String, dynamic>> normalizeCalendarOutbox(
    Map<String, dynamic> decoded) {
  final result = <String, Map<String, dynamic>>{};
  for (final value in decoded.values) {
    final action = Map<String, dynamic>.from(value as Map);
    result[calendarActionKey(action)] = action;
  }
  return result;
}
