import { test, expect, type Page } from "@playwright/test";
import type {
  ConfirmedTripRequest,
  Route,
} from "../../packages/contracts/src/index";
const link =
  "https://www.google.com/maps/dir/?api=1&destination=35,139.02&travelmode=transit";

type Options = {
  expired?: boolean;
  departed?: boolean;
  failRefresh?: boolean;
  holdQuery?: number;
};
async function setup(page: Page, options: Options = {}) {
  const requests: ConfirmedTripRequest[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("https://worker.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/pair")
      return route.fulfill({
        json: {
          deviceToken: "synthetic-preview-device-token",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      });
    if (path === "/v1/providers")
      return route.fulfill({ json: { google: { configured: true } } });
    if (path.includes("/routes/")) {
      const trip = route.request().postDataJSON() as ConfirmedTripRequest;
      requests.push(trip);
      const index = requests.length;
      if (index === options.holdQuery) await held;
      if (options.failRefresh && index === 2)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "PROVIDER_UNAVAILABLE",
              message: "路线查询暂不可用",
              retryable: true,
            },
          },
        });
      const now = await page.evaluate(() => Date.now());
      const geometry = [trip.origin, trip.destination.coordinate!];
      const result: Route = {
        id: `route-${index}`,
        provider: "TRANSITOUS",
        basemapProvider: "GOOGLE_TILES",
        fetchedAt: new Date(now).toISOString(),
        expiresAt: new Date(
          now + (options.expired && index === 1 ? -1 : 600000),
        ).toISOString(),
        durationSeconds: 1200,
        distanceMeters: 2000,
        warnings: [],
        attribution: ["Synthetic"],
        legs: [
          {
            mode: "WALK",
            geometry,
            distanceMeters: 300,
            durationSeconds: 240,
            steps: [
              {
                geometry,
                instruction: `路线${index}步行`,
                maneuver: "STRAIGHT",
                distanceMeters: 300,
                durationSeconds: 240,
              },
            ],
          },
          {
            mode: "RIDE",
            transitMode: "BUS",
            line: `测试线${index}`,
            from: "测试上车站",
            to: "测试下车站",
            geometry,
            steps: [],
            distanceMeters: 1700,
            durationSeconds: 600,
            startTime: new Date(
              now + (options.departed && index === 1 ? -1000 : 300000),
            ).toISOString(),
            endTime: new Date(now + 900000).toISOString(),
          },
        ],
      };
      return route.fulfill({
        json: { requestVersion: trip.requestVersion, routes: [result] },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { code: "CONFIG_MISSING" } },
    });
  });
  await page.goto("/");
  await page.evaluate(() => {
    let latitude = 35;
    const position = (): GeolocationPosition => ({
      timestamp: Date.now(),
      coords: {
        latitude,
        longitude: 139,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      toJSON: () => ({}),
    });
    navigator.geolocation.getCurrentPosition = (success) => success(position());
    navigator.geolocation.watchPosition = () => 42;
    navigator.geolocation.clearWatch = () => {};
    Object.assign(window, {
      movePreview: () => {
        latitude = 35.002;
      },
    });
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("Worker 首次配对凭据").fill("synthetic-owner");
  await page.getByRole("button", { name: "首次配对并连接" }).click();
  await expect(page.getByText("后端已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "启用浏览器开发定位" }).click();
  await page.getByLabel("GOOGLE MAPS 分享链接").fill(link);
  await page.getByRole("button", { name: /导入链接/ }).click();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  return { requests, release };
}

test("fresh preview starts once without another route query; navigation has an explicit end-and-back", async ({
  page,
}) => {
  const { requests } = await setup(page);
  await page.locator("#start").click();
  await expect(page.locator(".navigation")).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "结束导航并返回" }).click();
  await expect(page.locator("#plan")).toBeEnabled();
  await expect(page.locator(".navigation")).toHaveCount(0);
});

for (const reason of ["expired", "departed", "moved"] as const) {
  test(`${reason} preview refreshes once from current GPS and requires confirmation`, async ({
    page,
  }) => {
    const { requests } = await setup(page, {
      expired: reason === "expired",
      departed: reason === "departed",
    });
    await expect(page.locator("#start")).toBeEnabled();
    if (reason === "moved")
      await page.evaluate(() => (window as any).movePreview());
    await page.locator("#start").click();
    await expect(
      page.getByText(/路线已更新，请确认路线后再次开始导航。/),
    ).toBeVisible();
    await expect(page.locator("#route-summary")).toContainText("测试线2");
    await expect(page.locator(".navigation")).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1].origin.lat).toBe(reason === "moved" ? 35.002 : 35);
    await page.locator("#start").click();
    await expect(page.locator(".navigation")).toBeVisible();
    expect(requests).toHaveLength(2);
  });
}

test("failed recovery offers query retry and back without obsolete coordinate advice or query loops", async ({
  page,
}) => {
  const { requests } = await setup(page, { expired: true, failRefresh: true });
  await page.locator("#start").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText("手动坐标");
  await expect(page.locator("#plan")).toBeEnabled();
  expect(requests).toHaveLength(2);
  await page.locator("#plan").click();
  await expect(page.locator("#route-summary")).toContainText("测试线3");
  expect(requests).toHaveLength(3);
});

test("back moves route selection to destination to preserved pasted link", async ({
  page,
}) => {
  const { requests } = await setup(page);
  await expect(page.locator("#start")).toBeEnabled();
  await page.getByRole("button", { name: "返回目的地" }).click();
  await expect(page.locator("#plan")).toBeEnabled();
  await expect(page.locator("#start")).toHaveCount(0);
  await page.getByRole("button", { name: "返回粘贴链接" }).click();
  await expect(page.getByLabel("GOOGLE MAPS 分享链接")).toHaveValue(link);
  await expect(page.locator(".confirmation, .route-choice")).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

for (const query of [1, 2]) {
  test(`back cancels ${query === 1 ? "planning" : "preview recovery"} and ignores its late response`, async ({
    page,
  }) => {
    const { requests, release } = await setup(page, {
      expired: query === 2,
      holdQuery: query,
    });
    if (query === 2) await page.locator("#start").click();
    await expect.poll(() => requests.length).toBe(query);
    await page.getByRole("button", { name: "返回目的地" }).click();
    await expect(page.locator("#plan")).toBeEnabled();
    release();
    await page.getByRole("button", { name: "返回粘贴链接" }).click();
    await expect(
      page.locator(".confirmation, .route-choice, .navigation"),
    ).toHaveCount(0);
    expect(requests).toHaveLength(query);
  });
}

for (const failed of [false, true]) {
  test(`back ignores a late ${failed ? "failed" : "successful"} start location reply`, async ({
    page,
  }) => {
    const { requests } = await setup(page);
    await expect(page.locator("#start")).toBeEnabled();
    await page.evaluate((failed) => {
      const original = navigator.geolocation.getCurrentPosition.bind(
        navigator.geolocation,
      );
      navigator.geolocation.getCurrentPosition = (success, error) => {
        Object.assign(window, {
          releaseLocation: () =>
            failed
              ? error?.({
                  code: 2,
                  message: "Synthetic location failure",
                  PERMISSION_DENIED: 1,
                  POSITION_UNAVAILABLE: 2,
                  TIMEOUT: 3,
                })
              : original(success, error),
        });
      };
    }, failed);
    await page.locator("#start").click();
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).releaseLocation))
      .toBe("function");
    await page.getByRole("button", { name: "返回目的地" }).click();
    await expect(page.locator("#plan")).toBeEnabled();
    await page.evaluate(() => (window as any).releaseLocation());
    await expect(page.locator(".confirmation")).toBeVisible();
    await expect(page.locator(".navigation, .route-choice")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(requests).toHaveLength(1);
  });
}
