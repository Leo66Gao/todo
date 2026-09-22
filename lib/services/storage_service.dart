import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/project.dart';
import '../models/task.dart';

class StorageService {
  static const _tasksKey = 'tasks';
  static const _projectsKey = 'projects';
  static const _tagsKey = 'tags';

  Future<List<Task>> loadTasks() async {
    final prefs = await SharedPreferences.getInstance();
    final taskList = prefs.getStringList(_tasksKey);
    if (taskList == null) return [];
    return taskList.map((item) => Task.fromJson(jsonDecode(item))).toList();
  }

  Future<List<Project>> loadProjects() async {
    final prefs = await SharedPreferences.getInstance();
    final projList = prefs.getStringList(_projectsKey);
    if (projList == null) {
      return [
        Project(id: 'p1', title: 'Work', colorValue: 0xFF000000),
        Project(id: 'p2', title: 'Personal', colorValue: 0xFF9E9E9E),
      ];
    }
    return projList.map((item) => Project.fromJson(jsonDecode(item))).toList();
  }

  Future<List<String>> loadTags() async {
    final prefs = await SharedPreferences.getInstance();
    final savedTags = prefs.getStringList(_tagsKey);
    return savedTags ?? ['General', 'Urgent'];
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
