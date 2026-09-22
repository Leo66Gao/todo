import 'dart:math';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/google_calendar_service.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import 'customization_page.dart';

/// Settings, grouped with progressive disclosure: account first, workspace
/// customization next, destructive data actions pinned at the bottom.
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final user = provider.currentUser;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          _caption(context, 'ACCOUNT'),
          const SizedBox(height: 10),
          _Card(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
                child: Column(children: [
                  CircleAvatar(
                      radius: 32,
                      backgroundImage: user?.photoURL == null
                          ? null
                          : NetworkImage(user!.photoURL!),
                      child: user?.photoURL == null
                          ? const Icon(Icons.person_outline, size: 32)
                          : null),
                  const SizedBox(height: 16),
                  Text(user?.displayName ?? 'Your study workspace',
                      style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Text(
                      user?.email ??
                          'Sign in with the same Google account on your phone and laptop.',
                      textAlign: TextAlign.center),
                  const SizedBox(height: 20),
                  if (user != null) ...[
                    ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(provider.cloudError == null
                            ? Icons.cloud_done_outlined
                            : Icons.cloud_off_outlined),
                        title: Text(provider.cloudStatus),
                        subtitle: const Text(
                            'Tasks, subjects, notes and preferences')),
                    if (provider.importAvailable)
                      TextButton.icon(
                          onPressed: provider.importLocalData,
                          icon: const Icon(Icons.upload),
                          label: const Text('Retry importing device data')),
                    OutlinedButton.icon(
                        onPressed:
                            provider.authBusy ? null : provider.signOut,
                        icon: const Icon(Icons.logout),
                        label: const Text('Sign out')),
                  ] else
                    ElevatedButton.icon(
                        onPressed: !provider.cloudAvailable ||
                                provider.authBusy
                            ? null
                            : provider.signInWithGoogle,
                        style: ElevatedButton.styleFrom(
                            backgroundColor: context.ink,
                            foregroundColor: context.inkInverse,
                            elevation: 0),
                        icon: const Icon(Icons.login),
                        label: Text(provider.authBusy
                            ? 'Signing in…'
                            : 'Sign in with Google')),
                  if (!provider.cloudAvailable)
                    const Padding(
                        padding: EdgeInsets.only(top: 12),
                        child: Text(
                            'Cloud setup is unavailable on this platform. Your device data is still saved locally.')),
                  if (provider.cloudError != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: SelectableText(provider.cloudError!,
                            style: TextStyle(
                                color:
                                    Theme.of(context).colorScheme.error))),
                ]),
              ),
            ],
          ),
          const SizedBox(height: 24),
          _caption(context, 'WORKSPACE'),
          const SizedBox(height: 10),
          _Card(
            children: [
              ListTile(
                  leading: const Icon(Icons.tune),
                  title: const Text('Customize tasks',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: const Text(
                      'Task form fields, their order, labels and subjects'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => const CustomizationPage()))),
              const Divider(height: 1, indent: 56),
              if (user != null && GoogleCalendarService.isSupported)
                ListTile(
                    leading: const Icon(Icons.event),
                    title: const Text('Google Calendar',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(provider.calendarConnected
                        ? 'Connected · new task changes are exported'
                        : 'Optional calendar export, separate from workspace sync'),
                    trailing: provider.calendarConnected
                        ? const Icon(Icons.check)
                        : TextButton(
                            onPressed: provider.connectCalendar,
                            child: const Text('Connect'))),
            ],
          ),
          if (provider.syncError != null)
            Padding(
                padding: const EdgeInsets.fromLTRB(4, 10, 4, 0),
                child: Text(provider.syncError!,
                    style: TextStyle(color: Colors.red[700], fontSize: 12.5))),
          const SizedBox(height: 24),
          _caption(context, 'APPEARANCE'),
          const SizedBox(height: 10),
          _Card(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                child: Row(
                  children: [
                    Icon(Icons.brightness_6_outlined, color: context.inkSoft),
                    const SizedBox(width: 16),
                    Expanded(
                      child: _ThemeModeSelector(
                          current: provider.workspaceSettings.themeMode),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          _caption(context, 'DATA'),
          const SizedBox(height: 10),
          _Card(
            children: [
              ListTile(
                  leading: Icon(Icons.delete_outline, color: context.inkSoft),
                  title: const Text('Delete workspace data',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(user == null
                      ? 'Delete this device’s guest workspace'
                      : 'Delete records from this account on all devices'),
                  onTap: () => _confirmDeleteWorkspace(context, provider)),
            ],
          ),
        ],
      ),
    );
  }

  /// Three-step guard before deleting everything: understand → type DELETE →
  /// solve a small puzzle. Deliberately slow; nobody does this by accident.
  Future<void> _confirmDeleteWorkspace(
      BuildContext context, TaskProvider provider) async {
    final user = provider.currentUser;

    // Step 1 — understand what will be lost.
    final proceed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete workspace data?'),
        content: Text(
          user == null
              ? 'This removes every task, assignment, milestone, subject, note '
                  'and preference saved on this device.'
              : 'This deletes your tasks, assignments, milestones, subjects, '
                  'notes and settings across all signed-in devices. Uploaded '
                  'files are kept, but the notes referencing them are gone.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: FilledButton.styleFrom(backgroundColor: context.ink),
              child: const Text('Continue')),
        ],
      ),
    );
    if (proceed != true || !context.mounted) return;

    // Step 2 — type DELETE.
    final typedOk = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        final controller = TextEditingController();
        return StatefulBuilder(
          builder: (ctx, setState) => AlertDialog(
            title: const Text('Type DELETE to continue'),
            content: TextField(
              controller: controller,
              autofocus: true,
              autocorrect: false,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'DELETE',
                filled: true,
                fillColor: context.fillSoft,
                border: OutlineInputBorder(),
              ),
            ),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Cancel')),
              FilledButton(
                  onPressed: controller.text.trim().toUpperCase() == 'DELETE'
                      ? () => Navigator.pop(ctx, true)
                      : null,
                  style: FilledButton.styleFrom(
                      backgroundColor: context.ink,
                      disabledBackgroundColor: context.fillSoft),
                  child: const Text('Next')),
            ],
          ),
        );
      },
    );
    if (typedOk != true || !context.mounted) return;

    // Step 3 — solve a small puzzle.
    final a = 12 + Random().nextInt(80);
    final b = 3 + Random().nextInt(9);
    final solved = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        final controller = TextEditingController();
        final answer = (a + b).toString();
        return StatefulBuilder(
          builder: (ctx, setState) => AlertDialog(
            title: const Text('Final check'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('What is'),
                Text('$a + $b',
                    style: const TextStyle(
                        fontSize: 30, fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                TextField(
                  controller: controller,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: 'Answer',
                    filled: true,
                    fillColor: context.fillSoft,
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Cancel')),
              FilledButton(
                  onPressed: controller.text.trim() == answer
                      ? () => Navigator.pop(ctx, true)
                      : null,
                  style: FilledButton.styleFrom(
                      backgroundColor: context.ink,
                      disabledBackgroundColor: context.fillSoft),
                  child: const Text('Delete everything')),
            ],
          ),
        );
      },
    );
    if (solved != true || !context.mounted) return;

    await provider.clearWorkspace();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Workspace deleted.')),
    );
  }

  Widget _caption(BuildContext context, String text) => Padding(
        padding: const EdgeInsets.only(left: 4),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 1.2,
            color: context.inkFaint,
          ),
        ),
      );
}

class _Card extends StatelessWidget {
  final List<Widget> children;

  const _Card({required this.children});

  @override
  Widget build(BuildContext context) {
    // Material (not a painted Container) so ListTile ink splashes stay visible.
    return Material(
      color: context.card,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: context.hairline),
      ),
      child: Column(children: children),
    );
  }
}

/// Segmented System / Light / Dark selector in the app's rounded pill style.
/// The chosen mode persists with the workspace settings and drives the
/// MaterialApp theme live.
class _ThemeModeSelector extends StatelessWidget {
  final String current;

  const _ThemeModeSelector({required this.current});

  static const _options = [
    ('system', 'System'),
    ('light', 'Light'),
    ('dark', 'Dark'),
  ];

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final (mode, label) in _options) ...[
          Expanded(child: _segment(context, mode, label)),
          if (mode != 'dark') const SizedBox(width: 8),
        ],
      ],
    );
  }

  Widget _segment(BuildContext context, String mode, String label) {
    final selected = current == mode;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => context.read<TaskProvider>().setThemeMode(mode),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOutCubic,
        height: 34,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? context.ink : context.fillSoft,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: selected ? context.inkInverse : context.inkSoft,
          ),
        ),
      ),
    );
  }
}
