"use strict";
// Platform-level smoke: the app SHELL renders after login, and unknown routes hit the 404 page we built.
// Module-specific coverage (the map itself) lives in modules/participation_maps/e2e/.
const { test, expect } = require("@playwright/test");

test("home shell renders after login", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
  await expect(page.locator(".app-header h1")).toHaveText("USAT Apps");
  await expect(page.locator(".siderail")).toBeVisible();
});

test("unknown route shows the in-shell 404 page", async ({ page }) => {
  await page.goto("/definitely-not-a-real-route");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.locator(".state-code")).toHaveText("404");
  // still inside the shell (header present) so the user can navigate away
  await expect(page.locator(".app-header")).toBeVisible();
});
