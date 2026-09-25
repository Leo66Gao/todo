import type { Modifier } from "@dnd-kit/core";

/** Keeps a dragged row on its column (the task-form field list). */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
