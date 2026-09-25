import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/project.dart';
import '../models/task.dart';

class StorageService {
  static const _tasksKey = 'tasks';
  static const _projectsKey = 'projects';
  static const _tagsKey = 'tags';

  bool hadRecovery = false;

  Future<List<T>?> _loadList<T>(
    SharedPreferences prefs,
    String key,
    T Function(dynamic json) decode,
  ) async {
    List<String>? saved;
    try {
      saved = prefs.getStringList(key);
    } catch (_) {
      hadRecovery = true;
      await prefs.setString('$key.recovery', prefs.get(key).toString());
      return null;
    }
    if (saved == null) return null;
    final values = <T>[];
    final unreadable = <String>[];
    for (final item in saved) {
      try {
        values.add(decode(jsonDecode(item)));
      } catch (_) {
        unreadable.add(item);
      }
    }
    if (unreadable.isNotEmpty) {
      hadRecovery = true;
      await prefs.setStringList('$key.recovery', unreadable);
    }
    return values;
  }

  Future<List<Task>> loadTasks() async {
    final prefs = await SharedPreferences.getInstance();
    return await _loadList(prefs, _tasksKey, (json) => Task.fromJson(json)) ??
        [];
  }

  Future<List<Project>> loadProjects() async {
    final prefs = await SharedPreferences.getInstance();
    final projects =
        await _loadList(prefs, _projectsKey, (json) => Project.fromJson(json));
    if (projects == null) {
      return [
        Project(id: 'p1', title: 'Work', colorValue: 0xFF000000),
        Project(id: 'p2', title: 'Personal', colorValue: 0xFF9E9E9E),
      ];
    }
    return projects;
  }

  Future<List<String>> loadTags() async {
    final prefs = await SharedPreferences.getInstance();
    try {
      return prefs.getStringList(_tagsKey) ?? ['General', 'Urgent'];
    } catch (_) {
      hadRecovery = true;
      await prefs.setString(
          '$_tagsKey.recovery', prefs.get(_tagsKey).toString());
      return ['General', 'Urgent'];
    }
  }

  Future<void> saveTasks(List<Task> tasks) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
        _tasksKey, tasks.map((t) => jsonEncode(t.toJson())).toList());
  }

  Future<void> saveProjects(List<Project> projects) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
        _projectsKey, projects.map((p) => jsonEncode(p.toJson())).toList());
  }

  Future<void> saveTags(List<String> tags) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_tagsKey, tags);
  }

  Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
  }
}
