import { test } from "node:test";
import assert from "node:assert/strict";
import { isInAppUrl, isAppPage, externalUrl, shortcutUrl, START_URL } from "../electron/security.mjs";

test("the till and its login stay inside the window", () => {
  for (const u of [START_URL, "https://caisse.bzh/app/fiscal?ticket=3", "https://www.caisse.bzh/", "https://auth.1clic.pro/oauth2/authorize?x=1"]) assert.ok(isInAppUrl(u), u);
});
test("anything else never loads in the window", () => {
  for (const u of ["http://caisse.bzh/", "https://caisse.bzh.evil.com/", "https://evil.com/?https://caisse.bzh", "https://user:pw@caisse.bzh/", "https://caisse.bzh:8443/", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "not a url"]) assert.equal(isInAppUrl(u), false, u);
});
test("only caisse.bzh pages may call the desktop bridge", () => {
  assert.ok(isAppPage("https://caisse.bzh/app/pos"));
  assert.equal(isAppPage("https://auth.1clic.pro/login"), false);
  assert.equal(isAppPage("file:///x/offline.html"), false);
});
test("external links: https, mailto and tel only", () => {
  assert.equal(externalUrl("https://inklura.fr/"), "https://inklura.fr/");
  assert.equal(externalUrl("mailto:bonjour@caisse.bzh"), "mailto:bonjour@caisse.bzh");
  assert.equal(externalUrl("tel:+33298000000"), "tel:+33298000000");
  for (const u of ["file:///etc/passwd", "smb://x/y", "javascript:alert(1)", "https://a:b@x.com"]) assert.equal(externalUrl(u), null, u);
});
test("menu shortcuts resolve to caisse.bzh pages", () => {
  assert.equal(shortcutUrl("cuisine"), "https://caisse.bzh/app/pos/kitchen");
  assert.equal(shortcutUrl("nope"), null);
});
