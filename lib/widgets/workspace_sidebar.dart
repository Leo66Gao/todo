import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/project.dart';
import '../screens/settings_page.dart';
import '../screens/subject_workspace_page.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';

/// Navigation for wide browser windows. Sync activity only rebuilds the
/// projects and account areas, leaving destination previews responsive.
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    return SizedBox(
      width: 284,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: dark ? const Color(0xFF14161B) : const Color(0xFFFDFDFE),
          border: Border(right: BorderSide(color: context.hairline)),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 16, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Wordmark(ink: context.ink, soft: context.inkSoft),
              Expanded(
                child: CustomScrollView(
                  slivers: [
                    SliverToBoxAdapter(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(height: 24),
                          Divider(height: 1, color: context.hairline),
                          const SizedBox(height: 22),
                          const _SectionLabel('OVERVIEW'),
                          const SizedBox(height: 8),
                          for (var i = 0; i < _destinations.length; i++)
                            _NavItem(
                              icon: _destinations[i].$1,
                              label: _destinations[i].$2,
                              selected: selectedIndex == i,
                              onTap: () {
                                if (selectedIndex != i) onSelect(i);
                              },
                            ),
                          const SizedBox(height: 20),
                          const _SectionLabel('PROJECTS'),
                          const SizedBox(height: 8),
                        ],
                      ),
                    ),
                    const _ProjectsList(),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Divider(height: 1, color: context.hairline),
              const SizedBox(height: 12),
              _AccountFooter(
                onSettings: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const SettingsPage()),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String label;
  const _SectionLabel(this.label);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(left: 14),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.5,
            color: context.inkFaint,
          ),
        ),
      );
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    final accent = dark ? const Color(0xFFB8CDE1) : const Color(0xFF41617E);
    final foreground =
        widget.selected || _hover ? context.ink : context.inkSoft;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Semantics(
        selected: widget.selected,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: widget.onTap,
            onHover: (hover) => setState(() => _hover = hover),
            hoverColor: Colors.transparent,
            splashFactory: NoSplash.splashFactory,
            child: Ink(
              height: 44,
              decoration: BoxDecoration(
                color: widget.selected
                    ? (dark ? const Color(0xFF272D36) : const Color(0xFFE8EFF7))
                    : _hover
                        ? (dark
                            ? const Color(0xFF20242B)
                            : const Color(0xFFF1F4F8))
                        : Colors.transparent,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Container(
                    width: 3,
                    height: 20,
                    decoration: BoxDecoration(
                      color: widget.selected ? accent : Colors.transparent,
                      borderRadius: const BorderRadius.horizontal(
                        right: Radius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(width: 13),
                  Icon(widget.icon, size: 19, color: foreground),
                  const SizedBox(width: 12),
                  Text(
                    widget.label,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight:
                          widget.selected ? FontWeight.w600 : FontWeight.w500,
                      color: foreground,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ProjectsList extends StatelessWidget {
  const _ProjectsList();

  @override
  Widget build(BuildContext context) => Consumer<TaskProvider>(
        builder: (context, provider, _) {
          final projects = provider.projects;
          final counts = <String, int>{};
          for (final task in provider.tasks) {
            if (!task.isDone && task.projectId != null) {
              counts.update(
                task.projectId!,
                (count) => count + 1,
                ifAbsent: () => 1,
              );
            }
          }
          return SliverList.builder(
            itemCount: projects.length,
            itemBuilder: (context, index) {
              final project = projects[index];
              return _ProjectItem(
                key: ValueKey(project.id),
                project: project,
                count: counts[project.id] ?? 0,
              );
            },
          );
        },
      );
}

class _ProjectItem extends StatefulWidget {
  final Project project;
  final int count;

  const _ProjectItem({super.key, required this.project, required this.count});

  @override
  State<_ProjectItem> createState() => _ProjectItemState();
}

class _ProjectItemState extends State<_ProjectItem> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final colorValue = widget.project.colorValue;
    final accent = colorValue == 0 ? context.inkSoft : Color(colorValue);
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(11),
          onHover: (hover) => setState(() => _hover = hover),
          hoverColor: Colors.transparent,
          splashFactory: NoSplash.splashFactory,
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) =>
                  SubjectWorkspacePage(subjectId: widget.project.id),
            ),
          ),
          child: Ink(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: 15),
            decoration: BoxDecoration(
              color: _hover
                  ? (dark ? const Color(0xFF20242B) : const Color(0xFFF1F4F8))
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Row(
              children: [
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: accent,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    widget.project.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w500,
                      color: _hover ? context.ink : context.inkSoft,
                    ),
                  ),
                ),
                if (widget.count > 0)
                  Container(
                    constraints: const BoxConstraints(minWidth: 22),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: dark
                          ? const Color(0xFF292D35)
                          : const Color(0xFFF0F2F5),
                      borderRadius: BorderRadius.circular(7),
                    ),
                    child: Text(
                      '${widget.count}',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: context.inkSoft,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AccountFooter extends StatelessWidget {
  final VoidCallback onSettings;
  const _AccountFooter({required this.onSettings});

  @override
  Widget build(BuildContext context) {
    final account = context.select<TaskProvider, (String?, String)>(
      (provider) => (provider.currentUser?.email, provider.cloudStatus),
    );
    return _ProfileFooter(
      email: account.$1,
      status: account.$2,
      onSettings: onSettings,
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Material(
      color: Colors.transparent,
      child: Tooltip(
        message: 'Settings',
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onSettings,
          child: Ink(
            padding: const EdgeInsets.fromLTRB(10, 9, 8, 9),
            decoration: BoxDecoration(
              color: dark ? const Color(0xFF1C1F25) : const Color(0xFFF4F6F9),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: context.hairline),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor:
                      dark ? const Color(0xFF303946) : const Color(0xFFE1EAF3),
                  child: Icon(
                    signedIn ? Icons.person_outline : Icons.cloud_off_outlined,
                    size: 16,
                    color: context.ink,
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
                        style:
                            TextStyle(fontSize: 10.5, color: context.inkSoft),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.settings_outlined, size: 18, color: context.inkSoft),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
