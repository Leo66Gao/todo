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
    final provider = context.watch<TaskProvider>();
    final projects = provider.projects;
    final user = provider.currentUser;

    return SizedBox(
      width: 284,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 22, 14, 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Wordmark(ink: context.ink, soft: context.inkSoft),
            const SizedBox(height: 30),
            for (var i = 0; i < _destinations.length; i++)
              _NavItem(
                icon: _destinations[i].$1,
                label: _destinations[i].$2,
                selected: selectedIndex == i,
                onTap: () => onSelect(i),
              ),
            const SizedBox(height: 28),
            if (projects.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.only(left: 14, bottom: 10),
                child: Text(
                  'PROJECTS',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.4,
                    color: context.inkFaint,
                  ),
                ),
              ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  padding: EdgeInsets.zero,
                  children: [
                    for (final project in projects)
                      _ProjectItem(project: project, provider: provider),
                  ],
                ),
              ),
            ] else
              const Spacer(),
            const SizedBox(height: 12),
            _ProfileFooter(
              email: user?.email,
              status: provider.cloudStatus,
              onSettings: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const SettingsPage()),
              ),
            ),
          ],
        ),
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

class _NavItem extends StatefulWidget {
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
  State<_NavItem> createState() => _NavItemState();
}

class _NavItemState extends State<_NavItem> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final engaged = widget.selected || _hover;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOutCubic,
          margin: const EdgeInsets.symmetric(vertical: 2),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
          decoration: BoxDecoration(
            color: widget.selected
                ? context.ink
                : _hover
                    ? context.fillSoft
                    : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
            // A faint shadow on the selected destination lifts it off the
            // sidebar, so the active item reads as glass rather than flat ink.
            boxShadow: widget.selected
                ? [
                    BoxShadow(
                      color: context.ink.withValues(alpha: 0.16),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Row(
            children: [
              Icon(
                widget.icon,
                size: 19,
                color: widget.selected
                    ? context.inkInverse
                    : context.ink.withValues(alpha: engaged ? 1 : 0.6),
              ),
              const SizedBox(width: 12),
              Text(
                widget.label,
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight:
                      widget.selected ? FontWeight.w600 : FontWeight.w500,
                  color: widget.selected
                      ? context.inkInverse
                      : context.ink.withValues(alpha: engaged ? 1 : 0.66),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProjectItem extends StatefulWidget {
  final Project project;
  final TaskProvider provider;

  const _ProjectItem({required this.project, required this.provider});

  @override
  State<_ProjectItem> createState() => _ProjectItemState();
}

class _ProjectItemState extends State<_ProjectItem> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final colorValue = widget.project.colorValue;
    final accent = colorValue == 0 ? context.inkSoft : Color(colorValue);
    final count = widget.provider
        .getTasksForProject(widget.project.id)
        .where((t) => !t.isDone)
        .length;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => SubjectWorkspacePage(subjectId: widget.project.id),
          ),
        ),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          margin: const EdgeInsets.symmetric(vertical: 1),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: _hover ? context.fillSoft : Colors.transparent,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Row(
            children: [
              Container(
                width: 9,
                height: 9,
                decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  widget.project.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: context.ink.withValues(alpha: _hover ? 1 : 0.74),
                  ),
                ),
              ),
              if (count > 0)
                Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.inkFaint,
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
  final String? email;
  final String status;
  final VoidCallback onSettings;

  const _ProfileFooter({
    required this.email,
    required this.status,
    required this.onSettings,
  });

  @override
  Widget build(BuildContext context) {
    final signedIn = email != null;
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: context.card.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: context.hairline),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 17,
            backgroundColor: context.ink,
            child: Icon(
              signedIn ? Icons.person : Icons.cloud_off_outlined,
              size: 17,
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
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: context.ink,
                  ),
                ),
                Text(
                  signedIn ? status : 'Not signed in',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 10.5, color: context.inkFaint),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Settings',
            onPressed: onSettings,
            icon: Icon(Icons.settings_outlined, size: 19, color: context.inkSoft),
          ),
        ],
      ),
    );
  }
}


