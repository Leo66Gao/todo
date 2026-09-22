bool sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

DateTime dayKey(DateTime d) => DateTime(d.year, d.month, d.day);
