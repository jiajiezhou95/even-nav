import { expect, test } from "@playwright/test";

test("app accepts Maps links only and always plans from current phone location", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 35.6812,
    longitude: 139.7671,
    accuracy: 5,
  });
  const calls: string[] = [];
  const trips: Record<string, unknown>[] = [];
  await page.route("https://worker.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === "/v1/auth/pair")
      return route.fulfill({
        json: {
          deviceToken: "synthetic-paste-only-token",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      });
    if (path === "/v1/providers")
      return route.fulfill({ json: { google: { configured: true } } });
    if (path === "/v1/routes/road" || path === "/v1/routes/transit") {
      trips.push(route.request().postDataJSON());
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: "Synthetic route boundary reached",
          },
        },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { code: "CONFIG_MISSING" } },
    });
  });
  await page.goto("/");
  await expect(
    page.locator(
      "#manual, #manual-button, #manual-input, #pick-button, #origin",
    ),
  ).toHaveCount(0);
  for (const input of ["35.7, 139.8", "Synthetic Street 123"]) {
    await page.getByLabel("GOOGLE MAPS 分享链接").fill(input);
    await page.getByRole("button", { name: /导入链接/ }).click();
    await expect(page.getByRole("alert")).toContainText("请粘贴 Google Maps");
    await expect(page.locator(".confirmation")).toHaveCount(0);
  }
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByLabel("Worker 首次配对凭据")
    .fill("synthetic-owner-paste-only");
  await page.getByRole("button", { name: "首次配对并连接" }).click();
  await expect(page.getByText("后端已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "启用浏览器开发定位" }).click();
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill(
      "目的地分享 https://www.google.com/maps/dir/?api=1&origin=34.0,135.0&destination=35.6822,139.7691&travelmode=transit",
    );
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(page.getByText("35.682200, 139.769100")).toBeVisible();
  await expect(
    page.getByText("起点：当前手机位置", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#origin")).toHaveCount(0);
  await expect(page.locator("#departure")).toBeVisible();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  await expect.poll(() => trips.length).toBe(1);
  expect(trips[0]).toMatchObject({
    origin: { lat: 35.6812, lng: 139.7671 },
    originPolicy: "CURRENT_DEVICE_LOCATION",
    mode: "TRANSIT",
    destination: { coordinate: { lat: 35.6822, lng: 139.7691 } },
  });
  expect(calls).not.toContain("/v1/destinations/resolve");
});
