import { test, expect } from "@playwright/test";

test("bus candidates retain numeric lines and show stops and live departure countdown", async ({
  page,
  context,
}) => {
  const now = Date.now();
  const time = (seconds: number) =>
    new Date(now + seconds * 1000).toISOString();
  const origin = { lat: 35.68, lng: 139.76 },
    destination = { lat: 35.69, lng: 139.76 };
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: origin.lat,
    longitude: origin.lng,
    accuracy: 5,
  });
  await page.route("https://worker.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/pair")
      return route.fulfill({
        json: {
          deviceToken: "synthetic-bus-device-token",
          expiresAt: time(86400),
        },
      });
    if (path === "/v1/providers")
      return route.fulfill({ json: { google: { configured: true } } });
    if (path === "/v1/routes/transit")
      return route.fulfill({
        json: {
          requestVersion: route.request().postDataJSON().requestVersion,
          routes: [
            {
              id: "synthetic-bus",
              provider: "TRANSITOUS",
              basemapProvider: "GOOGLE_TILES",
              fetchedAt: time(0),
              expiresAt: time(3600),
              distanceMeters: 1100,
              durationSeconds: 900,
              warnings: [],
              attribution: ["Synthetic bus"],
              legs: [
                {
                  mode: "WAIT",
                  transitMode: "BUS",
                  line: "１２",
                  from: "合成起点站",
                  headsign: "合成总站",
                  geometry: [origin],
                  steps: [],
                  distanceMeters: 0,
                  durationSeconds: 300,
                  startTime: time(0),
                  endTime: time(300),
                },
                {
                  mode: "RIDE",
                  transitMode: "BUS",
                  line: "１２",
                  headsign: "合成总站",
                  from: "合成起点站",
                  to: "合成终点站",
                  geometry: [origin, destination],
                  steps: [],
                  distanceMeters: 1100,
                  durationSeconds: 600,
                  startTime: time(300),
                  endTime: time(900),
                  fromStop: {
                    name: "合成起点站",
                    coordinate: origin,
                    departureTime: time(300),
                  },
                  toStop: {
                    name: "合成终点站",
                    coordinate: destination,
                    arrivalTime: time(900),
                  },
                  intermediateStops: [
                    { name: "合成中途站", arrivalTime: time(600) },
                  ],
                },
              ],
            },
          ],
        },
      });
    return route.fulfill({
      status: 503,
      json: { error: { code: "CONFIG_MISSING" } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("Worker 首次配对凭据").fill("synthetic-owner");
  await page.getByRole("button", { name: "首次配对并连接" }).click();
  await expect(page.getByText("后端已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "启用浏览器开发定位" }).click();
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill(
      `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=transit`,
    );
  await page.getByRole("button", { name: /导入链接/ }).click();
  await page.getByRole("button", { name: "公共交通", exact: true }).click();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  const summary = page.locator("#route-summary");
  await expect(summary).toContainText("乘坐 公交 12 · 往合成总站");
  await expect(summary).toContainText("合成中途站");
  await expect(summary).toContainText("出发");
  await expect(summary).not.toContainText("站台");
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  await expect(page.locator("#nav-current-text")).toHaveText("候车 公交 12");
  await expect(page.locator("#nav-departure")).toContainText(
    "下一班 公交 12 · 往合成总站",
  );
  await expect(page.locator("#nav-departure")).toContainText("时刻表发车");
  await expect(page.locator("#nav-departure")).toContainText(/\d+分\d+秒/);
  await expect(page.locator("#nav-access")).toBeHidden();
});
