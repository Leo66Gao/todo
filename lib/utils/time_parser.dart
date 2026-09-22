import 'package:flutter/material.dart';

class ParsedTimeResult {
  final String cleanTitle;
  final TimeOfDay? time;
  ParsedTimeResult(this.cleanTitle, this.time);
}

ParsedTimeResult parseTimeFromTitle(String title) {
  final trimmed = title.trim();
  if (trimmed.isEmpty) return ParsedTimeResult('', null);

  final parts = trimmed.split(RegExp(r'\s+'));
  if (parts.length < 2) return ParsedTimeResult(trimmed, null);

  final lastWord = parts.last;

  // Matches times like 16, 18.30, 18:30, 6pm, 9.15am, 10:45pm
  final timeRegex =
      RegExp(r'^(\d{1,2})([:.](\d{2}))?\s*(am|pm)?$', caseSensitive: false);
  final match = timeRegex.firstMatch(lastWord);

  if (match != null) {
    int? hour = int.tryParse(match.group(1) ?? '');
    int minute = 0;
    if (match.group(3) != null) {
      minute = int.tryParse(match.group(3) ?? '') ?? 0;
    }
    String? amPm = match.group(4)?.toLowerCase();

    if (hour != null &&
        hour >= 0 &&
        hour <= 23 &&
        minute >= 0 &&
        minute <= 59) {
      if (amPm != null) {
        if (amPm == 'pm' && hour < 12) {
          hour += 12;
        } else if (amPm == 'am' && hour == 12) {
          hour = 0;
        }
      }

      final cleanTitle = parts.sublist(0, parts.length - 1).join(' ');
      if (cleanTitle.isNotEmpty) {
        return ParsedTimeResult(
            cleanTitle, TimeOfDay(hour: hour, minute: minute));
      }
    }
  }

  return ParsedTimeResult(trimmed, null);
}
