import { test, expect, type Page } from "@playwright/test";
import type {
  ConfirmedTripRequest,
  Route,
} from "../../packages/contracts/src/index";
const link =
  "https://www.google.com/maps/dir/?api=1&destination=35,139.02&travelmode=walking";
function reply(
  trip: ConfirmedTripRequest,
  index: number,
  transit: boolean,
  changed = false,
): Route {
  const geometry = [trip.origin, { lat: trip.origin.lat, lng: 139.01 }];
  const leg = {
    mode: "WALK" as const,
    geometry,
    distanceMeters: index === 1 ? 2000 : 700,
    durationSeconds: 600,
    steps: [
      {
        geometry,
        instruction: index === 1 ? "旧路线原文" : "新的纠偏路线",
        maneuver: "STRAIGHT",
        distanceMeters: index === 1 ? 2000 : 700,
        durationSeconds: 600,
      },
    ],
  };
  return {
    id: `route-${index}`,
    provider: transit ? "TRANSITOUS" : "GOOGLE_ROUTES",
    basemapProvider: "GOOGLE_TILES",
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    distanceMeters: leg.distanceMeters,
    durationSeconds: 600,
    warnings: [],
    attribution: ["Synthetic"],
    legs: transit
      ? [
          leg,
          {
            mode: "RIDE",
            line: changed ? "乙线" : "甲线",
            agency: "测试公司",
            from: "甲站",
            to: "乙站",
            startTime: new Date(Date.now() + 300000).toISOString(),
            endTime: new Date(Date.now() + 600000).toISOString(),
            geometry: [geometry[1], trip.destination.coordinate!],
            steps: [],
            distanceMeters: 500,
            durationSeconds: 300,
          },
        ]
      : [leg],
  };
}
async function setup(
  page: Page,
  transit = false,
  handler?: (
    trip: ConfirmedTripRequest,
    index: number,
  ) => Promise<"fail" | "changed" | void>,
) {
  const requests: ConfirmedTripRequest[] = [];
  await page.route("https://worker.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/pair")
      return route.fulfill({
        json: {
          deviceToken: "synthetic-test-token",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      });
    if (path === "/v1/providers")
      return route.fulfill({ json: { google: { configured: true } } });
    if (path.includes("/routes/")) {
      const trip = route.request().postDataJSON() as ConfirmedTripRequest;
      requests.push(trip);
      const index = requests.length;
      const result = await handler?.(trip, index);
      if (result === "fail")
        return route.fulfill({
          status: 503,
          json: { error: { code: "PROVIDER_UNAVAILABLE", retryable: true } },
        });
      return route.fulfill({
        json: {
          requestVersion: trip.requestVersion,
          routes: [reply(trip, index, transit, result === "changed")],
        },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { code: "CONFIG_MISSING" } },
    });
  });
  await page.goto("/");
  await page.clock.install();
  await page.evaluate(() => {
    let latitude = 35,
      longitude = 139;
    let listener: PositionCallback | undefined;
    const position = (): GeolocationPosition => ({
      timestamp: Date.now(),
      coords: {
        latitude,
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
    navigator.geolocation.getCurrentPosition = (success) => success(position());
    navigator.geolocation.watchPosition = (success) => {
      listener = success;
      return 77;
    };
    navigator.geolocation.clearWatch = () => {
      listener = undefined;
    };
    Object.assign(window, {
      emitFix: (lat: number, lng = 139) => {
        latitude = lat;
        longitude = lng;
        listener?.(position());
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
  if (transit)
    await page.getByRole("button", { name: "公共交通", exact: true }).click();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  await expect(page.locator("#nav-current-text")).toHaveText("直行");
  return requests;
}
async function emit(page: Page, lat: number, elapsed = 2000) {
  await page.clock.runFor(elapsed);
  await page.evaluate((lat) => (window as any).emitFix(lat), lat);
}
async function deviate(page: Page) {
  for (const lat of [35.0004, 35.00042, 35.00044]) await emit(page, lat);
}

test("confirmed synthetic GPS deviation requests once from latest fix, suppresses old cue, resumes a new road route", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const requests = await setup(page, false, async (_, i) => {
    if (i === 2) await held;
  });
  await deviate(page);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].origin).toEqual({ lat: 35.00044, lng: 139 });
  expect(requests[1].destination).toEqual(requests[0].destination);
  expect(requests[1].mode).toBe("WALK");
  await expect(page.locator("#nav-current-text")).toHaveText("偏离路线");
  await expect(page.locator("#nav-step-distance")).toBeEmpty();
  await expect(page.locator("#nav-access")).toBeHidden();
  await emit(page, 35.00045);
  expect(requests).toHaveLength(2);
  release();
  await expect(page.locator("#nav-current-text")).toHaveText("直行");
  await expect(page.locator("#current-step-detail")).toHaveText("新的纠偏路线");
  await expect(page.locator(".route-choice")).toHaveCount(0);
});

test("transient query failure preserves navigation and retries only after cooldown plus a moved fix", async ({
  page,
}) => {
  const requests = await setup(page, false, async (_, i) =>
    i === 2 ? "fail" : undefined,
  );
  await deviate(page);
  await expect(page.locator("#nav-replan")).toContainText("重新规划未完成");
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await emit(page, 35.00045, 61000);
  expect(requests).toHaveLength(2);
  await emit(page, 35.0006);
  await expect.poll(() => requests.length).toBe(3);
  await expect(page.locator("#current-step-detail")).toHaveText("新的纠偏路线");
});

test("paused navigation rejects a late replacement", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const requests = await setup(page, false, async (_, i) => {
    if (i === 2) await held;
  });
  await deviate(page);
  await expect.poll(() => requests.length).toBe(2);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  release();
  await page.clock.runFor(1000);
  await expect(page.locator("#nav-current-text")).toHaveText("导航已暂停");
  await expect(page.locator(".route-choice")).toHaveCount(0);
});

test("changed transit ride requires route confirmation instead of silently boarding a new line", async ({
  page,
}) => {
  const requests = await setup(page, true, async (_, i) =>
    i === 2 ? "changed" : undefined,
  );
  await deviate(page);
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator(".route-choice")).toBeVisible();
  await expect(page.locator("#route-summary")).toContainText("乙线");
  await expect(page.getByRole("button", { name: "开始导航 ↗" })).toBeVisible();
});

test("unchanged transit ride automatically resumes the replacement approach", async ({
  page,
}) => {
  const requests = await setup(page, true);
  await deviate(page);
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator("#current-step-detail")).toHaveText("新的纠偏路线");
  await expect(page.locator(".route-choice")).toHaveCount(0);
});
