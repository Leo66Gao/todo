class Project {
  String id;
  String title;
  int colorValue;

  Project({required this.id, required this.title, required this.colorValue});

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'colorValue': colorValue,
      };

  factory Project.fromJson(Map<String, dynamic> json) {
    return Project(
      id: json['id'],
      title: json['title'],
      colorValue: json['colorValue'],
    );
  }
}
