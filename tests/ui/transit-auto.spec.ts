import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const epoch = Date.parse("2026-10-21T00:00:00Z");
const point = (north: number, east = 0) => ({
  lat: 35.68 + north / 111195.08,
  lng: 139.76 + east / (111195.08 * Math.cos((35.68 * Math.PI) / 180)),
});
const time = (seconds: number) =>
  new Date(epoch + seconds * 1000).toISOString();
const segment = (
  mode: string,
  north: number,
  east: number,
  endNorth: number,
  endEast: number,
  start: number,
  end: number,
) => ({
  mode,
  geometry: [point(north, east), point(endNorth, endEast)],
  distanceMeters: Math.hypot(endNorth - north, endEast - east),
  durationSeconds: end - start,
  startTime: time(start),
  endTime: time(end),
  steps:
    mode === "WALK"
      ? [
          {
            instruction: "在第一个小路口左转",
            geometry: [point(north, east), point(endNorth, endEast)],
            distanceMeters: 200,
            durationSeconds: end - start,
          },
        ]
      : [],
});
const legs = [
  {
    ...segment("WAIT", 0, 0, 0, 0, 0, 30),
    from: "合成起点站",
    line: "合成蓝线",
  },
  {
    ...segment("RIDE", 0, 0, 1000, 0, 30, 130),
    line: "合成蓝线",
    headsign: "合成终点方向",
    from: "合成起点站",
    to: "合成终点站",
    fromStop: {
      name: "合成起点站",
      coordinate: point(0),
      scheduledPlatform: "3",
      departureTime: time(30),
    },
    toStop: {
      name: "合成终点站",
      coordinate: point(1000),
      arrivalTime: time(130),
    },
    intermediateStops: Array.from({ length: 12 }, (_, i) => ({
      name: `合成中途站${i + 1}`,
      arrivalTime: time(35 + i * 7),
      cancelled: i === 5,
    })),
  },
  {
    ...segment("WALK", 1000, 0, 1000, 200, 130, 270),
    from: "合成终点站",
    to: "最终目的地",
  },
];

async function nativeImage(page: Page, path: string) {
  const image = await page.evaluate(async () => {
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
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(path, Buffer.from(image, "base64"));
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(epoch) });

  await page.route("**/src/runtime.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export const isEvenHost=()=>Boolean(window.mockNative); export const getEvenBridge=async()=>window.mockBridge;",
    }),
  );
  await page.route("https://worker.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/pair")
      return route.fulfill({
        json: {
          deviceToken: "synthetic-device-token-for-ui-tests",
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
              id: "automatic-transit",
              provider: "TRANSITOUS",
              basemapProvider: "GOOGLE_TILES",
              fetchedAt: time(0),
              expiresAt: time(3600),
              distanceMeters: 1200,
              durationSeconds: 270,
              warnings: [],
              attribution: ["Synthetic Transit"],
              legs,
            },
          ],
        },
      });
    if (path.endsWith("/session")) {
      const size = route.request().postDataJSON()?.display === "G2" ? 512 : 256;
      return route.fulfill({
        json: {
          session: `mock-${size}`,
          expiry: String(epoch / 1000 + 3600),
          tileWidth: size,
          tileHeight: size,
        },
      });
    }
    if (path.endsWith("/viewport"))
      return route.fulfill({ json: { copyright: "Synthetic transit map" } });
    if (path.includes("/tiles/")) {
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = c.height = 512;
        c.getContext("2d")!.fillRect(0, 0, 512, 512);
        return c.toDataURL().split(",")[1];
      });
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(png, "base64"),
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { code: "PROVIDER_UNAVAILABLE" } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("Worker 首次配对凭据").fill("synthetic-owner");
  await page.getByRole("button", { name: "首次配对并连接" }).click();
  await expect(page.getByText("后端已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.evaluate(async (initial) => {
    const source = await (await fetch("/src/main.ts")).text();
    const corePath = source.match(
      /from\s+["']([^"']*packages\/core\/src\/navigation[^"']*)["']/,
    )![1];
    const { NavigationSession } = await import(corePath);
    const start = NavigationSession.prototype.start;
    NavigationSession.prototype.start = function (...args: any[]) {
      (window as any).navSession = this;
      return start.apply(this, args);
    };
    const path = "/src/device.ts";
    const { LatestFrameQueue } = await import(path);
    const push = LatestFrameQueue.prototype.push;
    LatestFrameQueue.prototype.push = function (frame: any) {
      (window as any).lastFrame = frame;
      return push.call(this, frame);
    };
    let event: any, fix: any;
    (window as any).hudImages = {};
    (window as any).mockNative = true;
    (window as any).emitGesture = (type: number) => {
      for (let i = 0; i < 20; i++)
        event?.({ sysEvent: { eventType: type, eventSource: 1 } });
    };
    (window as any).emitFix = (coordinate: any) =>
      fix?.({
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
        event = callback;
        return () => {};
      },
      getAppLocation: async () => ({
        latitude: initial.lat,
        longitude: initial.lng,
        timestamp: Date.now(),
        accuracy: 5,
      }),
      onAppLocationChanged: (callback: any) => {
        fix = callback;
        return () => {};
      },
      startAppLocationUpdates: async () => true,
      stopAppLocationUpdates: async () => true,
      createStartUpPageContainer: async () => 0,
      rebuildPageContainer: async () => true,
      shutDownPageContainer: async () => true,
      updateImageRawData: async (value: any) => {
        (window as any).hudImages[value.containerID] = value.imageData;
        return "success";
      },
    };
  }, point(0));
  await page.getByRole("button", { name: "连接 Even App / G2" }).click();
  const end = point(1000, 200);
  await page
    .getByLabel("GOOGLE MAPS 分享链接")
    .fill(
      `https://www.google.com/maps/dir/?api=1&destination=${end.lat},${end.lng}&travelmode=transit`,
    );
  await page.getByRole("button", { name: /导入链接/ }).click();
  await page.getByRole("button", { name: "公共交通", exact: true }).click();
  await page.getByRole("button", { name: "确认目的地，查询路线" }).click();
  await expect(page.getByRole("button", { name: "开始导航 ↗" })).toBeVisible();
});

async function gesture(page: Page, type: number) {
  await page.clock.fastForward(400);
  await page.evaluate((type) => (window as any).emitGesture(type), type);
}
async function state(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).navSession.snapshot;
    return {
      leg: s.legIndex,
      boarded: s.boarded,
      phase: s.phase,
      prompt: s.transitPrompt,
    };
  });
}

for (const failRefresh of [false, true])
  test(`missed train refresh ${failRefresh ? "HTTP failure keeps old navigation without retries" : "uses a real future service on the confirmed line"}`, async ({
    page,
  }) => {
    await page.getByRole("button", { name: "开始导航 ↗" }).click();
    let requests = 0;
    await page.route("https://worker.test/v1/routes/transit", async (route) => {
      requests++;
      const next = requests > 1;
      if (next && failRefresh) {
        // More GPS/timer ticks occur while the one upstream request is pending.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return route.fulfill({
          status: 503,
          json: { error: { code: "PROVIDER_UNAVAILABLE" } },
        });
      }
      const departure = next ? 600 : 30;
      const ride = legs[1];
      if (!("fromStop" in ride) || !("toStop" in ride))
        throw new Error("Synthetic ride fixture must include both stops");
      const transitLegs = [
        {
          ...segment("WALK", 0, 0, 500, 0, 0, departure),
          from: "当前位置",
          to: "合成起点站",
        },
        {
          ...ride,
          startTime: time(departure),
          endTime: time(departure + 100),
          geometry: [point(500), point(1500)],
          fromStop: {
            ...ride.fromStop,
            coordinate: point(500),
            departureTime: time(departure),
          },
          toStop: {
            ...ride.toStop,
            coordinate: point(1500),
            arrivalTime: time(departure + 100),
          },
        },
        {
          ...segment(
            "WALK",
            1500,
            0,
            1500,
            200,
            departure + 100,
            departure + 240,
          ),
          from: "合成终点站",
          to: "最终目的地",
        },
      ];
      await route.fulfill({
        json: {
          requestVersion: route.request().postDataJSON().requestVersion,
          routes: [
            {
              id: next ? "next-real-service" : "missed-service",
              provider: "TRANSITOUS",
              basemapProvider: "GOOGLE_TILES",
              fetchedAt: new Date(epoch + (next ? 35000 : 0)).toISOString(),
              expiresAt: time(3600),
              distanceMeters: 1700,
              durationSeconds: departure + 240,
              warnings: [],
              attribution: [
                "© OpenStreetMap contributors",
                "Transitous",
                "NAVITIME JAPAN",
              ],
              legs: transitLegs,
            },
          ],
        },
      });
    });
    await page.getByRole("button", { name: "重新规划", exact: true }).click();
    await page.getByRole("button", { name: "开始导航 ↗" }).click();
    await expect(page.locator("#nav-departure")).toContainText(
      "计划发车 09:00 · 0分",
    );
    for (let second = 1; second <= 36; second++) {
      await page.clock.fastForward(1000);
      await page.evaluate(
        (coordinate) => (window as any).emitFix(coordinate),
        point(0),
      );
    }
    if (failRefresh) {
      await expect(page.locator("#nav-departure")).toContainText(
        "下一班查询未完成",
      );
      expect(
        await page.evaluate(() => (window as any).navSession.snapshot.route.id),
      ).toBe("missed-service");
      expect((await state(page)).phase).toBe("NAVIGATING");
      for (let i = 0; i < 65; i++) {
        await page.clock.fastForward(1000);
        await page.evaluate(
          (coordinate) => (window as any).emitFix(coordinate),
          point(0),
        );
      }
      expect(requests).toBe(2);
      await expect(page.locator("#nav-departure")).not.toContainText("09:10");
      return;
    }
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).navSession.snapshot.route.id),
      )
      .toBe("next-real-service");
    expect(requests).toBe(2);
    expect((await state(page)).phase).toBe("NAVIGATING");
    await expect(page.locator("#nav-departure")).toContainText("09:10");
    await expect
      .poll(() => page.evaluate(() => (window as any).lastFrame.status))
      .toContain("09:10");
    await page.screenshot({
      path: ".local/evidence/transit-departure-phone.png",
      fullPage: true,
    });
    await expect
      .poll(() =>
        page.evaluate(() => Object.keys((window as any).hudImages).length),
      )
      .toBe(4);
    await nativeImage(page, ".local/evidence/transit-departure-g2.png");
    for (let i = 0; i < 10; i++) {
      await page.clock.fastForward(1000);
      await page.evaluate(
        (coordinate) => (window as any).emitFix(coordinate),
        point(0),
      );
    }
    expect(requests).toBe(2);
  });

test("automatic boarding and alighting need no clicks; transit overview preserves every supplied stop", async ({
  page,
}) => {
  const itinerary = page.locator(".selected-itinerary");
  await expect(itinerary).toContainText("合成中途站12");
  await expect(itinerary).toContainText("计划3站台");
  await expect(itinerary).toContainText("步行 200米");
  await expect(itinerary).not.toContainText("第一个小路口");
  await expect(
    itinerary.getByText("合成中途站12 · 09:01", { exact: true }),
  ).toHaveCount(1);
  await expect(page.locator("#route-preview")).toBeVisible();
  await page.screenshot({
    path: ".local/evidence/transit-summary-phone.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  await expect.poll(async () => (await state(page)).leg).toBe(0);
  await expect(page.locator(".transit-prompt")).toHaveCount(0);
  for (let second = 30; second <= 56; second++) {
    await page.clock.fastForward(second === 30 ? 30000 : 1000);
    await page.evaluate(
      (coordinate) => (window as any).emitFix(coordinate),
      point((second - 30) * 4.5),
    );
  }
  await expect.poll(async () => (await state(page)).boarded).toBe(true);
  await expect(page.locator(".transit-prompt")).toHaveCount(0);
  await expect(page.locator("#nav-current-text")).toContainText(
    "乘坐 合成蓝线",
  );
  // Travel at train speed, anchor at terminal, then walk away along the final leg.
  for (let second = 57; second <= 145; second++) {
    await page.clock.fastForward(1000);
    await page.evaluate(
      (coordinate) => (window as any).emitFix(coordinate),
      point(Math.min(1000, 117 + (second - 56) * 10)),
    );
  }
  for (let second = 146; second <= 175; second++) {
    await page.clock.fastForward(1000);
    await page.evaluate(
      (coordinate) => (window as any).emitFix(coordinate),
      point(1000, (second - 145) * 1.5),
    );
  }
  await expect.poll(async () => (await state(page)).leg).toBe(2);
  expect((await state(page)).boarded).toBe(false);
  await expect(page.locator(".transit-prompt")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys((window as any).hudImages).length),
    )
    .toBe(4);
  // No transit manual action exists in WALK, so VIEW_ROUTE is the first menu item.
  await gesture(page, 3);
  await gesture(page, 3);
  const pageCount = await page.evaluate(async () => {
    const overviewPath = "/src/route-overview.ts",
      menuPath = "/src/hud-menu.ts";
    const { routeOverviewSteps } = await import(overviewPath);
    const { buildHudStepPages } = await import(menuPath);
    const s = (window as any).navSession.snapshot,
      c = document.createElement("canvas"),
      ctx = c.getContext("2d")!;
    ctx.font = '22px "Microsoft YaHei", "PingFang SC", sans-serif';
    const pages = buildHudStepPages(
      routeOverviewSteps(s.route, s.legIndex, s.stepIndex),
      (text: string) => ctx.measureText(text).width,
    );
    (window as any).expectedOverviewPages = pages;
    return pages.length;
  });
  for (let i = 0; i < pageCount; i++) await gesture(page, 2);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/hud-overview.ts";
        const { renderHudOverview } = await import(path);
        const expected = await renderHudOverview(
          (window as any).lastFrame,
          (window as any).expectedOverviewPages.at(-1),
        );
        return expected.every(
          (b: Uint8Array, i: number) =>
            JSON.stringify(Array.from(b)) ===
            JSON.stringify((window as any).hudImages[i + 1]),
        );
      }),
    )
    .toBe(true);
  await nativeImage(page, ".local/evidence/transit-summary-g2-last-page.png");
});

test("uncertain underground boarding asks once; G2 defer needs double click and preserves phase", async ({
  page,
}) => {
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  await page.clock.fastForward(61000);
  await expect(page.locator(".transit-prompt")).toContainText("上车");
  const before = await state(page);
  expect(before.prompt?.action).toBe("BOARDED");
  await expect
    .poll(() => page.evaluate(() => (window as any).lastFrame?.status))
    .toContain("双击菜单");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/hud-renderer.ts";
        const { renderHud } = await import(path);
        const expected = await renderHud((window as any).lastFrame);
        return expected.every(
          (bytes: Uint8Array, index: number) =>
            JSON.stringify(Array.from(bytes)) ===
            JSON.stringify((window as any).hudImages[index + 1]),
        );
      }),
    )
    .toBe(true);
  await nativeImage(page, ".local/evidence/transit-uncertain-g2.png");
  await gesture(page, 3);
  await gesture(page, 2);
  await gesture(page, 0);
  expect(await state(page)).toEqual(before);
  await gesture(page, 3);
  await expect(page.locator(".transit-prompt")).toHaveCount(0);
  expect(await state(page)).toMatchObject({ leg: 0, boarded: false });
  await page.clock.fastForward(119000);
  await expect(page.locator(".transit-prompt")).toHaveCount(0);
  await expect(page.locator(".manual-transit")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).lastFrame?.status.includes("双击菜单"),
      ),
    )
    .toBe(false);
});
