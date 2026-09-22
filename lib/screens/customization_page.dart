import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../models/workspace_settings.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import 'name_color_dialog.dart';

const _uuid = Uuid();

const _fieldNames = <String, String>{
  'type': 'Task type',
  'date': 'Date',
  'time': 'Time',
  'notes': 'Notes',
  'duration': 'Time needed',
  'difficulty': 'Difficulty',
  'priority': 'Priority',
  'subject': 'Subject',
  'labels': 'Label',
};

const _fieldIcons = <String, IconData>{
  'type': Icons.swap_horiz_rounded,
  'date': Icons.event_outlined,
  'time': Icons.schedule_rounded,
  'notes': Icons.notes_rounded,
  'duration': Icons.timelapse_rounded,
  'difficulty': Icons.speed_rounded,
  'priority': Icons.flag_outlined,
  'subject': Icons.folder_outlined,
  'labels': Icons.sell_outlined,
};

class CustomizationPage extends StatelessWidget {
  const CustomizationPage({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final settings = provider.workspaceSettings;

    return Scaffold(
      backgroundColor: context.bg,
      appBar: AppBar(
        title: const Text('Customize tasks'),
        centerTitle: true,
        backgroundColor: context.bg,
        surfaceTintColor: Colors.transparent,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          _SectionHeading(
            title: 'TASK FORM',
            subtitle: 'Choose what appears when you add or edit a task.',
          ),
          const SizedBox(height: 12),
          _SettingsCard(
            children: [
              for (final id in WorkspaceSettings.defaultFieldOrder)
                _FieldSwitch(
                  icon: _fieldIcons[id]!,
                  title: _fieldNames[id]!,
                  value: settings.isFieldVisible(id),
                  showDivider: id != WorkspaceSettings.defaultFieldOrder.last,
                  onChanged: (value) => _toggleField(provider, id, value),
                ),
            ],
          ),
          const SizedBox(height: 28),
          _SectionHeading(
            title: 'FIELD ORDER',
            subtitle:
                'Hold and drag to choose the order fields appear in the form.',
          ),
          const SizedBox(height: 12),
          _SettingsCard(
            child: _FieldOrderList(settings: settings, provider: provider),
          ),
          const SizedBox(height: 28),
          _SectionHeading(
            title: 'LABELS',
            subtitle: 'Add color-coded labels for grouping tasks.',
            actionLabel: 'Add label',
            onAction: () => _showLabelEditor(context, provider),
          ),
          const SizedBox(height: 12),
          _CollectionCard(
            emptyIcon: Icons.sell_outlined,
            emptyText: 'No labels yet',
            children: settings.labels
                .map((label) => _ColorItem(
                      color: Color(label.colorValue),
                      title: label.name,
                      onTap: () =>
                          _showLabelEditor(context, provider, label: label),
                      onDelete: () => _deleteLabel(provider, label),
                    ))
                .toList(),
          ),
          const SizedBox(height: 28),
          _SectionHeading(
            title: 'SUBJECTS',
            subtitle:
                'Subjects now live on the Subjects tab — each one gets its own space.',
          ),
          const SizedBox(height: 12),
          _SettingsCard(
            children: [
              ListTile(
                leading: Icon(Icons.school_outlined,
                    size: 21, color: context.inkSoft),
                title: const Text('Open the Subjects tab',
                    style:
                        TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                subtitle: Text('Add subjects, folders and notes',
                    style: TextStyle(color: context.inkSoft)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _toggleField(TaskProvider provider, String id, bool value) {
    final settings = provider.workspaceSettings;
    final next = settings.copyWith(
      showTaskType: id == 'type' ? value : null,
      showDate: id == 'date' ? value : null,
      showTime: id == 'time' ? value : null,
      showNotes: id == 'notes' ? value : null,
      showDuration: id == 'duration' ? value : null,
      showDifficulty: id == 'difficulty' ? value : null,
      showPriority: id == 'priority' ? value : null,
      showSubject: id == 'subject' ? value : null,
      showLabels: id == 'labels' ? value : null,
    );
    provider.updateWorkspaceSettings(next);
  }

  void _deleteLabel(TaskProvider provider, TaskLabel label) {
    final labels = provider.workspaceSettings.labels
        .where((item) => item.id != label.id)
        .toList(growable: false);
    provider.updateWorkspaceSettings(
        provider.workspaceSettings.copyWith(labels: labels));
  }

  Future<void> _showLabelEditor(
    BuildContext context,
    TaskProvider provider, {
    TaskLabel? label,
  }) async {
    final result = await showNameAndColorDialog(
      context,
      title: label == null ? 'New label' : 'Edit label',
      hintText: 'Label name',
      initialName: label?.name ?? '',
      initialColor: label == null ? kItemPalette.first : Color(label.colorValue),
    );
    if (result == null) return;

    final current = provider.workspaceSettings;
    final normalizedName = result.$1.toLowerCase();
    final isDuplicate = current.labels.any((item) =>
        item.id != label?.id && item.name.toLowerCase() == normalizedName);
    if (normalizedName == 'general' || isDuplicate) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(normalizedName == 'general'
              ? '“General” is reserved for tasks without a label.'
              : 'A label with that name already exists.'),
        ));
      }
      return;
    }
    final updated = TaskLabel(
      id: label?.id ?? _uuid.v4(),
      name: result.$1,
      colorValue: result.$2.toARGB32(),
    );
    final labels = [...current.labels];
    final index = labels.indexWhere((item) => item.id == updated.id);
    if (index == -1) {
      labels.add(updated);
    } else {
      labels[index] = updated;
    }
    provider.updateWorkspaceSettings(current.copyWith(labels: labels));
  }
}

/// Drag-to-reorder list mirroring the task form's field order.
class _FieldOrderList extends StatelessWidget {
  final WorkspaceSettings settings;
  final TaskProvider provider;

  const _FieldOrderList({required this.settings, required this.provider});

  @override
  Widget build(BuildContext context) {
    final order = [...settings.fieldOrder];
    return ReorderableListView(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      buildDefaultDragHandles: true,
      // onReorderItem hands us an already-adjusted newIndex.
      onReorderItem: (oldIndex, newIndex) {
        final moved = order.removeAt(oldIndex);
        order.insert(newIndex.clamp(0, order.length), moved);
        provider.updateWorkspaceSettings(settings.copyWith(
          fieldOrder: List.unmodifiable(order),
        ));
      },
      proxyDecorator: (child, index, animation) => AnimatedBuilder(
        animation: animation,
        builder: (context, child) => Material(
          color: context.card,
          elevation: 3 * animation.value,
          borderRadius: BorderRadius.circular(14),
          child: child,
        ),
        child: child,
      ),
      children: [
        for (final id in order)
          ListTile(
            key: ValueKey('order-$id'),
            leading: Icon(_fieldIcons[id]!, size: 21, color: context.inkSoft),
            title: Text(_fieldNames[id]!,
                style:
                    const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            trailing: settings.isFieldVisible(id)
                ? null
                : Text('hidden',
                    style: TextStyle(fontSize: 12, color: context.inkFaint)),
          ),
      ],
    );
  }
}

class _SectionHeading extends StatelessWidget {
  final String title;
  final String subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _SectionHeading({
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: TextStyle(
                      fontSize: 11,
                      letterSpacing: 1.1,
                      fontWeight: FontWeight.w800,
                      color: context.inkSoft)),
              const SizedBox(height: 4),
              Text(subtitle,
                  style: TextStyle(fontSize: 13, color: context.inkSoft)),
            ],
          ),
        ),
        if (onAction != null)
          TextButton.icon(
            onPressed: onAction,
            icon: const Icon(Icons.add, size: 18),
            label: Text(actionLabel!),
            style: TextButton.styleFrom(foregroundColor: context.ink),
          ),
      ],
    );
  }
}

class _SettingsCard extends StatelessWidget {
  final List<Widget>? children;
  final Widget? child;

  const _SettingsCard({this.children, this.child});

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
      child: children != null
          ? Column(children: children!)
          : (child ?? const SizedBox.shrink()),
    );
  }
}

class _FieldSwitch extends StatelessWidget {
  final IconData icon;
  final String title;
  final bool value;
  final ValueChanged<bool> onChanged;
  final bool showDivider;

  const _FieldSwitch({
    required this.icon,
    required this.title,
    required this.value,
    required this.onChanged,
    this.showDivider = true,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SwitchListTile.adaptive(
          secondary: Icon(icon, size: 21, color: context.inkSoft),
          title: Text(title,
              style:
                  const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          value: value,
          onChanged: onChanged,
          activeTrackColor: context.ink,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        ),
        if (showDivider)
          Divider(height: 1, indent: 52, color: context.hairline),
      ],
    );
  }
}

class _CollectionCard extends StatelessWidget {
  final List<Widget> children;
  final IconData emptyIcon;
  final String emptyText;

  const _CollectionCard({
    required this.children,
    required this.emptyIcon,
    required this.emptyText,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: context.card,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: context.hairline),
      ),
      child: children.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Column(
                children: [
                  Icon(emptyIcon, color: context.inkFaint),
                  const SizedBox(height: 7),
                  Text(emptyText,
                      style: TextStyle(color: context.inkSoft, fontSize: 13)),
                ],
              ),
            )
          : Column(
              children: [
                for (var i = 0; i < children.length; i++) ...[
                  children[i],
                  if (i != children.length - 1)
                    Divider(height: 1, indent: 52, color: context.hairline),
                ],
              ],
            ),
    );
  }
}

class _ColorItem extends StatelessWidget {
  final Color color;
  final String title;
  final VoidCallback? onTap;
  final VoidCallback onDelete;

  const _ColorItem({
    required this.color,
    required this.title,
    this.onTap,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      leading: Container(
        width: 15,
        height: 15,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
      title: Text(title,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
      trailing: IconButton(
        tooltip: 'Delete',
        onPressed: onDelete,
        icon: Icon(Icons.delete_outline_rounded,
            size: 20, color: context.inkSoft),
      ),
    );
  }
}
