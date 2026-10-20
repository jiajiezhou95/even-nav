import { test, expect, type Page } from "@playwright/test";

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

const credentialKey = "even-nav.device-credential.v1";
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
    .locator(".navigation details")
    .evaluate((el: HTMLDetailsElement) => {
      el.open = true;
    });
  await page.locator("#app").evaluate((el) => {
    el.scrollTop = 700;
  });
  const original = await page.locator(".navigation details").elementHandle();
  const before = await page.locator("#app").evaluate((el) => el.scrollTop);
  await page.clock.runFor(2200);
  expect(
    await original!.evaluate(
      (el) => el === document.querySelector(".navigation details"),
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".navigation details")
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
  await page.clock.runFor(6000);
  await expect(page.locator("#nav-instruction")).toContainText("定位已过期");
});
