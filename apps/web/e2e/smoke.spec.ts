import { expect, test } from "@playwright/test";

// Exercises the authenticated owner flow end-to-end against a real DB + network:
// dev sign-in -> create a trust center -> land on the builder Home.
test("owner can sign in and create a trust center", async ({ page }) => {
  const email = `e2e+${Date.now()}@example.com`;

  await page.goto("/login");
  // The dev-login form (enabled via AUTH_DEV_LOGIN=1 + AUTH_DEV_LOGIN_ALLOW_PROD=1).
  await page.getByLabel(/Email \(dev login\)/i).fill(email);
  await page.getByRole("button", { name: /^Continue/ }).click();

  await page.waitForURL("**/dashboard");
  // A brand-new account has no trust centers yet: the dashboard shows the
  // empty-state that guides first-time creation.
  await expect(
    page.getByRole("heading", { name: "Create your first trust center", exact: true }),
  ).toBeVisible();

  // Creation happens in a modal: open it, then fill the form.
  await page.getByRole("button", { name: /New trust center/i }).first().click();

  const company = `E2E Co ${Date.now()}`;
  await page.getByLabel(/Legal name/i).fill(company);
  await page.getByRole("button", { name: /Create trust center/i }).click();

  // Lands on the builder for the new trust center; its name is the page heading.
  await page.waitForURL("**/tc/**");
  await expect(page.getByRole("heading", { name: company })).toBeVisible();

  // Guided setup is reachable.
  await page.goto(page.url().replace(/\/tc\/([^/]+).*/, "/tc/$1/setup"));
  await expect(page.getByRole("heading", { name: /Guided setup/i })).toBeVisible();
});
