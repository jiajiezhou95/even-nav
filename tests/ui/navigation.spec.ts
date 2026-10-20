import { test, expect, type Page } from "@playwright/test";

const link =
  "https://www.google.com/maps/dir/?api=1&origin=34.0,135.0&destination=35.6822,139.7691&travelmode=walking";
async function configure(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("Worker 访问凭据").fill("test-session-token");
  await page.getByRole("button", { name: "连接并检查服务" }).click();
  await expect(page.getByText("后端已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "启用浏览器开发定位" }).click();
}
test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 35.6812,
    longitude: 139.7671,
    accuracy: 5,
  });
  await page.route("https://worker.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/providers")
      return route.fulfill({ json: { google: { configured: true } } });
    if (path.includes("/maps/"))
      return route.fulfill({
        status: 503,
        json: { error: { code: "CONFIG_MISSING" } },
      });
    if (path === "/v1/routes/road") {
      const request = route.request().postDataJSON();
      return route.fulfill({
        json: {
          requestVersion: request.requestVersion,
          routes: [
            {
              id: "synthetic-road",
              provider: "GOOGLE_ROUTES",
              basemapProvider: "GOOGLE_TILES",
              fetchedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 600000).toISOString(),
              distanceMeters: 230,
              durationSeconds: 180,
              warnings: ["合成测试路线，仅用于 UI MOCK_HTTP"],
              attribution: ["Google Maps"],
              legs: [
                {
                  mode: request.mode,
                  distanceMeters: 230,
                  durationSeconds: 180,
                  geometry: [request.origin, request.destination.coordinate],
                  steps: [
                    {
                      instruction: "沿道路前行",
                      geometry: [
                        request.origin,
                        request.destination.coordinate,
                      ],
                      distanceMeters: 230,
                      durationSeconds: 180,
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { code: "PROVIDER_UNAVAILABLE" } },
    });
  });
  await page.goto("/");
});
test("paste-first native input works without clipboard and coordinates require no provider call", async ({
  page,
}) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("worker.test")) apiCalls.push(request.url());
  });
  await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(
    page.getByText(
      "已导入目的地。本插件会重新计算路线，可能与 Google Maps 中选择的路线不同。",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("起点")).toHaveValue("current");
  await expect(page.getByText("35.682200, 139.769100")).toBeVisible();
  expect(apiCalls).toEqual([]);
  await page.screenshot({
    path: ".local/evidence/ui-confirmation.png",
    fullPage: true,
  });
});
test("multiple links fail visibly; manual coordinate fallback recovers", async ({
  page,
}) => {
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill(`${link}\nhttps://www.google.com/maps/search/?api=1&query=35,139`);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(page.getByRole("alert")).toContainText("多个 Maps 链接");
  await page.getByRole("button", { name: /输入地址/ }).click();
  await page.getByLabel("完整地址或 纬度, 经度").fill("35.7, 139.8");
  await page.getByRole("button", { name: "确认输入" }).click();
  await expect(page.getByText("35.700000, 139.800000")).toBeVisible();
});
test("actual returned route is explicitly selected and uses current GPS, with pause/resume/end", async ({
  page,
}) => {
  await configure(page);
  await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
  await page.getByRole("button", { name: /导入链接/ }).click();
  const requestPromise = page.waitForRequest(
    "https://worker.test/v1/routes/road",
  );
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  const request = (await requestPromise).postDataJSON();
  expect(request.origin).toEqual({ lat: 35.6812, lng: 139.7671 });
  expect(request.originPolicy).toBe("CURRENT_DEVICE_LOCATION");
  await expect(page.locator(".route-card")).toHaveCount(1);
  await expect(
    page.getByText("合成测试路线，仅用于 UI MOCK_HTTP"),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  await expect(page.getByRole("heading", { name: "沿道路前行" })).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByRole("heading", { name: "导航已暂停" })).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "沿道路前行" })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.getByRole("button", { name: "结束", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "本次导航已结束" }),
  ).toBeVisible();
});
test("backend failure is finite and explains recovery", async ({ page }) => {
  await configure(page);
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill("https://maps.app.goo.gl/SyntheticTestLink");
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(page.getByRole("alert")).toContainText("服务暂不可用");
  await expect(page.getByRole("button", { name: /导入链接/ })).toBeVisible();
});
test("new input cancels in-flight short-link resolution and old response cannot replace it", async ({
  page,
}) => {
  await configure(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("https://worker.test/v1/import/resolve", async (route) => {
    await held;
    await route
      .fulfill({
        json: {
          importId: "old",
          sourceKind: "COORDINATES",
          destinationCandidates: [
            {
              coordinate: { lat: 30, lng: 130 },
              evidence: "USER_INPUT",
              source: "USER_INDEPENDENT_INPUT",
              extractedFrom: "mock",
              coordinateRole: "ENDPOINT",
            },
          ],
          waypoints: [],
          warnings: [],
          selectedGoogleItineraryImported: false,
        },
      })
      .catch(() => {});
  });
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill("https://maps.app.goo.gl/SyntheticDelayed");
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeVisible();
  await page.getByLabel("GOOGLE MAPS 分享链接").fill("35.9, 139.9");
  await page.getByRole("button", { name: /导入链接/ }).click();
  release();
  await expect(page.getByText("35.900000, 139.900000")).toBeVisible();
  await expect(page.getByText("30.000000, 130.000000")).toHaveCount(0);
});
test("real renderer uses encoded PNG, retains only active viewport and preserves Google map-pick provenance", async ({
  page,
}) => {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#eeeeee";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#777777";
    ctx.fillRect(0, 100, 256, 12);
    ctx.fillRect(90, 0, 12, 256);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  let tileRequests = 0;
  await page.route("https://worker.test/v1/maps/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          session: "synthetic",
          expiry: String(Math.floor(Date.now() / 1000) + 600),
          tileWidth: 256,
          tileHeight: 256,
        },
      });
    if (path.endsWith("/viewport"))
      return route.fulfill({
        json: { copyright: "SYNTHETIC TEST MAP — not live evidence" },
      });
    tileRequests++;
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(png, "base64"),
      headers: { "Cache-Control": "no-store" },
    });
  });
  await configure(page);
  await page.getByRole("button", { name: /地图选点/ }).click();
  await expect(page.getByText("北向上 · 真实瓦片")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Google Maps", exact: true }),
  ).toBeVisible();
  await page.locator("canvas").click({ position: { x: 120, y: 65 } });
  await expect(
    page.getByText(
      "此落点来自 Google 底图，仍沿用 Google 数据来源与地图使用限制。",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("来源：Google 地点服务 · 用户输入"),
  ).toBeVisible();
  expect(tileRequests).toBeGreaterThan(0);
  const result = await page.evaluate(async () => {
    const modulePath = "/src/map.ts";
    const { NavigationMap } = await import(modulePath);
    let calls = 0;
    const tile = document.createElement("canvas");
    tile.width = 256;
    tile.height = 256;
    const blob = await new Promise<Blob>((resolve) =>
      tile.toBlob((value) => resolve(value!), "image/png"),
    );
    const renderer = new NavigationMap({
      request: async (path: string) =>
        path.endsWith("session")
          ? { session: "mock", expiry: String(Date.now() / 1000 + 600) }
          : { copyright: "mock test" },
      fetch: async () => {
        calls++;
        return new Response(blob, { headers: { "Cache-Control": "no-store" } });
      },
    });
    await renderer.draw({ lat: 35.6812, lng: 139.7671 });
    const first = calls;
    await renderer.draw({ lat: 35.6812, lng: 139.7671 }, undefined, undefined, {
      lat: 35.68121,
      lng: 139.76711,
    });
    const stable = calls;
    const bytes = await renderer.pixels();
    await renderer.draw({ lat: 35.7, lng: 139.8 });
    const moved = calls;
    renderer.dispose();
    return { first, stable, moved, header: Array.from(bytes.slice(0, 8)) };
  });
  expect(result.first).toBeGreaterThan(0);
  expect(result.stable).toBe(result.first);
  expect(result.moved).toBeGreaterThan(result.stable);
  expect(result.header).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});
