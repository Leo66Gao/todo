"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (route: Route, opts?: { replace?: boolean }) => {
      const href = routeHref(route);
      if (opts?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );
}
