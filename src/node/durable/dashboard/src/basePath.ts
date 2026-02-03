function normalizeBasePath(pathname: string): string {
  if (pathname === "/") return "";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * The dashboard can be mounted under any URL prefix via Express:
 * `app.use("/my-prefix", createDashboardMiddleware(...))`.
 *
 * The server injects a `<base href="...">` tag into `index.html` at runtime,
 * allowing the UI to determine the mount path and to keep deep-links working.
 */
export function getDashboardBasePath(): string {
  const base = document.querySelector("base");
  const href = base?.getAttribute("href");
  if (!href) return "";

  try {
    const url = new URL(href, window.location.origin);
    return normalizeBasePath(url.pathname);
  } catch {
    return "";
  }
}
