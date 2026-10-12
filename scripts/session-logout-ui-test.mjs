/** Actual Stock Entry/sidebar components; synthetic backend, no live writes/login. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/session-logout");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "labels-first-stock-entry-vite-cache"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: "@/integrations/lovable/index", replacement: path.join(fixture, "lovable.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5196, strictPort: true, fs: { allow: [process.cwd()] } },
});
let browser;
let checks = 0;
const errors = [];
const check = (value, label) => {
  assert(value, label);
  checks++;
};

try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5196");
  await page.getByRole("heading", { name: "Stock workspace fixture", exact: true }).waitFor();
  check(
    await page.getByRole("link", { name: "Stock Entry", exact: true }).isVisible(),
    "Stock role loads initially",
  );
  await page.evaluate(() => window.logoutControls.refreshToken());
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).roles.includes("stock_entry"),
    "Token refresh retains current verified role",
  );
  await page.evaluate(() => {
    window.seedCache();
    window.startPrivateQuery();
    window.logoutControls.holdBootstrap();
  });
  await page.getByRole("button", { name: "Refresh access fixture", exact: true }).click();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Sign out", exact: true })
    .click({ noWaitAfter: true, timeout: 5000 });
  await page
    .getByRole("heading", { name: "Staff sign in", exact: true })
    .waitFor({ timeout: 3000 });
  check(
    !(await page.getByRole("link", { name: "Stock Entry", exact: true }).count()),
    "Old sidebar disappears before remote logout finishes",
  );
  check(
    (await page.evaluate(() => window.readCache())) === null,
    "Private cache cleared immediately",
  );
  check(
    await page.getByRole("button", { name: "Sign in", exact: true }).isDisabled(),
    "New login cannot race in-flight old logout",
  );
  const state = JSON.parse(await page.getByTestId("session-state").innerText());
  check(
    state.userId === null && state.roles.length === 0 && state.permissions.length === 0,
    "User roles and permissions clear immediately",
  );
  await page.evaluate(() => {
    window.logoutControls.releaseBootstrap();
    window.releasePrivate();
    window.dispatchEvent(new Event("focus"));
  });
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).userId === null,
    "Old access reply cannot resurrect session",
  );
  await page.evaluate(() => window.logoutControls.finishLogout());
  await page.getByText("Finishing sign-out...", { exact: true }).waitFor({ state: "hidden" });
  check(
    await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(),
    "Verified local removal enables login",
  );
  check(
    (await page.evaluate(() => window.readLateCache())) === null,
    "Late query does not repopulate cleared private cache",
  );
  await page.getByLabel("Email", { exact: true }).fill("counter@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Counter workspace fixture", exact: true }).waitFor();
  check(
    (await page.getByRole("link", { name: "Counter / POS", exact: true }).isVisible()) &&
      !(await page.getByRole("link", { name: "Stock Entry", exact: true }).count()),
    "New role gets its own sidebar without reload",
  );
  await page.evaluate(() => window.logoutControls.foreignEvent());
  await page.getByRole("heading", { name: "Counter workspace fixture", exact: true }).waitFor();
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).userId === "counter",
    "Delayed foreign event reads canonical session rather than replacing current identity",
  );
  await page.evaluate(() => window.logoutControls.staleSignIn());
  await page.getByRole("heading", { name: "Counter workspace fixture", exact: true }).waitFor();
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).roles.includes("counter"),
    "Late old-token sign-in cannot replace new user",
  );
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Staff sign in", exact: true }).waitFor();
  await page.evaluate(() => window.logoutControls.finishLogout("retain"));
  await page.getByRole("button", { name: "Retry sign-out", exact: true }).waitFor();
  check(
    await page.getByRole("button", { name: "Sign in", exact: true }).isDisabled(),
    "Unconfirmed local removal blocks account switch",
  );
  await page.evaluate(() => {
    window.logoutControls.staleSignIn();
    window.dispatchEvent(new Event("focus"));
  });
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).userId === null,
    "Old token/focus cannot restore failed logout role",
  );
  await page.getByRole("button", { name: "Retry sign-out", exact: true }).click();
  await page.evaluate(() => window.logoutControls.finishLogout("remote_error"));
  await page
    .getByRole("button", { name: "Retry sign-out", exact: true })
    .waitFor({ state: "hidden" });
  check(
    await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(),
    "Remote revoke failure with cleared local session is handled",
  );
  await page.evaluate(() => window.logoutControls.holdProfile());
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Owner workspace fixture", exact: true }).waitFor();
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).loading === false,
    "Verified roles render before slow profile lookup",
  );
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).roles.includes("owner"),
    "Owner login after failed/retried logout without reload",
  );
  await page.evaluate(() => window.logoutControls.externalSignOut());
  await page.getByRole("heading", { name: "Staff sign in", exact: true }).waitFor();
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).roles.length === 0,
    "External signed-out event clears immediately",
  );
  await page.evaluate(() => window.logoutControls.releaseProfile());
  check(
    JSON.parse(await page.getByTestId("session-state").innerText()).fullName === "Staff",
    "Late profile response cannot restore previous identity",
  );
  const timeout = await page.evaluate(() => window.timeoutCheck());
  check(timeout.aborted, "Logout HTTP timeout aborts hanging revoke");
  check(timeout.sameSignal, "Other requests retain their original cancellation signal");
  check(timeout.callerCancelled, "Logout timeout preserves caller cancellation");
  check(timeout.bodyAborted, "Logout timeout also bounds a stalled response body");
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/SESSION_LOGOUT_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, passed: true, errors },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks} session/logout browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
