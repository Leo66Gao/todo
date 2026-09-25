import 'dart:convert';

/// Leave room below Firestore's record limit for the document fields and
/// encoding overhead. Check the complete JSON payload, including rich-text
/// link attributes and note metadata, before closing an editor.
bool recordFitsCloud(Map<String, dynamic> record) =>
    utf8.encode(jsonEncode(record)).length <= 650 * 1024;
