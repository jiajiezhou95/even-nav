import { test, expect, type Page } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";

const link =
  "https://www.google.com/maps/dir/?api=1&origin=34.0,135.0&destination=35.6822,139.7691&travelmode=walking";
async function configure(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByLabel("Worker 首次配对凭据")
    .fill("test-owner-token-not-persisted");
  await page.getByRole("button", { name: "首次配对并连接" }).click();
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
    if (path === "/v1/auth/pair")
      return route.fulfill({
        json: {
          deviceToken: "synthetic-device-token-for-ui-tests",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      });
    if (path === "/v1/auth/revoke")
      return route.fulfill({ json: { revoked: true } });
    if (path === "/v1/providers")
      return route.fulfill({ json: { google: { configured: true } } });
    if (path === "/v1/destinations/resolve")
      return route.fulfill({
        json: {
          candidates: [
            {
              ...route.request().postDataJSON().candidate,
              coordinate: { lat: 35.6822, lng: 139.7691 },
              source: "GOOGLE_API_CONTENT",
              evidence: "DOCUMENTED_FIELD",
            },
          ],
        },
      });
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
  await expect(page.locator(".confirmation")).toBeVisible();
  await expect(page.locator("#origin")).toHaveCount(0);
  await expect(
    page.getByText("起点：当前手机位置", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("35.682200, 139.769100")).toBeVisible();
  expect(apiCalls).toEqual([]);
  await page.screenshot({
    path: ".local/evidence/ui-confirmation.png",
    fullPage: true,
  });
});
test("multiple links fail visibly; a single Maps link recovers", async ({
  page,
}) => {
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill(`${link}\nhttps://www.google.com/maps/search/?api=1&query=35,139`);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(page.getByRole("alert")).toContainText("多个 Maps 链接");
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill("https://www.google.com/maps/search/?api=1&query=35.7,139.8");
  await page.getByRole("button", { name: /导入链接/ }).click();
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
  ).not.toBeVisible();
  await expect(page.locator("#route-map-status")).toContainText(/地图|服务/);
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  await expect(
    page.getByRole("heading", { name: /沿路线前行.*本段剩余 \d+ m/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByRole("heading", { name: "导航已暂停" })).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: /沿路线前行/ })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 1, session: 0 });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "test-owner-token-not-persisted",
  );
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
test("route map stays explicit while loading and after a tile service failure", async ({
  page,
}) => {
  await configure(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("https://worker.test/v1/maps/**", async (route) => {
    await held;
    await route.fulfill({
      status: 503,
      json: { error: { code: "CONFIG_MISSING" } },
    });
  });
  await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  await expect(page.locator("#route-map-status")).toHaveText("地图加载中…");
  await expect(page.getByRole("tab")).toHaveCount(1);
  release();
  await expect(page.locator("#route-map-status")).toContainText(
    "此服务尚未配置",
  );
  await expect(page.getByRole("button", { name: "重试地图" })).toBeVisible();
  await expect(page.locator("#route-preview")).toBeHidden();
});
test("navigation shows arrow and changing distance with one next cue, not compound instructions", async ({
  page,
}, testInfo) => {
  await configure(page);
  await page.clock.install();
  await page.evaluate(() => {
    const coordinate = { latitude: 35.6812, longitude: 139.7671 };
    let listener: PositionCallback | undefined;
    const position = (longitude: number): GeolocationPosition => ({
      timestamp: Date.now(),
      coords: {
        ...coordinate,
        longitude,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      toJSON: () => ({}),
    });
    navigator.geolocation.getCurrentPosition = (success) =>
      success(position(coordinate.longitude));
    navigator.geolocation.watchPosition = (success) => {
      listener = success;
      return 77;
    };
    navigator.geolocation.clearWatch = () => {
      listener = undefined;
    };
    Object.assign(window, {
      emitSyntheticFix: (longitude: number) => listener?.(position(longitude)),
    });
  });
  await page.route("https://worker.test/v1/routes/road", (route) => {
    const request = route.request().postDataJSON();
    const points = [0, 1, 2, 3].map((i) => ({
      lat: 35.6812,
      lng: 139.7671 + 0.001 * i,
    }));
    return route.fulfill({
      json: {
        requestVersion: request.requestVersion,
        routes: [
          {
            id: "compact-guidance",
            provider: "GOOGLE_ROUTES",
            basemapProvider: "GOOGLE_TILES",
            fetchedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            distanceMeters: 273,
            durationSeconds: 180,
            warnings: [],
            attribution: ["Synthetic"],
            legs: [
              {
                mode: "WALK",
                geometry: points,
                distanceMeters: 273,
                durationSeconds: 180,
                steps: ["STRAIGHT", "TURN_RIGHT", "TURN_LEFT"].map(
                  (maneuver, i) => ({
                    maneuver,
                    geometry: points.slice(i, i + 2),
                    distanceMeters: 91,
                    durationSeconds: 60,
                    instruction:
                      i === 0
                        ? "沿合成道路直行\n经过合成商店后向左转，再穿过合成小路。"
                        : `合成步骤原文${i}`,
                  }),
                ),
              },
            ],
          },
        ],
      },
    });
  });
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill("https://www.google.com/maps/search/?api=1&query=35.6812,139.7701");
  await page.getByRole("button", { name: /导入链接/ }).click();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  const heading = page.locator("#nav-instruction");
  await expect(heading).toContainText("直行");
  await expect(page.locator("#nav-current-icon svg")).toBeVisible();
  await expect(page.locator("#nav-next-text")).toHaveText("向右转");
  expect(
    await page
      .locator("#nav-next")
      .evaluate((el) => getComputedStyle(el).borderTopStyle),
  ).toBe("solid");
  await expect(heading).not.toContainText("合成商店");
  const distanceValue = async () =>
    Number((await heading.textContent())!.match(/本段剩余 (\d+) m/)![1]);
  const initial = await distanceValue();
  await page.clock.runFor(5000);
  await page.evaluate(() =>
    (
      window as unknown as { emitSyntheticFix: (lng: number) => void }
    ).emitSyntheticFix(139.7676),
  );
  expect(await distanceValue()).toBeLessThan(initial);
  await page.clock.runFor(5000);
  await page.evaluate(() =>
    (
      window as unknown as { emitSyntheticFix: (lng: number) => void }
    ).emitSyntheticFix(139.7682),
  );
  await expect(page.locator("#nav-next-text")).toHaveText("向左转");
  await expect(heading).not.toContainText("向右转");
  await expect(page.locator("#current-step-detail")).toBeHidden();
  await page.getByText("当前步骤详情", { exact: true }).click();
  await expect(page.locator("#current-step-detail")).toHaveText(
    "合成步骤原文1",
  );
  await expect(heading).not.toContainText("合成步骤原文");
  await page.screenshot({
    path: testInfo.outputPath("navigation-guidance-synthetic.png"),
  });
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
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill("https://www.google.com/maps/search/?api=1&query=35.9,139.9");
  await page.getByRole("button", { name: /导入链接/ }).click();
  release();
  await expect(page.getByText("35.900000, 139.900000")).toBeVisible();
  await expect(page.getByText("30.000000, 130.000000")).toHaveCount(0);
});
test("real renderer uses encoded PNG, retains only active viewport and preserves shared-link destination", async ({
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
  await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(page.getByText("北向上", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Google Maps", exact: true }),
  ).toBeVisible();
  await page.locator("canvas").click({ position: { x: 120, y: 65 } });
  await expect(page.locator(".confirmation")).toBeVisible();
  await expect(page.getByText("35.682200, 139.769100")).toBeVisible();
  const planned = page.waitForRequest("https://worker.test/v1/routes/road");
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  expect((await planned).postDataJSON().destination).toMatchObject({
    source: "GOOGLE_MAPS_SHARED_LINK",
    coordinate: { lat: 35.6822, lng: 139.7691 },
  });
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
          ? {
              session: "mock",
              expiry: String(Date.now() / 1000 + 600),
              tileWidth: 256,
              tileHeight: 256,
            }
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

const credentialKey = "even-nav.device-credential.v1";
test("address enrichment precedes confirmation and one confirmed click plans the enriched destination", async ({
  page,
}) => {
  await configure(page);
  let lookups = 0,
    plans = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/destinations/resolve")) lookups++;
    if (request.url().endsWith("/routes/road")) plans++;
  });
  await page.route("https://worker.test/v1/destinations/resolve", (route) =>
    route.fulfill({
      json: {
        candidates: [
          {
            ...route.request().postDataJSON().candidate,
            label: "合成测试公园",
            address: "合成测试区一丁目",
            coordinate: { lat: 35.6822, lng: 139.7691 },
            evidence: "DOCUMENTED_FIELD",
            source: "GOOGLE_API_CONTENT",
          },
        ],
      },
    }),
  );
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill("https://www.google.com/maps/search/?api=1&query=SyntheticPark");
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(
    page.getByRole("heading", { name: "合成测试公园" }),
  ).toBeVisible();
  expect(lookups).toBe(1);
  expect(plans).toBe(0);
  const planned = page.waitForRequest("https://worker.test/v1/routes/road");
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  expect((await planned).postDataJSON().destination).toMatchObject({
    label: "合成测试公园",
    coordinate: { lat: 35.6822, lng: 139.7691 },
  });
  await expect(page.locator(".route-card")).toHaveCount(1);
  expect(lookups).toBe(1);
  expect(plans).toBe(1);
  await expect(page.locator(".confirmation")).toHaveCount(0);
});
test("ambiguous enriched destinations require an explicit candidate choice", async ({
  page,
}) => {
  await configure(page);
  await page.route("https://worker.test/v1/destinations/resolve", (route) =>
    route.fulfill({
      json: {
        candidates: [0, 1].map((i) => ({
          ...route.request().postDataJSON().candidate,
          label: `合成候选${i + 1}`,
          address: `合成地址${i + 1}`,
          coordinate: { lat: 35.6822 + i * 0.001, lng: 139.7691 },
          evidence: "DOCUMENTED_FIELD",
          source: "GOOGLE_API_CONTENT",
        })),
      },
    }),
  );
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill("https://www.google.com/maps/search/?api=1&query=SyntheticAmbiguous");
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(page.getByLabel("存在多个候选，请选择")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "确认目的地，查询路线" }),
  ).toBeDisabled();
  await page.getByLabel("存在多个候选，请选择").selectOption("1");
  await expect(page.getByRole("heading", { name: "合成候选2" })).toBeVisible();
  const planned = page.waitForRequest("https://worker.test/v1/routes/road");
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  expect((await planned).postDataJSON().destination.label).toBe("合成候选2");
});
test("cancelled enrichment cannot replace a newer destination", async ({
  page,
}) => {
  await configure(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "https://worker.test/v1/destinations/resolve",
    async (route) => {
      await held;
      await route
        .fulfill({
          json: {
            candidates: [
              {
                ...route.request().postDataJSON().candidate,
                label: "已取消的合成地点",
                coordinate: { lat: 30, lng: 130 },
              },
            ],
          },
        })
        .catch(() => {});
    },
  );
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill(
      "https://www.google.com/maps/search/?api=1&query=SyntheticDelayedAddress",
    );
  await page.getByRole("button", { name: /导入链接/ }).click();
  await expect(
    page.getByRole("button", { name: "确认目的地，查询路线" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill("https://www.google.com/maps/search/?api=1&query=35.9,139.9");
  await page.getByRole("button", { name: /导入链接/ }).click();
  release();
  await expect(page.getByText("35.900000, 139.900000")).toBeVisible();
  await expect(page.getByText("已取消的合成地点")).toHaveCount(0);
});
test("horizontal route tabs show selected road map without more tile calls and fit 360px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await configure(page);
  const tile = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#aaa";
    ctx.fillRect(0, 120, 256, 6);
    return c.toDataURL("image/png").split(",")[1];
  });
  let tileCalls = 0;
  await page.route("https://worker.test/v1/maps/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/session"))
      return route.fulfill({
        json: {
          session: "mock",
          expiry: String(Date.now() / 1000 + 600),
          tileWidth: 256,
          tileHeight: 256,
        },
      });
    if (url.pathname.endsWith("/viewport")) {
      return route.fulfill({ json: { copyright: "Synthetic map fixture" } });
    }
    tileCalls++;
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(tile, "base64"),
      headers: { "Cache-Control": "no-store" },
    });
  });
  await page.route("https://worker.test/v1/routes/road", (route) => {
    const request = route.request().postDataJSON();
    return route.fulfill({
      json: {
        requestVersion: request.requestVersion,
        routes: [0, 1, 2].map((i) => ({
          id: `comparison-${i}`,
          provider: "GOOGLE_ROUTES",
          basemapProvider: "GOOGLE_TILES",
          fetchedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          durationSeconds: 180 + i * 60,
          distanceMeters: 400,
          warnings: [
            "Walking directions are in beta. Use caution.",
            "合成提供商说明",
          ],
          attribution: ["Synthetic route attribution"],
          legs: [
            {
              mode: "WALK",
              durationSeconds: 180 + i * 60,
              distanceMeters: 400,
              geometry: [
                request.origin,
                { lat: 35.6812 + i * 0.0015, lng: 139.77 },
                request.destination.coordinate,
              ],
              steps: [
                {
                  instruction:
                    i === 2 ? "沿合成大道第三路线前行" : "沿合成大道前行",
                  maneuver: "STRAIGHT",
                  geometry: [
                    request.origin,
                    { lat: 35.6812 + i * 0.0015, lng: 139.77 },
                  ],
                  distanceMeters: 200,
                  durationSeconds: 90,
                },
                {
                  instruction: "在合成路口向右转",
                  maneuver: "TURN_RIGHT",
                  geometry: [
                    { lat: 35.6812 + i * 0.0015, lng: 139.77 },
                    request.destination.coordinate,
                  ],
                  distanceMeters: 200,
                  durationSeconds: 90,
                },
              ],
            },
          ],
        })),
      },
    });
  });
  await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await page
    .getByRole("button", { name: "确认目的地，查询路线" })
    .scrollIntoViewIfNeeded();
  expect(
    await page.locator("#app").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(200);
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  const canvas = page.locator("#route-preview");
  await expect(canvas).toBeVisible();
  await expect(canvas).toBeInViewport();
  await expect(canvas).toHaveAttribute("aria-label", "路线 1 道路地图");
  const startButton = page.getByRole("button", { name: "开始导航 ↗" });
  await expect(startButton).toHaveCount(1);
  await expect(startButton).toBeInViewport({ ratio: 1 });
  await expect(
    page.locator(".route-map-pane + #start + .route-tabs"),
  ).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.locator(".route-card")).toHaveCount(1);
  await expect(
    page.getByText("Walking directions are in beta. Use caution."),
  ).toHaveCount(0);
  const mapBox = await page.locator(".route-map-pane").boundingBox(),
    startBox = await startButton.boundingBox(),
    tabsBox = await page.getByRole("tablist").boundingBox();
  const mapGap = startBox!.y - (mapBox!.y + mapBox!.height);
  const tabsGap = tabsBox!.y - (startBox!.y + startBox!.height);
  expect(mapGap).toBeGreaterThanOrEqual(12);
  expect(mapGap).toBeLessThanOrEqual(16);
  expect(tabsGap).toBeGreaterThanOrEqual(12);
  expect(tabsGap).toBeLessThanOrEqual(16);
  await expect(
    page.locator(".selected-itinerary .itinerary-steps > li"),
  ).toHaveCount(2);
  await expect(
    page
      .locator(".selected-itinerary")
      .getByText("沿合成大道前行", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".selected-itinerary")
      .getByText("在合成路口向右转", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("#route-summary details .selected-itinerary"),
  ).toHaveCount(0);
  const callsBefore = tileCalls;
  const first = await canvas.evaluate((el: HTMLCanvasElement) =>
    el.toDataURL(),
  );
  const scrollBefore = await page
    .locator("#app")
    .evaluate((el) => el.scrollTop);
  await page.getByRole("tab", { name: "路线 2 4 分钟", exact: true }).click();
  await expect(canvas).toHaveAttribute("aria-label", "路线 2 道路地图");
  await expect(
    page.getByRole("tab", { name: "路线 2 4 分钟", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL()),
  ).not.toBe(first);
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "路线 3 5 分钟", exact: true }),
  ).toBeFocused();
  await expect(canvas).toHaveAttribute("aria-label", "路线 3 道路地图");
  expect(tileCalls).toBe(callsBefore);
  expect(await page.locator("#app").evaluate((el) => el.scrollTop)).toBeCloseTo(
    scrollBefore,
    0,
  );
  expect(
    await page
      .locator("#app")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await expect(page.locator("#route-copyright")).toContainText(
    "Synthetic map fixture",
  );
  await page.screenshot({
    path: testInfo.outputPath("route-tabs-synthetic.png"),
  });
  await page.screenshot({
    path: ".local/evidence/start-below-route-map-360.png",
  });
  await startButton.click();
  await expect(page.locator("#current-step-detail")).toContainText(
    "沿合成大道第三路线前行",
  );
});
test("G2 PNG keeps real tile detail bright on black and distinguishes route and current position", async ({
  page,
}, testInfo) => {
  const result = await page.evaluate(async () => {
    const path = "/src/map.ts";
    const { NavigationMap, project, unproject } = await import(path);
    const tile = document.createElement("canvas");
    tile.width = tile.height = 256;
    const c = tile.getContext("2d")!;
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = "#888";
    c.fillRect(0, 200, 256, 8);
    const blob = await new Promise<Blob>((resolve) =>
      tile.toBlob((b) => resolve(b!), "image/png"),
    );
    const renderer = new NavigationMap({
      request: async (path: string) =>
        path.endsWith("session")
          ? {
              session: "synthetic",
              expiry: String(Date.now() / 1000 + 600),
              tileWidth: 256,
              tileHeight: 256,
            }
          : { copyright: "Synthetic contrast fixture" },
      fetch: async () => new Response(blob),
    });
    const center = { lat: 0, lng: 0 },
      p = project(center, 16);
    const a = unproject(p.x - 100, p.y, 16),
      b = unproject(p.x + 100, p.y, 16);
    const route = {
      id: "synthetic-contrast",
      basemapProvider: "GOOGLE_TILES",
      attribution: ["Synthetic"],
      legs: [{ mode: "WALK", geometry: [a, b] }],
    };
    await renderer.draw(center, { coordinate: b }, route, center);
    const bytes = await renderer.pixels();
    const png = new Blob([bytes], { type: "image/png" });
    const bitmap = await createImageBitmap(png),
      output = document.createElement("canvas");
    output.width = 288;
    output.height = 144;
    const ctx = output.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = (x: number, y: number) =>
      Array.from(ctx.getImageData(x, y, 1, 1).data);
    const base = {
      base64: output.toDataURL().split(",")[1],
      background: pixel(20, 40),
      road: pixel(20, 20),
      route: pixel(80, 72),
      current: pixel(144, 72),
      halo: pixel(150, 72),
      attribution: renderer.attribution,
    };
    await renderer.draw(center, { coordinate: b }, route, center, [], {
      bearing: 90,
      timestamp: Date.now(),
      maxAgeMs: 5000,
    });
    const movingBitmap = await createImageBitmap(
      new Blob([await renderer.pixels()], { type: "image/png" }),
    );
    ctx.drawImage(movingBitmap, 0, 0);
    movingBitmap.close();
    const movement = pixel(155, 69)[0],
      movementPng = output.toDataURL().split(",")[1];
    await renderer.draw(center, { coordinate: b }, route, center, [], {
      bearing: 90,
      timestamp: Date.now() - 10000,
      maxAgeMs: 5000,
    });
    const staleBitmap = await createImageBitmap(
      new Blob([await renderer.pixels()], { type: "image/png" }),
    );
    ctx.drawImage(staleBitmap, 0, 0);
    staleBitmap.close();
    const iconPath = "/src/maneuver-icons.ts",
      { maneuverPng } = await import(iconPath);
    const iconBytes = await maneuverPng("left");
    const icon = await createImageBitmap(
      new Blob([iconBytes], { type: "image/png" }),
    );
    const dimensions = [icon.width, icon.height];
    icon.close();
    return {
      ...base,
      movement,
      staleMovement: pixel(155, 69)[0],
      movementPng,
      iconDimensions: dimensions,
      iconPng: btoa(String.fromCharCode(...iconBytes)),
    };
  });
  expect(result.background.slice(0, 3)).toEqual([0, 0, 0]);
  expect(result.road[0]).toBeGreaterThanOrEqual(200);
  expect(result.route.slice(0, 3)).toEqual([255, 255, 255]);
  expect(result.current.slice(0, 3)).toEqual([255, 255, 255]);
  expect(result.halo[0]).toBeLessThan(30);
  expect(result.attribution).toContain("Synthetic contrast fixture");
  expect(result.movement).toBeGreaterThan(200);
  expect(result.staleMovement).toBeLessThan(30);
  expect(result.iconDimensions).toEqual([48, 48]);
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(
    testInfo.outputPath("g2-contrast-synthetic.png"),
    Buffer.from(result.base64, "base64"),
  );
  await writeFile(
    testInfo.outputPath("g2-direction-synthetic.png"),
    Buffer.from(result.movementPng, "base64"),
  );
  await writeFile(
    testInfo.outputPath("g2-vector-icon.png"),
    Buffer.from(result.iconPng, "base64"),
  );
});
test("device pairing survives reload without owner entry or another pair request", async ({
  page,
}) => {
  let pairCalls = 0;
  const authorization: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/v1/auth/pair")) pairCalls++;
    if (request.url().endsWith("/v1/providers"))
      authorization.push(request.headers().authorization);
  });
  await configure(page);
  await page.reload();
  await expect(page.getByText("后端已连接", { exact: true })).toBeVisible();
  expect(pairCalls).toBe(1);
  expect(authorization).toEqual([
    "Bearer synthetic-device-token-for-ui-tests",
    "Bearer synthetic-device-token-for-ui-tests",
  ]);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByText("已自动恢复此设备的连接，无需再次输入配对凭据。"),
  ).toBeVisible();
  await expect(page.getByLabel("Worker 首次配对凭据")).toHaveValue("");
});
test("expired credentials are removed before requests and rejected credentials are not retried", async ({
  page,
}) => {
  let providerCalls = 0;
  await page.route("https://worker.test/v1/providers", (route) => {
    providerCalls++;
    return route.fulfill({
      status: 401,
      json: { error: { code: "AUTH_FAILED" } },
    });
  });
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          origin: "https://worker.test",
          deviceToken: "synthetic-device-token-for-ui-tests",
          expiresAt: "2000-01-01T00:00:00Z",
        }),
      ),
    credentialKey,
  );
  await page.reload();
  await expect(page.getByText("需要重新配对", { exact: true })).toBeVisible();
  expect(providerCalls).toBe(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), credentialKey),
  ).toBeNull();
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          origin: "https://worker.test",
          deviceToken: "synthetic-device-token-for-ui-tests",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      ),
    credentialKey,
  );
  await page.reload();
  await expect(page.getByText("需要重新配对", { exact: true })).toBeVisible();
  expect(providerCalls).toBe(1);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), credentialKey),
  ).toBeNull();
  await page.reload();
  expect(providerCalls).toBe(1);
});
test("temporary network failure keeps the device credential for explicit retry", async ({
  page,
}) => {
  await configure(page);
  await page.route("https://worker.test/v1/providers", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.reload();
  await expect(page.getByText("连接待重试", { exact: true })).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), credentialKey),
  ).toContain("synthetic-device-token-for-ui-tests");
  await page.unroute("https://worker.test/v1/providers");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "重试已保存的连接" }).click();
  await expect(page.getByText("后端已连接", { exact: true })).toBeVisible();
});
test("storage failure is visible and never claims persistent pairing", async ({
  page,
}) => {
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Blocked", "SecurityError");
      original.call(this, name, value);
    };
  }, credentialKey);
  await configure(page);
  await expect(
    page
      .locator("#message")
      .getByText("设备凭据保存失败；仅本次连接已确认，下次可能需要重新配对。"),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), credentialKey),
  ).toBeNull();
});
test("forget removes local credential and revokes only the issued device token", async ({
  page,
}) => {
  await configure(page);
  const revoked = page.waitForRequest("https://worker.test/v1/auth/revoke");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "断开并忘记此设备" }).click();
  expect((await revoked).headers().authorization).toBe(
    "Bearer synthetic-device-token-for-ui-tests",
  );
  await expect(
    page.locator("#message").getByText("此设备凭据已移除并撤销。"),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), credentialKey),
  ).toBeNull();
  await page.reload();
  await expect(page.getByText("未配置后端", { exact: true })).toBeVisible();
});
test("offline forget reports local removal separately from unconfirmed server revocation", async ({
  page,
}) => {
  await configure(page);
  await page.route("https://worker.test/v1/auth/revoke", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "断开并忘记此设备" }).click();
  await expect(
    page
      .locator("#message")
      .getByText(/本机凭据已移除；网络不可用，服务端撤销未确认/),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), credentialKey),
  ).toBeNull();
});

async function startLongSyntheticNavigation(page: Page) {
  await configure(page);
  await page.route("https://worker.test/v1/routes/road", (route) => {
    const request = route.request().postDataJSON();
    const legs = Array.from({ length: 18 }, (_, i) => ({
      mode: "WALK",
      distanceMeters: 230,
      durationSeconds: 180,
      geometry: [request.origin, request.destination.coordinate],
      steps: [
        {
          instruction: `合成测试第 ${i + 1} 段：沿道路前行至下一路口`,
          geometry: [request.origin, request.destination.coordinate],
          distanceMeters: 230,
          durationSeconds: 180,
        },
      ],
    }));
    return route.fulfill({
      json: {
        requestVersion: request.requestVersion,
        routes: [
          {
            id: "synthetic-long-route",
            provider: "GOOGLE_ROUTES",
            basemapProvider: "GOOGLE_TILES",
            fetchedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            distanceMeters: 4140,
            durationSeconds: 3240,
            warnings: [],
            attribution: ["Synthetic UI fixture"],
            legs,
          },
        ],
      },
    });
  });
  await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  await expect(page.locator(".navigation")).toBeVisible();
}
test("mobile confirmation scrolls inside app when host document scrolling is disabled", async ({
  page,
}) => {
  await configure(page);
  const label = "合成测试目的地・道路案内".repeat(22);
  await page.evaluate(() => {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  });
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`,
    );
  await page.getByRole("button", { name: /导入链接/ }).click();
  const app = page.locator("#app");
  await expect
    .poll(() => app.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await app.evaluate((el) => {
    el.scrollTop = 0;
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 370, y: 700 }],
  });
  for (let y = 650; y >= 250; y -= 50)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 370, y }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => app.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  await page
    .getByRole("button", { name: "确认目的地，查询路线" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "确认目的地，查询路线" }),
  ).toBeInViewport();
});
test("navigation ticks keep details nodes and mobile scroll position", async ({
  page,
}) => {
  await page.clock.install();
  await startLongSyntheticNavigation(page);
  await page
    .locator(".navigation .full-itinerary")
    .evaluate((el: HTMLDetailsElement) => {
      el.open = true;
    });
  await page.locator("#app").evaluate((el) => {
    el.scrollTop = 700;
  });
  const original = await page
    .locator(".navigation .full-itinerary")
    .elementHandle();
  const before = await page.locator("#app").evaluate((el) => el.scrollTop);
  await page.clock.runFor(2200);
  expect(
    await original!.evaluate(
      (el) => el === document.querySelector(".navigation .full-itinerary"),
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".navigation .full-itinerary")
      .evaluate((el: HTMLDetailsElement) => el.open),
  ).toBe(true);
  expect(await page.locator("#app").evaluate((el) => el.scrollTop)).toBeCloseTo(
    before,
    0,
  );
  expect(before).toBeGreaterThan(100);
});
test("page return restores one subscription and respects pause and end", async ({
  page,
}) => {
  await page.evaluate(() => {
    const geo = navigator.geolocation;
    const originalWatch = geo.watchPosition.bind(geo),
      originalClear = geo.clearWatch.bind(geo);
    const counts = { starts: 0, stops: 0 };
    Object.assign(window, { lifecycleCounts: counts });
    geo.watchPosition = (...args) => {
      counts.starts++;
      return originalWatch(...args);
    };
    geo.clearWatch = (id) => {
      counts.stops++;
      return originalClear(id);
    };
  });
  await startLongSyntheticNavigation(page);
  const counts = () =>
    page.evaluate(
      () =>
        (
          window as Window & {
            lifecycleCounts?: { starts: number; stops: number };
          }
        ).lifecycleCounts!,
    );
  expect(await counts()).toEqual({ starts: 1, stops: 0 });
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    ),
  );
  await expect.poll(counts).toEqual({ starts: 1, stops: 1 });
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(counts).toEqual({ starts: 2, stops: 1 });
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expect.poll(counts).toEqual({ starts: 2, stops: 2 });
  await page.getByRole("button", { name: "结束", exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect.poll(counts).toEqual({ starts: 2, stops: 2 });
});
test("failed return location pauses visibly and explicit resume restores ticks", async ({
  page,
}) => {
  await page.clock.install();
  await startLongSyntheticNavigation(page);
  await page.evaluate(() => {
    const geo = navigator.geolocation;
    const original = geo.getCurrentPosition.bind(geo);
    let failNext = true;
    geo.getCurrentPosition = (success, error, options) => {
      if (failNext) {
        failNext = false;
        error?.({
          code: 2,
          message: "Synthetic unavailable",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      } else original(success, error, options);
    };
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expect(
    page.getByRole("button", { name: "继续", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#message")).toContainText("浏览器定位不可用");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  const stepDistance = await page.locator("#nav-step-distance").textContent();
  const tripDistance = await page.locator("#nav-distance").textContent();
  await expect(page.locator("#nav-fix")).toBeHidden();
  await page.clock.runFor(6000);
  await expect(page.locator("#nav-current-text")).toHaveText("沿路线前行");
  await expect(page.locator("#nav-fix")).toContainText("更新定位中");
  await expect(page.locator("#nav-step-distance")).toHaveText(stepDistance!);
  expect(
    await page
      .locator("#nav-fix")
      .evaluate((el) => getComputedStyle(el).textAlign),
  ).toBe("right");
  await expect(page.locator("#nav-distance")).toHaveText(tripDistance!);
  await expect(page.locator("#nav-instruction")).toContainText("本段剩余");
  expect(
    await page
      .locator(".location-dot")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("location-blink");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.locator("#nav-fix")).toBeHidden();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page.locator("#nav-fix")).toBeHidden();
});

async function mockImu(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/device.ts";
    const { EvenDevice } = await import(path);
    let listener: ((event: unknown) => void) | undefined;
    const calls: boolean[] = [];
    (window as any).imuCalls = calls;
    (window as any).emitImu = (x: number) =>
      listener?.({ sysEvent: { eventType: 8, imuData: { x, y: 2, z: 3 } } });
    EvenDevice.prototype.prepareImuProbe = async () => ({
      imuControl: async (enabled: boolean) => {
        calls.push(enabled);
        return true;
      },
      onEvenHubEvent: (callback: (event: unknown) => void) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      },
    });
  });
}

async function captureImu(page: Page) {
  await page.getByRole("button", { name: "开始采样", exact: true }).click();
  await expect(page.locator("#imu-stats")).toContainText("正在采样");
  await page.getByRole("button", { name: "向左转头", exact: true }).click();
  await page.evaluate(() => (window as any).emitImu(1));
  await page.getByRole("button", { name: "停止采样", exact: true }).click();
  await expect(page.locator("#imu-report")).toBeVisible();
}

async function pairForImu(page: Page) {
  await page.getByLabel("Worker 首次配对凭据").fill("test-owner-token");
  await page.getByRole("button", { name: "首次配对并连接" }).click();
  await expect(page.getByText("后端已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
}

test("local IMU settings capture selected phase and export without location or provider calls", async ({
  page,
}) => {
  await mockImu(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "开始采样", exact: true }).click();
  await expect(page.locator("#imu-stats")).toContainText("正在采样");
  await page.getByRole("button", { name: "向左转头", exact: true }).click();
  await page.evaluate(() => (window as any).emitImu(1));
  await expect(page.locator("#imu-stats")).toContainText("1 条");
  await page.getByRole("button", { name: "停止采样", exact: true }).click();
  await expect(page.locator("#imu-report")).toBeVisible();
  const result = JSON.parse(await page.locator("#imu-report").inputValue());
  expect(result.samples[0]).toMatchObject({ phase: "left", x: 1, y: 2, z: 3 });
  expect(JSON.stringify(result)).not.toMatch(
    /latitude|longitude|coordinate|token|heading/,
  );
  expect(await page.evaluate(() => (window as any).imuCalls)).toEqual([
    true,
    false,
  ]);
  await page.getByRole("button", { name: "开始采样", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).imuCalls))
    .toEqual([true, false, true, false]);
});

test("IMU manual upload sends only sample fields and keeps the current page", async ({
  page,
}) => {
  const uploads: unknown[] = [];
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => navigations.push(frame.url()));
  page.on("download", () => {
    throw new Error("IMU upload must not download a file");
  });
  await page.route("https://worker.test/v1/diagnostics/imu", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers().authorization).toBe(
      "Bearer synthetic-device-token-for-ui-tests",
    );
    uploads.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        id: "12345678-abcd-1234-abcd-123456789012",
        receivedAt: new Date().toISOString(),
        sampleCount: 1,
      },
    });
  });
  await mockImu(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await captureImu(page);
  const upload = page.getByRole("button", { name: "上传采样", exact: true });
  await expect(upload).toBeDisabled();
  expect(uploads).toEqual([]);
  await pairForImu(page);
  const action = page.getByLabel("这次做了哪个动作");
  await expect(action).toHaveValue("");
  await expect(upload).toBeDisabled();
  await upload.dispatchEvent("click");
  expect(uploads).toEqual([]);
  await action.selectOption("right");
  await expect(upload).toBeEnabled();
  const localReport = await page.locator("#imu-report").inputValue();
  await upload.click();
  await expect(page.locator("#imu-upload-status")).toHaveText(
    "已上传 1 条采样 · 回执 12345678",
  );
  expect(uploads).toEqual([
    {
      schemaVersion: 1,
      label: "right",
      samples: [
        { receivedAt: expect.any(Number), phase: "left", x: 1, y: 2, z: 3 },
      ],
    },
  ]);
  await expect(page.locator("#imu-report")).toHaveValue(localReport);
  expect(navigations).toEqual([]);
  expect(page.url()).toBe("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "开始采样", exact: true }).click();
  await expect(action).toHaveValue("");
  await expect(page.locator("#imu-upload")).toBeDisabled();
  await expect(page.locator("#imu-upload-status")).not.toContainText("已上传");
  await page.getByRole("button", { name: "停止采样", exact: true }).click();
  await expect(page.locator("#imu-export")).toBeHidden();
  expect(uploads).toHaveLength(1);
});

test("IMU failed upload retains samples for manual retry and blocks duplicate requests", async ({
  page,
}) => {
  let attempts = 0;
  let releaseFailure!: () => void;
  const pendingFailure = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  await page.route("https://worker.test/v1/diagnostics/imu", async (route) => {
    attempts++;
    if (attempts === 1) {
      await pendingFailure;
      await route.fulfill({
        status: 503,
        json: { error: { code: "PROVIDER_UNAVAILABLE", message: "private" } },
      });
    } else {
      await route.fulfill({
        json: { id: "87654321-retry", receivedAt: "now", sampleCount: 1 },
      });
    }
  });
  await mockImu(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await pairForImu(page);
  await captureImu(page);
  await page.getByLabel("这次做了哪个动作").selectOption("left");
  const localReport = await page.locator("#imu-report").inputValue();
  const upload = page.getByRole("button", { name: "上传采样", exact: true });
  await upload.click();
  await expect(page.locator("#imu-upload-status")).toHaveText(
    "正在上传 1 条采样…",
  );
  await expect(upload).toBeDisabled();
  await upload.dispatchEvent("click");
  expect(attempts).toBe(1);
  releaseFailure();
  await expect(page.locator("#imu-upload-status")).toContainText(
    "上传未确认，本机采样已保留",
  );
  await expect(page.locator("#imu-upload-status")).not.toContainText("private");
  await expect(page.locator("#imu-report")).toHaveValue(localReport);
  await expect(page.getByLabel("这次做了哪个动作")).toHaveValue("left");
  expect(attempts).toBe(1);
  await upload.click();
  await expect(page.locator("#imu-upload-status")).toHaveText(
    "已上传 1 条采样 · 回执 87654321",
  );
  expect(attempts).toBe(2);
});

test("IMU late upload receipt cannot mark a newer sample as uploaded", async ({
  page,
}) => {
  let releaseUpload!: () => void;
  const pendingUpload = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("https://worker.test/v1/diagnostics/imu", async (route) => {
    await pendingUpload;
    await route.fulfill({
      json: { id: "12345678-previous", receivedAt: "now", sampleCount: 1 },
    });
  });
  await mockImu(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await pairForImu(page);
  await captureImu(page);
  await page.getByLabel("这次做了哪个动作").selectOption("left");
  const upload = page.getByRole("button", { name: "上传采样", exact: true });
  await upload.click();
  await expect(upload).toBeDisabled();
  await captureImu(page);
  releaseUpload();
  await expect(page.getByLabel("这次做了哪个动作")).toBeEnabled();
  await expect(page.getByLabel("这次做了哪个动作")).toHaveValue("");
  await expect(upload).toBeDisabled();
  await page.getByLabel("这次做了哪个动作").selectOption("nod");
  await expect(upload).toBeEnabled();
  await expect(page.locator("#imu-upload-status")).not.toContainText("已上传");
  await expect(page.locator("#imu-upload-status")).not.toContainText(
    "12345678",
  );
});

test("SDK scroll gestures zoom the active map without rerouting and ignore non-navigation", async ({
  page,
}) => {
  await page.route("https://worker.test/v1/routes/road", (route) => {
    const request = route.request().postDataJSON();
    return route.fulfill({
      json: {
        requestVersion: request.requestVersion,
        routes: [0, 1, 2].map((i) => ({
          id:
            i === 0
              ? "synthetic-road"
              : i === 1
                ? "synthetic-second"
                : "synthetic-third",
          provider: "GOOGLE_ROUTES",
          basemapProvider: "GOOGLE_TILES",
          fetchedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          distanceMeters: i === 0 ? 230 : 450,
          durationSeconds: 180 + i * 60,
          warnings: [],
          attribution: ["Synthetic route"],
          legs: [
            {
              mode: "WALK",
              distanceMeters: i === 0 ? 230 : 450,
              durationSeconds: 180 + i * 60,
              geometry:
                i === 1
                  ? [
                      request.origin,
                      { lat: 35.6833, lng: 139.7674 },
                      request.destination.coordinate,
                    ]
                  : [request.origin, request.destination.coordinate],
              steps: [
                {
                  instruction:
                    i === 0
                      ? "沿道路前行，经过中央车站东出口后右转进入地下通道。\n在第二个路口左转，沿人行道继续前行至公交站。".repeat(
                          12,
                        )
                      : "沿第二路线前行",
                  geometry:
                    i === 1
                      ? [
                          request.origin,
                          { lat: 35.6833, lng: 139.7674 },
                          request.destination.coordinate,
                        ]
                      : [request.origin, request.destination.coordinate],
                  distanceMeters: i === 0 ? 230 : 450,
                  durationSeconds: 180 + i * 60,
                },
              ],
            },
          ],
        })),
      },
    });
  });
  await page.route("**/src/runtime.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
        export const isEvenHost = () => Boolean(window.mockNative);
        export const getEvenBridge = async () => window.mockBridge;
      `,
    }),
  );
  await page.reload();
  const pngs = await page.evaluate(() =>
    [256, 512].map((size) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#eee";
      ctx.fillRect(0, 0, size, size);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
  );
  const viewports: number[] = [];
  let routeCalls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/v1/routes/")) routeCalls++;
  });
  await page.route("https://worker.test/v1/maps/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/session")) {
      const size = route.request().postDataJSON()?.display === "G2" ? 512 : 256;
      return route.fulfill({
        json: {
          session: `synthetic-${size}`,
          expiry: String(Math.floor(Date.now() / 1000) + 600),
          tileWidth: size,
          tileHeight: size,
        },
      });
    }
    if (url.pathname.endsWith("/viewport")) {
      viewports.push(Number(url.searchParams.get("zoom")));
      return route.fulfill({ json: { copyright: "Synthetic zoom map" } });
    }
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        pngs[url.searchParams.get("session") === "synthetic-512" ? 1 : 0],
        "base64",
      ),
    });
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await pairForImu(page);
  await page.evaluate(async () => {
    let listener: ((event: unknown) => void) | undefined;
    let lastBurstAt = -Infinity;
    const mapPath = "/src/map.ts";
    const { NavigationMap } = await import(mapPath);
    const deviceModule = await (await fetch("/src/device.ts")).text();
    const sdkPath = deviceModule.match(
      /from\s+["']([^"']*even_hub_sdk[^"']*)["']/,
    )![1];
    const { evenHubEventFromJson } = await import(sdkPath);
    const draw = NavigationMap.prototype.draw;
    (window as any).mapViews = [];
    (window as any).mapSelected = [];
    (window as any).candidateFrames = [];
    const devicePath = "/src/device.ts";
    const { EvenDevice } = await import(devicePath);
    const background = EvenDevice.prototype.setRouteChoiceBackground;
    EvenDevice.prototype.setRouteChoiceBackground = function (
      frame: any,
      routeId: string,
    ) {
      (window as any).candidateFrames.push(routeId);
      return background.call(this, frame, routeId);
    };
    NavigationMap.prototype.draw = async function (...args: any[]) {
      (window as any).mapViews.push((args[4] || []).map((r: any) => r.id));
      (window as any).mapSelected.push(args[2]?.id);
      const result = await draw.apply(this, args);
      if (
        (window as any).holdCandidateDraw &&
        args[2]?.id === "synthetic-road" &&
        args[4]?.length === 3
      ) {
        (window as any).holdCandidateDraw = false;
        await new Promise<void>((resolve) => {
          (window as any).releaseCandidateDraw = resolve;
        });
      }
      return result;
    };
    (window as any).hudImages = {};
    (window as any).hudWriteCount = 0;
    (window as any).hudWriteIds = [];
    (window as any).nativeLifecycle = [];
    (window as any).waitForList = async (content: unknown) => {
      const path = "/src/hud-menu.ts";
      const { renderHudListTile } = await import(path);
      const expected = await renderHudListTile(undefined, content);
      const panel = async (bytes: Uint8Array) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = 288;
        canvas.height = 144;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(108, 0, 180, 144).data;
      };
      const pixels = await panel(expected);
      for (let attempt = 0; attempt < 150; attempt++) {
        if ((window as any).hudImages[2]) {
          const actual = await panel(
            new Uint8Array((window as any).hudImages[2]),
          );
          if (pixels.every((v: number, i: number) => v === actual[i])) return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Native h1 list did not match expected text page");
    };
    (window as any).rebuildCalls = 0;
    (window as any).mockNative = true;
    (window as any).emitScroll = async (eventType: number, count = 1) => {
      // Separate gestures must clear the device's 250 ms deduplication window.
      // Keep each burst synchronous so duplicate suppression is still tested.
      const interval = eventType === 0 || eventType === 3 ? 350 : 250;
      while (Date.now() - lastBurstAt < interval)
        await new Promise((resolve) =>
          setTimeout(resolve, interval - (Date.now() - lastBurstAt)),
        );
      for (let i = 0; i < count; i++)
        listener?.(
          evenHubEventFromJson({
            type: "textEvent",
            jsonData: {
              Container_ID: 5,
              ...(eventType === 0 ? {} : { Event_Type: eventType }),
            },
          }),
        );
      lastBurstAt = Date.now();
    };
    (window as any).mockBridge = {
      getDeviceInfo: async () => ({
        model: "g2",
        status: { connectType: "connected" },
      }),
      onDeviceStatusChanged: () => () => {},
      onEvenHubEvent: (callback: (event: unknown) => void) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      },
      getAppLocation: async () => ({
        latitude: 35.6812,
        longitude: 139.7671,
        timestamp: Date.now(),
        accuracy: 5,
      }),
      onAppLocationChanged: () => () => {},
      startAppLocationUpdates: async () => true,
      stopAppLocationUpdates: async () => {
        (window as any).nativeLifecycle.push("stopGPS");
        return true;
      },
      createStartUpPageContainer: async () => 0,
      rebuildPageContainer: async () => {
        (window as any).rebuildCalls++;
        return true;
      },
      updateImageRawData: async (value: {
        containerID: number;
        imageData: number[];
      }) => {
        (window as any).hudImages[value.containerID] = value.imageData;
        (window as any).hudWriteCount++;
        (window as any).hudWriteIds.push(value.containerID);
        return "success";
      },
      shutDownPageContainer: async (mode: number) => {
        (window as any).nativeLifecycle.push(`exit${mode}`);
        return true;
      },
    };
  });
  await page.getByRole("button", { name: "连接 Even App / G2" }).click();
  await expect(page.getByText("G2 已连接", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).emitScroll(1, 20));
  expect(viewports).toEqual([]);
  await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  await expect(page.locator("#map-state")).toHaveText("北向上");
  await expect.poll(() => viewports.at(-1)).toBe(16);
  const baselineCount = viewports.length;
  await page.evaluate(() => (window as any).emitScroll(1, 20));
  await expect.poll(() => viewports.at(-1)).toBe(17);
  expect(viewports.length).toBe(baselineCount + 1);
  expect(routeCalls).toBe(1);
  // A pause preserves navigation and allows map inspection at a different scale.
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByRole("heading", { name: "导航已暂停" })).toBeVisible();
  await page.evaluate(() => (window as any).emitScroll(2));
  await expect.poll(() => viewports.at(-1)).toBe(16);
  expect(routeCalls).toBe(1);
  await expect(
    page.getByText("G2 已连接，大地图", { exact: true }),
  ).toBeVisible();
  const captureHud = async (path: string) => {
    const png = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 576;
      canvas.height = 288;
      for (let i = 0; i < 4; i++) {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array((window as any).hudImages[i + 1])], {
            type: "image/png",
          }),
        );
        canvas
          .getContext("2d")!
          .drawImage(bitmap, (i % 2) * 288, Math.floor(i / 2) * 144);
        bitmap.close();
      }
      return canvas.toDataURL().split(",")[1];
    });
    await writeFile(path, Buffer.from(png, "base64"));
  };
  const waitForSettledWrites = async () => {
    await page.evaluate(async () => {
      let count = -1;
      for (let i = 0; i < 100; i++) {
        const next = (window as any).hudWriteCount;
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (count === next && next === (window as any).hudWriteCount) return;
        count = next;
      }
      throw new Error("Native presentation did not settle");
    });
  };
  const nativeMapSignature = () =>
    page.evaluate(async () => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array((window as any).hudImages[3])], {
          type: "image/png",
        }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = 288;
      canvas.height = 144;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(0, 0, 288, 80).data);
    });
  await page.evaluate(() => (window as any).emitScroll(3, 20));
  await page.evaluate(() => (window as any).emitScroll(0, 20));
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as any).mapViews.at(-1))).toEqual(
    [],
  );
  await page.evaluate(() => (window as any).emitScroll(3, 20));
  await expect(page.locator(".full-itinerary")).toHaveAttribute("open", "");
  await expect
    .poll(() => page.evaluate(() => (window as any).mapViews.at(-1)))
    .toEqual(["synthetic-road"]);
  await waitForSettledWrites();
  await captureHud(".local/evidence/hud-overview-map-native.png");
  const mapPixels = await nativeMapSignature();
  expect(
    mapPixels.filter((v, i) => i % 4 === 0 && v > 0).length,
  ).toBeGreaterThan(1000);
  const overviewZoom = viewports.at(-1);
  await page.evaluate(async () => {
    const path = "/src/hud-menu.ts";
    const { buildHudStepPages } = await import(path);
    (window as any).overviewPages = buildHudStepPages([
      {
        text:
          "沿道路前行，经过中央车站东出口后右转进入地下通道。\n在第二个路口左转，沿人行道继续前行至公交站。".repeat(
            12,
          ) + " · 230米",
        current: true,
      },
    ]);
    (window as any).waitForTextPage = async (index: number) => {
      const rendererPath = "/src/hud-overview.ts";
      const { renderHudOverview } = await import(rendererPath);
      const expected = await renderHudOverview(
        {},
        (window as any).overviewPages[index],
      );
      for (let attempt = 0; attempt < 150; attempt++) {
        if (
          expected.every(
            (bytes: Uint8Array, i: number) =>
              JSON.stringify(Array.from(bytes)) ===
              JSON.stringify((window as any).hudImages[i + 1]),
          )
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Full text page did not reach all native tiles");
    };
  });
  const pages = await page.evaluate(() => (window as any).overviewPages.length);
  expect(pages).toBeGreaterThan(1);
  for (let i = 0; i < pages; i++) {
    await page.evaluate(() => (window as any).emitScroll(2, 20));
    await page.evaluate((index) => (window as any).waitForTextPage(index), i);
  }
  await captureHud(".local/evidence/hud-overview-text-native.png");
  const endWrites = await page.evaluate(() => (window as any).hudWriteCount);
  await page.evaluate(() => (window as any).emitScroll(2));
  expect(await page.evaluate(() => (window as any).hudWriteCount)).toBe(
    endWrites,
  );
  expect(viewports.at(-1)).toBe(overviewZoom);
  // Double tap opens the menu; only its return item exits overview.
  await page.evaluate(() => (window as any).emitScroll(3, 20));
  await page.evaluate(() => (window as any).emitScroll(1));
  await page.evaluate(() => (window as any).emitScroll(1));
  await page.evaluate(() => (window as any).emitScroll(0, 20));
  expect(await page.evaluate(() => (window as any).mapViews.at(-1))).toEqual([
    "synthetic-road",
  ]);
  await page.evaluate(() => (window as any).emitScroll(3, 20));
  await expect
    .poll(() => page.evaluate(() => (window as any).mapViews.at(-1)))
    .toEqual([]);
  for (const [selection, expectedZoom] of [
    [1, 17],
    [2, 16],
    [4, 16],
  ]) {
    await page.evaluate(() => (window as any).emitScroll(3));
    for (let i = 0; i < selection; i++)
      await page.evaluate(() => (window as any).emitScroll(2));
    await page.evaluate(() => (window as any).emitScroll(3, 20));
    await expect.poll(() => viewports.at(-1)).toBe(expectedZoom);
    await waitForSettledWrites();
    expect(routeCalls).toBe(1);
  }
  await page.evaluate(() => (window as any).emitScroll(3));
  await page.evaluate(() => (window as any).emitScroll(1));
  await page.evaluate(() => (window as any).emitScroll(1));
  await page.evaluate(() => (window as any).emitScroll(1));
  await page.evaluate(() => (window as any).emitScroll(3, 20));
  await expect(page.getByRole("tablist", { name: "可选路线" })).toBeVisible();
  await expect(page.locator(".navigation")).toHaveCount(0);
  expect(routeCalls).toBe(2);
  await expect
    .poll(() => page.evaluate(() => (window as any).candidateFrames.at(-1)))
    .toBe("synthetic-road");
  await waitForSettledWrites();
  const firstMap = await nativeMapSignature();
  await captureHud(".local/evidence/hud-route-choice-1-native.png");
  await page.evaluate(() => (window as any).emitScroll(2, 20));
  await expect(
    page.getByRole("tab", { name: "路线 2 4 分钟", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => page.evaluate(() => (window as any).candidateFrames.at(-1)))
    .toBe("synthetic-second");
  await waitForSettledWrites();
  const secondMap = await nativeMapSignature();
  expect(secondMap).not.toEqual(firstMap);
  await captureHud(".local/evidence/hud-route-choice-2-native.png");
  // A delayed old selection must not replace the newer selected candidate map.
  const framesBefore = await page.evaluate(
    () => (window as any).candidateFrames.length,
  );
  await page.evaluate(() => {
    (window as any).holdCandidateDraw = true;
  });
  await page.getByRole("tab", { name: "路线 1 3 分钟", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as any).releaseCandidateDraw),
    )
    .toBe("function");
  await page.evaluate(() => (window as any).emitScroll(2));
  await page.evaluate(() => (window as any).releaseCandidateDraw());
  await expect
    .poll(() => page.evaluate(() => (window as any).candidateFrames.length))
    .toBeGreaterThan(framesBefore);
  expect(
    await page.evaluate(
      (count) => (window as any).candidateFrames.slice(count),
      framesBefore,
    ),
  ).toEqual(["synthetic-second"]);
  await waitForSettledWrites();
  expect(await nativeMapSignature()).toEqual(secondMap);
  await page.evaluate(() => (window as any).emitScroll(0, 20));
  await page.waitForTimeout(350);
  await expect(page.locator(".navigation")).toHaveCount(0);
  await page.evaluate(() => (window as any).emitScroll(3, 20));
  await expect(page.locator(".navigation")).toBeVisible();
  await expect(page.locator("#current-step-detail")).toContainText(
    "沿第二路线前行",
  );
  expect(routeCalls).toBe(2);
  expect(await page.evaluate(() => (window as any).rebuildCalls)).toBe(1);
  await waitForSettledWrites();
  await page.evaluate(() => (window as any).emitScroll(3));
  await page.evaluate(() => (window as any).emitScroll(1));
  await waitForSettledWrites();
  await captureHud(".local/evidence/hud-menu-exit-native.png");
  await page.evaluate(() => (window as any).emitScroll(0, 20));
  expect(
    await page.evaluate(() =>
      (window as any).nativeLifecycle.filter((v: string) => v === "exit0"),
    ),
  ).toEqual([]);
  await page.evaluate(() => (window as any).emitScroll(3, 20));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).nativeLifecycle.filter((v: string) => v === "exit0"),
      ),
    )
    .toEqual(["exit0"]);
  expect(
    await page.evaluate(() => (window as any).nativeLifecycle.slice(-2)),
  ).toEqual(["stopGPS", "exit0"]);
  const endedCount = viewports.length;
  await page.evaluate(() => (window as any).emitScroll(1));
  expect(viewports).toHaveLength(endedCount);
});

for (const transfers of [0, 1, 2])
  test(`TRANSIT glasses double confirmations complete ${transfers} transfers with final walking`, async ({
    page,
  }) => {
    let transitRequests = 0;
    await page.route("https://worker.test/v1/routes/transit", (route) => {
      transitRequests++;
      const request = route.request().postDataJSON();
      const point = (offset: number) => ({
        lat: request.origin.lat,
        lng: request.origin.lng + offset,
      });
      const legs: any[] = [];
      const add = (mode: string, from: any, to: any, fields: any = {}) =>
        legs.push({
          mode,
          geometry: [from, to],
          distanceMeters: mode === "WAIT" ? 0 : mode === "RIDE" ? 900 : 100,
          durationSeconds: mode === "RIDE" ? 300 : 60,
          steps:
            mode === "WALK"
              ? [
                  {
                    instruction: "沿人行道前往合成站点",
                    geometry: [from, to],
                    distanceMeters: 100,
                    durationSeconds: 60,
                  },
                ]
              : [],
          ...fields,
        });
      let current = point(0.001);
      add("WALK", request.origin, current, { to: "合成甲站" });
      for (let i = 0; i <= transfers; i++) {
        const stop = point(0.003 + i * 0.003);
        const detail = {
          line: `合成${i + 1}号线`,
          headsign: `方向${i + 1}站`,
          from: `合成${i + 1}上车站`,
          to: `合成${i + 1}下车站`,
          platform: String(i + 1),
        };
        add("WAIT", current, current, detail);
        add("RIDE", current, stop, detail);
        current = stop;
        if (i < transfers) {
          const next = point(0.0035 + i * 0.003);
          add("TRANSFER", current, next, {
            from: detail.to,
            to: `合成${i + 2}上车站`,
            line: `合成${i + 2}号线`,
            platform: String(i + 2),
          });
          current = next;
        }
      }
      add("WALK", current, request.destination.coordinate, {
        to: "最终目的地",
      });
      return route.fulfill({
        json: {
          requestVersion: request.requestVersion,
          routes: [
            {
              id: `transit-${transfers}`,
              provider: "TRANSITOUS",
              basemapProvider: "GOOGLE_TILES",
              fetchedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
              distanceMeters: legs.reduce((n, l) => n + l.distanceMeters, 0),
              durationSeconds: legs.reduce((n, l) => n + l.durationSeconds, 0),
              warnings: [],
              attribution: ["Synthetic Transit"],
              legs,
            },
          ],
        },
      });
    });
    await page.route("**/src/runtime.ts", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const isEvenHost=()=>Boolean(window.mockNative); export const getEvenBridge=async()=>window.mockBridge;`,
      }),
    );
    await page.reload();
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      c.getContext("2d")!.fillRect(0, 0, 512, 512);
      return c.toDataURL().split(",")[1];
    });
    await page.route("https://worker.test/v1/maps/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/session")) {
        const size =
          route.request().postDataJSON()?.display === "G2" ? 512 : 256;
        return route.fulfill({
          json: {
            session: `synthetic-${size}`,
            expiry: String(Math.floor(Date.now() / 1000) + 3600),
            tileWidth: size,
            tileHeight: size,
          },
        });
      }
      if (url.pathname.endsWith("/viewport"))
        return route.fulfill({ json: { copyright: "Synthetic transit map" } });
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(png, "base64"),
      });
    });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await pairForImu(page);
    await page.evaluate(async () => {
      const main = await (await fetch("/src/main.ts")).text();
      const corePath = main.match(
        /from\s+["']([^"']*packages\/core\/src\/navigation[^"']*)["']/,
      )![1];
      const { NavigationSession } = await import(corePath);
      const start = NavigationSession.prototype.start;
      NavigationSession.prototype.start = function (...args: any[]) {
        (window as any).navSession = this;
        return start.apply(this, args);
      };
      const devicePath = "/src/device.ts";
      const { LatestFrameQueue } = await import(devicePath);
      const push = LatestFrameQueue.prototype.push;
      (window as any).phaseFrames = [];
      LatestFrameQueue.prototype.push = function (frame: any) {
        if (frame.guidance) {
          (window as any).lastFrame = frame;
          (window as any).phaseFrames.push({
            leg: (window as any).navSession?.snapshot.legIndex,
            action: frame.guidance.action,
          });
        }
        return push.call(this, frame);
      };
      const mapPath = "/src/map.ts";
      const { NavigationMap } = await import(mapPath);
      const draw = NavigationMap.prototype.draw;
      NavigationMap.prototype.draw = async function (...args: any[]) {
        const result = await draw.apply(this, args);
        if (
          (window as any).holdWalkMap &&
          (window as any).navSession?.snapshot.phase === "NAVIGATING" &&
          args[4]?.length === 0
        ) {
          (window as any).holdWalkMap = false;
          await new Promise<void>((resolve) => {
            (window as any).releaseWalkMap = resolve;
          });
        }
        return result;
      };
      let eventListener: any;
      let fixListener: any;
      let last = -Infinity;
      (window as any).hudImages = {};
      (window as any).mockNative = true;
      (window as any).emitGesture = async (type: number, count = 1) => {
        while (Date.now() - last < 350)
          await new Promise((resolve) =>
            setTimeout(resolve, 350 - (Date.now() - last)),
          );
        for (let i = 0; i < count; i++)
          eventListener?.({ sysEvent: { eventType: type, eventSource: 1 } });
        last = Date.now();
      };
      (window as any).emitFix = (coordinate: any) =>
        fixListener?.({
          latitude: coordinate.lat,
          longitude: coordinate.lng,
          timestamp: Date.now(),
          accuracy: 5,
        });
      (window as any).mockBridge = {
        getDeviceInfo: async () => ({
          model: "g2",
          status: { connectType: "connected" },
        }),
        onDeviceStatusChanged: () => () => {},
        onEvenHubEvent: (callback: any) => {
          eventListener = callback;
          return () => {};
        },
        getAppLocation: async () => ({
          latitude: 35.6812,
          longitude: 139.7671,
          timestamp: Date.now(),
          accuracy: 5,
        }),
        onAppLocationChanged: (callback: any) => {
          fixListener = callback;
          return () => {};
        },
        startAppLocationUpdates: async () => true,
        stopAppLocationUpdates: async () => true,
        createStartUpPageContainer: async () => 0,
        rebuildPageContainer: async () => true,
        updateImageRawData: async (value: any) => {
          (window as any).hudImages[value.containerID] = value.imageData;
          return "success";
        },
        shutDownPageContainer: async () => true,
      };
      (window as any).waitForTransitFrame = async () => {
        const path = "/src/hud-renderer.ts";
        const { renderHud } = await import(path);
        for (let i = 0; i < 150; i++) {
          const frame = (window as any).lastFrame;
          if (frame) {
            const expected = await renderHud(frame);
            if (
              expected.every(
                (bytes: Uint8Array, index: number) =>
                  JSON.stringify(Array.from(bytes)) ===
                  JSON.stringify((window as any).hudImages[index + 1]),
              )
            )
              return;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error("Transit guidance did not reach native display");
      };
    });
    await page.getByRole("button", { name: "连接 Even App / G2" }).click();
    await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
    await page.getByRole("button", { name: /导入链接/ }).click();
    await page.getByRole("button", { name: "公共交通", exact: true }).click();
    await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
    await expect(page.locator(".route-summary-line")).toContainText(
      `${transfers} 次换乘`,
    );
    if (transfers === 2)
      await page.evaluate(() => {
        (window as any).holdWalkMap = true;
      });
    await page.getByRole("button", { name: "开始导航 ↗" }).click();
    const snapshot = () =>
      page.evaluate(() => {
        const s = (window as any).navSession.snapshot;
        return {
          leg: s.legIndex,
          mode: s.route.legs[s.legIndex].mode,
          phase: s.phase,
          boarded: s.boarded,
        };
      });
    await expect.poll(async () => (await snapshot()).mode).toBe("WALK");
    if (transfers === 2)
      await expect
        .poll(() => page.evaluate(() => typeof (window as any).releaseWalkMap))
        .toBe("function");
    const advanceWalk = () =>
      page.evaluate(() => {
        const s = (window as any).navSession.snapshot;
        (window as any).emitFix(s.route.legs[s.legIndex].geometry.at(-1));
      });
    await advanceWalk();
    await expect.poll(async () => (await snapshot()).mode).toBe("WAIT");
    if (transfers === 2) {
      await page.evaluate(() => (window as any).releaseWalkMap());
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).lastFrame?.guidance.action),
        )
        .toBe("候车 合成1号线");
      expect(
        await page.evaluate(() =>
          (window as any).phaseFrames.filter(
            (frame: any) => frame.leg === 1 && frame.action.includes("沿路线"),
          ),
        ),
      ).toEqual([]);
    }
    await page.clock.install();
    await page.clock.fastForward(60000);
    await expect(page.locator("#nav-current-text")).toContainText(
      "候车 合成1号线",
    );
    await expect(page.locator("#transit-phase-detail")).toContainText(
      "方向 方向1站",
    );
    await expect(page.locator("#transit-phase-detail")).toContainText("1站台");
    const saveNative = async (path: string) => {
      const image = await page.evaluate(async () => {
        const c = document.createElement("canvas");
        c.width = 576;
        c.height = 288;
        for (let j = 0; j < 4; j++) {
          const b = await createImageBitmap(
            new Blob([new Uint8Array((window as any).hudImages[j + 1])], {
              type: "image/png",
            }),
          );
          c.getContext("2d")!.drawImage(
            b,
            (j % 2) * 288,
            Math.floor(j / 2) * 144,
          );
          b.close();
        }
        return c.toDataURL().split(",")[1];
      });
      await writeFile(path, Buffer.from(image, "base64"));
    };
    const confirm = async (action: string) => {
      await expect(page.locator(`[data-transit="${action}"]`)).toHaveCount(1);
      const before = await snapshot();
      // Phone state can advance before the asynchronous native image submission.
      // Every variant must wait for the actual display before sending menu gestures.
      await page.evaluate(() => (window as any).waitForTransitFrame());
      await page.evaluate(() => (window as any).emitGesture(3, 20));
      await page.evaluate(async (action) => {
        const path = "/src/hud-menu.ts";
        const { renderHudMenuTile, HUD_MENU_ITEMS } = await import(path);
        const guidancePath = "/src/guidance.ts";
        const { transitActionLabels } = await import(guidancePath);
        const promptId = (window as any).navSession.snapshot.transitPrompt?.id;
        const bytes = await renderHudMenuTile(0, undefined, [
          { label: transitActionLabels[action], action },
          ...(promptId ? [{ label: "暂不确认", action: "DEFER_TRANSIT" }] : []),
          ...HUD_MENU_ITEMS,
        ]);
        // Only the opaque menu rectangle is stable: the map under the left
        // 108px may update during emitGesture's debounce wait or composition.
        const menuPixels = async (png: Uint8Array) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(png)], { type: "image/png" }),
          );
          const canvas = document.createElement("canvas");
          canvas.width = 180;
          canvas.height = 144;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(bitmap, 108, 0, 180, 144, 0, 0, 180, 144);
          bitmap.close();
          return ctx.getImageData(0, 0, 180, 144).data;
        };
        const expected = await menuPixels(bytes);
        for (let i = 0; i < 100; i++) {
          if (
            (window as any).navSession.snapshot.transitPrompt?.id !== promptId
          )
            throw new Error(
              "Transit confirmation context changed while waiting for menu",
            );
          const actualBytes = (window as any).hudImages[2];
          if (actualBytes) {
            const actual = await menuPixels(new Uint8Array(actualBytes));
            if (expected.every((value, index) => value === actual[index]))
              return;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error("Transit menu did not reach h1");
      }, action);
      if (transfers === 2 && action === "BOARDED" && before.leg === 1) {
        await saveNative(".local/evidence/hud-transit-board-menu-native.png");
      }
      await page.evaluate(() => (window as any).emitGesture(0, 20));
      expect(await snapshot()).toEqual(before);
      await page.evaluate(() => (window as any).emitGesture(3, 20));
      await expect.poll(snapshot).not.toEqual(before);
    };
    for (let i = 0; i <= transfers; i++) {
      await confirm("BOARDED");
      await expect.poll(async () => (await snapshot()).boarded).toBe(true);
      await expect(page.locator("#nav-current-text")).toContainText(
        `乘坐 合成${i + 1}号线`,
      );
      await expect(page.locator("#nav-next-text")).toContainText(
        `下车 合成${i + 1}下车站`,
      );
      // A station GPS fix alone must never establish alighting.
      await page.clock.fastForward(10000);
      await advanceWalk();
      await expect.poll(async () => (await snapshot()).mode).toBe("RIDE");
      if (transfers === 2 && i === 0) {
        await page.evaluate(() => (window as any).waitForTransitFrame());
        const image = await page.evaluate(async () => {
          const c = document.createElement("canvas");
          c.width = 576;
          c.height = 288;
          for (let j = 0; j < 4; j++) {
            const b = await createImageBitmap(
              new Blob([new Uint8Array((window as any).hudImages[j + 1])], {
                type: "image/png",
              }),
            );
            c.getContext("2d")!.drawImage(
              b,
              (j % 2) * 288,
              Math.floor(j / 2) * 144,
            );
            b.close();
          }
          return c.toDataURL().split(",")[1];
        });
        await writeFile(
          ".local/evidence/hud-transit-ride-native.png",
          Buffer.from(image, "base64"),
        );
      }
      await confirm("ALIGHTED");
      if (i < transfers) {
        await expect.poll(async () => (await snapshot()).mode).toBe("TRANSFER");
        if (transfers === 2 && i === 0) {
          await page.evaluate(() => (window as any).waitForTransitFrame());
          await saveNative(".local/evidence/hud-transit-transfer-native.png");
          await page.screenshot({
            path: ".local/evidence/transit-phone-transfer.png",
          });
        }
        await confirm("TRANSFER_COMPLETED");
        await expect.poll(async () => (await snapshot()).mode).toBe("WAIT");
      }
    }
    await expect.poll(async () => (await snapshot()).mode).toBe("WALK");
    await expect(page.locator("#transit-phase-detail")).toContainText(
      "最终目的地",
    );
    // Respect the existing walking speed and geometry-match window instead of teleporting.
    await page.clock.fastForward(180000);
    await advanceWalk();
    await expect.poll(async () => (await snapshot()).phase).toBe("ARRIVED");
    expect(transitRequests).toBe(1);
  });
