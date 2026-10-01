// security.mjs — which URLs may load INSIDE the caisse.bzh window.
// The window is a thin shell around https://caisse.bzh; its SSO pages live on
// auth.1clic.pro. Anything else opens in the system browser (https / mailto / tel only).

export const APP_ORIGIN = "https://caisse.bzh";
export const START_URL = APP_ORIGIN + "/app/pos";

const IN_APP_HOSTS = new Set(["caisse.bzh", "www.caisse.bzh", "auth.1clic.pro"]);

function parse(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

// Navigation allowed inside the app window.
export function isInAppUrl(value) {
  const u = parse(value);
  return !!u && u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && IN_APP_HOSTS.has(u.hostname);
}

// A caisse.bzh page (IPC bridge callers must be one of these).
export function isAppPage(value) {
  const u = parse(value);
  return !!u && u.protocol === "https:" && (u.hostname === "caisse.bzh" || u.hostname === "www.caisse.bzh") && !u.username && !u.password;
}

// Safe URL to hand to the OS (default browser / mail client), or null.
export function externalUrl(value) {
  const u = parse(value);
  if (!u || u.username || u.password) return null;
  return ["https:", "mailto:", "tel:"].includes(u.protocol) ? u.href : null;
}

// Web permissions granted to caisse.bzh pages: copying a link or a code (the
// « Copier » buttons) and the page's own fullscreen button. Everything else
// (camera, microphone, location, notifications…) stays refused.
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);
export function permissionAllowed(permission, origin) {
  return ALLOWED_PERMISSIONS.has(permission) && isAppPage(origin);
}

// Shortcuts of the app menu → in-app paths.
export const SHORTCUTS = {
  caisse: "/app/pos",
  cuisine: "/app/pos/kitchen",
  tableau: "/app",
  fiscal: "/app/fiscal",
  aide: "/aide",
};
export function shortcutUrl(name) {
  const p = SHORTCUTS[name];
  return p ? APP_ORIGIN + p : null;
}

// Page a till opens on (a kitchen screen opens on Cuisine).
export const START_PAGES = ["caisse", "cuisine", "tableau"];
export function startUrl(name) {
  return START_PAGES.includes(name) ? shortcutUrl(name) : START_URL;
}
