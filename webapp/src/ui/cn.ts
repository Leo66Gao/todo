export const cn = (...classes: (string | false | null | undefined | 0)[]) =>
  classes.filter(Boolean).join(" ");
