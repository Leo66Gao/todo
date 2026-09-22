import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/project.dart';
import '../screens/settings_page.dart';
import '../screens/subject_workspace_page.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';

/// The wide-screen navigation sidebar.
///
/// Replaces the phone's bottom glass bar and the old floating icon rail with a
/// calm, editorial sidebar: a wordmark, labelled destinations with the
/// selection sliding between them, a "Projects" group, and a profile footer.
class WorkspaceSidebar extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onSelect;

  const WorkspaceSidebar({
    super.key,
    required this.selectedIndex,
    required this.onSelect,
  });

  static const _destinations = [
    (Icons.check_circle_outline, 'Today'),
    (Icons.view_week_outlined, 'Week'),
    (Icons.calendar_month_outlined, 'Calendar'),
    (Icons.school_outlined, 'Assignments'),
    (Icons.auto_stories_outlined, 'Subjects'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 280,
      decoration: BoxDecoration(
        color: context.card.withValues(alpha: 0.4),
        border: Border(
          right: BorderSide(color: context.hairline.withValues(alpha: 0.5), width: 1),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 20),
          _Wordmark(ink: context.ink, soft: context.inkSoft),
          const SizedBox(height: 24),
          ...List.generate(_destinations.length, (i) => _NavItem(
            icon: _destinations[i].$1,
            label: _destinations[i].$2,
            selected: selectedIndex == i,
            onTap: () => onSelect(i),
          )),
          const SizedBox(height: 20),
          const _ProjectsSection(),
          const Spacer(),
          const SizedBox(height: 12),
          _ProfileFooter(provider: context.watch<TaskProvider>()),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  final Color ink;
  final Color soft;
  const _Wordmark({required this.ink, required this.soft});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(11),
            child: Image.asset(
              'assets/logo.png',
              width: 36,
              height: 36,
              filterQuality: FilterQuality.high,
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Todo',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                  color: ink,
                  height: 1.05,
                ),
              ),
              Text(
                'STUDY WORKSPACE',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.6,
                  color: soft,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          curve: Curves.easeOut,
          margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? context.ink : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Icon(
                icon,
                size: 20,
                color: selected ? context.inkInverse : context.ink.withValues(alpha: 0.7),
              ),
              const SizedBox(width: 12),
              Text(
                label,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                  color: selected ? context.inkInverse : context.ink.withValues(alpha: 0.7),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProjectsSection extends StatelessWidget {
  const _ProjectsSection();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final projects = provider.projects;

    if (projects.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 16, bottom: 8, right: 8),
          child: Text(
            'PROJECTS',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.2,
              color: context.inkFaint,
            ),
          ),
        ),
        Flexible(
          child: ListView.builder(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            itemCount: projects.length,
            itemBuilder: (_, i) => _ProjectItem(project: projects[i], provider: provider),
          ),
        ),
      ],
    );
  }
}

class _ProjectItem extends StatelessWidget {
  final Project project;
  final TaskProvider provider;

  const _ProjectItem({required this.project, required this.provider});

  @override
  Widget build(BuildContext context) {
    final colorValue = project.colorValue;
    final accent = colorValue == 0 ? context.inkSoft : Color(colorValue);
    final count = provider
        .getTasksForProject(project.id)
        .where((t) => !t.isDone)
        .length;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => SubjectWorkspacePage(subjectId: project.id),
          ),
        ),
        borderRadius: BorderRadius.circular(10),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 100),
          margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  project.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w500,
                    color: context.ink.withValues(alpha: 0.75),
                  ),
                ),
              ),
              if (count > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '$count',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: accent,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProfileFooter extends StatelessWidget {
  final TaskProvider provider;

  const _ProfileFooter({required this.provider});

  @override
  Widget build(BuildContext context) {
    final user = provider.currentUser;
    final signedIn = user != null;
    final email = user?.email;
    final status = provider.cloudStatus;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 8),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: context.card.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: context.hairline.withValues(alpha: 0.6)),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: context.ink.withValues(alpha: 0.9),
            child: Icon(
              signedIn ? Icons.person : Icons.cloud_off_outlined,
              size: 16,
              color: context.inkInverse,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  signedIn ? email! : 'Local workspace',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.ink,
                  ),
                ),
                Text(
                  signedIn ? status : 'Not signed in',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 10, color: context.inkFaint),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Settings',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SettingsPage()),
            ),
            icon: Icon(Icons.settings_outlined, size: 18, color: context.inkSoft),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
        ],
      ),
    );
  }
}


