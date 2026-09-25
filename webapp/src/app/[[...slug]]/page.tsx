// Every route renders the same persistent client shell (see layout.tsx);
// pages exist only so each URL has a static HTML entry point.
export const dynamicParams = false;

export function generateStaticParams() {
  return [
    { slug: [] },
    ...["week", "calendar", "assignments", "assignment", "subjects", "subject", "notes", "note", "settings"].map(
      (s) => ({ slug: [s] }),
    ),
  ];
}

export default function Page() {
  return null;
}
