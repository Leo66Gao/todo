// Unknown addresses open Today: the shell (in the root layout) reads the
// address itself. This replaces Next's default 404 page, whose inline styles
// (black text, or white with the system in dark mode) were loaded on every
// page and overrode the app's own text colour.
export default function NotFound() {
  return null;
}
