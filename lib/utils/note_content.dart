import 'dart:convert';

import 'package:flutter_quill/flutter_quill.dart';

/// Note content is stored as a Quill delta JSON string. Notes written before
/// the rich editor exist hold raw Markdown — every reader tolerates both.
bool isQuillDelta(String content) {
  final trimmed = content.trimLeft();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return false;
  try {
    final decoded = jsonDecode(content);
    if (decoded is List) return true;
    if (decoded is Map && decoded['ops'] is List) return true;
  } catch (_) {}
  return false;
}

/// Builds a Quill document from stored content. Legacy Markdown is loaded as
/// plain text so nothing is lost when an old note is opened and re-saved.
Document documentFromContent(String content) {
  if (isQuillDelta(content)) {
    try {
      final decoded = jsonDecode(content);
      final ops = decoded is List
          ? decoded
          : (decoded['ops'] as List?) ?? const [];
      return Document.fromJson(ops);
    } catch (_) {
      // fall through to plain text
    }
  }
  return Document()..insert(0, content);
}

String documentToContent(Document document) =>
    jsonEncode(document.toDelta().toJson());

final RegExp _bareUrlRegExp = RegExp(
  r'(https?:\/\/[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)',
);

/// Returns the content of [document] with bare URLs (google.com,
/// https://…) converted into real links. Applied on save so pasted text
/// becomes tappable/blue without any manual formatting.
Document documentWithAutoLinks(Document document) {
  final result = <Map<String, dynamic>>[];
  var changed = false;

  for (final op in document.toDelta().toList()) {
    final text = op.value is String ? op.value as String : null;
    if (text == null || text.isEmpty || op.attributes?['link'] != null) {
      result.add(op.toJson());
      continue;
    }

    final matches = _bareUrlRegExp.allMatches(text).toList();
    if (matches.isEmpty) {
      result.add(op.toJson());
      continue;
    }

    changed = true;
    var cursor = 0;
    for (final match in matches) {
      if (match.start > cursor) {
        result.add({...op.toJson(), 'insert': text.substring(cursor, match.start)});
      }
      final url = match.group(0)!;
      final href =
          url.startsWith('http://') || url.startsWith('https://')
              ? url
              : 'https://$url';
      final attrs = <String, dynamic>{...?op.attributes, 'link': href};
      result.add({'insert': url, 'attributes': attrs});
      cursor = match.end;
    }
    if (cursor < text.length) {
      result.add({...op.toJson(), 'insert': text.substring(cursor)});
    }
  }

  if (!changed) return document;
  return Document.fromJson(result);
}

/// Plain text of a note in either format, for previews and search.
String notePlainText(String content) {
  if (!isQuillDelta(content)) {
    // Legacy Markdown still needs its syntax stripped for previews.
    return _stripMarkdown(content);
  }
  try {
    final decoded = jsonDecode(content);
    final ops = decoded is List ? decoded : (decoded['ops'] as List?) ?? const [];
    final buffer = StringBuffer();
    for (final op in ops) {
      if (op is Map && op['insert'] is String) {
        buffer.write(op['insert'] as String);
      }
    }
    return buffer.toString().replaceAll(RegExp(r'\s+'), ' ').trim();
  } catch (_) {
    return '';
  }
}

String _stripMarkdown(String markdown) {
  var text = markdown
      // images: keep nothing
      .replaceAll(RegExp(r'!\[[^\]]*\]\([^)]*\)'), '')
      // links: keep the label
      .replaceAllMapped(
        RegExp(r'\[([^\]]+)\]\([^)]*\)'),
        (match) => match.group(1) ?? '',
      )
      // headings / blockquotes: drop the marker, keep the words
      .replaceAllMapped(
        RegExp(r'^\s{0,3}(#{1,6}|>)\s+', multiLine: true),
        (match) => '',
      )
      // bold / strikethrough / inline code markers
      .replaceAll(RegExp(r'\*\*|__|~~|`'), '')
      // _italic_ only when not glued to a word (keeps snake_case intact);
      // capturing the prefix avoids lookbehind, which some web engines lack
      .replaceAllMapped(
        RegExp(r'(^|[^A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])'),
        (match) => '${match.group(1) ?? ''}${match.group(2) ?? ''}',
      )
      // list bullets at line starts
      .replaceAllMapped(
        RegExp(r'^\s*[-*+]\s+(\[[ xX]\]\s+)?', multiLine: true),
        (match) => '',
      );
  return text.replaceAll(RegExp(r'\s+'), ' ').trim();
}
