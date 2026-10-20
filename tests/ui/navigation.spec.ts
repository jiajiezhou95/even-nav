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
  await page.getByLabel("GOOGLE MAPS 分享链接").fill("35.6812,139.7701");
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
  await expect(page.getByText("北向上", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Google Maps", exact: true }),
  ).toBeVisible();
  await page.locator("canvas").click({ position: { x: 120, y: 65 } });
  await expect(page.locator(".confirmation")).toBeVisible();
  const planned = page.waitForRequest("https://worker.test/v1/routes/road");
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  expect((await planned).postDataJSON().destination.source).toBe(
    "GOOGLE_API_CONTENT",
  );
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
  await page.getByLabel("GOOGLE MAPS 分享链接").fill("35.9, 139.9");
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
        json: { session: "mock", expiry: String(Date.now() / 1000 + 600) },
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
                  instruction: "沿合成大道前行",
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
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.locator(".route-card")).toHaveCount(1);
  await expect(
    page.getByText("Walking directions are in beta. Use caution."),
  ).toHaveCount(0);
  const mapBox = await canvas.boundingBox(),
    tabsBox = await page.getByRole("tablist").boundingBox();
  expect(mapBox!.y + mapBox!.height).toBeLessThan(tabsBox!.y);
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
          ? { session: "synthetic", expiry: String(Date.now() / 1000 + 600) }
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
  await expect(upload).toBeEnabled();
  const localReport = await page.locator("#imu-report").inputValue();
  await upload.click();
  await expect(page.locator("#imu-upload-status")).toHaveText(
    "已上传 1 条采样 · 回执 12345678",
  );
  expect(uploads).toEqual([
    {
      schemaVersion: 1,
      samples: [
        { receivedAt: expect.any(Number), phase: "left", x: 1, y: 2, z: 3 },
      ],
    },
  ]);
  await expect(page.locator("#imu-report")).toHaveValue(localReport);
  expect(navigations).toEqual([]);
  expect(page.url()).toBe("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "开始采样", exact: true }).click();
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
  const upload = page.getByRole("button", { name: "上传采样", exact: true });
  await upload.click();
  await expect(upload).toBeDisabled();
  await captureImu(page);
  releaseUpload();
  await expect(upload).toBeEnabled();
  await expect(page.locator("#imu-upload-status")).not.toContainText("已上传");
  await expect(page.locator("#imu-upload-status")).not.toContainText(
    "12345678",
  );
});
