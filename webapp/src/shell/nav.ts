"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export type Route =
  | { view: "today" }
  | { view: "week" }
  | { view: "calendar" }
  | { view: "assignments" }
  | { view: "assignment"; id: string }
  | { view: "subjects" }
  | { view: "subject"; id: string }
  | { view: "notes" }
  | { view: "note"; id: string }
  | { view: "settings" };

export function parseRoute(pathname: string, params: URLSearchParams): Route {
  const seg = pathname.replace(/^\/+|\/+$/g, "").split("/")[0].replace(/\.html$/, "");
  const id = params.get("id");
  switch (seg) {
    case "week":
    case "calendar":
    case "assignments":
    case "subjects":
    case "notes":
    case "settings":
      return { view: seg };
    case "assignment":
    case "subject":
    case "note":
      return id ? { view: seg, id } : { view: seg === "note" ? "notes" : `${seg}s` as "subjects" };
    default:
      return { view: "today" };
  }
}

export function routeHref(route: Route): string {
  switch (route.view) {
    case "today":
      return "/";
    case "assignment":
    case "subject":
    case "note":
      return `/${route.view}?id=${encodeURIComponent(route.id)}`;
    default:
      return `/${route.view}`;
  }
}

export function useRoute(): Route {
  const pathname = usePathname();
  const params = useSearchParams();
  return parseRoute(pathname ?? "/", new URLSearchParams(params?.toString() ?? ""));
}

/**
 * Every route renders the same client shell, so switching views only needs a
 * URL change. The native history API updates `usePathname` synchronously
 * without the router fetching the next page's payload, which otherwise stalls
 * a navigation whenever the prefetch cache has gone stale.
 */
export function useNavigate() {
  return useCallback((route: Route, opts?: { replace?: boolean }) => {
    const href = routeHref(route);
    if (href === window.location.pathname + window.location.search) return;
    if (opts?.replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
  }, []);
}
