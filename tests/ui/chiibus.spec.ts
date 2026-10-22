import { test, expect } from "@playwright/test";

test("Chiibus and rail candidates switch maps and retain bus stops and departure guidance", async ({
  page,
  context,
}) => {
  // Synthetic locations and timetable: no private fixture or live provider request.
  const now = Date.now();
  const time = (seconds: number) =>
    new Date(now + seconds * 1000).toISOString();
  const origin = { lat: 35.68, lng: 139.76 };
  const boarding = { lat: 35.6804, lng: 139.76 };
  const alighting = { lat: 35.686, lng: 139.76 };
  const destination = { lat: 35.6864, lng: 139.76 };
  const routes = ["赤坂ルート", "青山ルート", "合成地下铁"].map(
    (line, index) => {
      const bus = index < 2;
      const transitMode = bus ? "BUS" : "RAIL";
      const bend = { lat: 35.683, lng: 139.76 + (index - 1) * 0.003 };
      const departure = 300 + index * 60;
      const arrival = departure + 600;
      return {
        id: `synthetic-chiibus-${index}`,
        provider: bus ? "CHIIBUS_GTFS" : "TRANSITOUS",
        basemapProvider: "GOOGLE_TILES",
        fetchedAt: time(0),
        expiresAt: time(3600),
        distanceMeters: 1080,
        durationSeconds: arrival + 60,
        warnings: [],
        attribution: ["Synthetic timetable"],
        legs: [
          {
            mode: "WALK",
            from: "合成起点",
            to: "合成上车站",
            geometry: [origin, boarding],
            steps: [
              {
                instruction: "沿合成步道前行",
                geometry: [origin, boarding],
                distanceMeters: 40,
                durationSeconds: 60,
                maneuver: "STRAIGHT",
              },
            ],
            distanceMeters: 40,
            durationSeconds: 60,
            startTime: time(0),
            endTime: time(60),
          },
          {
            mode: "WAIT",
            transitMode,
            line,
            from: "合成上车站",
            headsign: "合成总站",
            geometry: [boarding],
            steps: [],
            distanceMeters: 0,
            durationSeconds: departure - 60,
            startTime: time(60),
            endTime: time(departure),
          },
          {
            mode: "RIDE",
            transitMode,
            line,
            headsign: "合成总站",
            from: "合成上车站",
            to: "合成下车站",
            geometry: [boarding, bend, alighting],
            steps: [],
            distanceMeters: 1000,
            durationSeconds: 600,
            startTime: time(departure),
            endTime: time(arrival),
            fromStop: {
              name: "合成上车站",
              coordinate: boarding,
              departureTime: time(departure),
            },
            toStop: {
              name: "合成下车站",
              coordinate: alighting,
              arrivalTime: time(arrival),
            },
            intermediateStops: [
              {
                name: "合成中途站",
                coordinate: bend,
                arrivalTime: time(departure + 300),
              },
            ],
          },
          {
            mode: "WALK",
            from: "合成下车站",
            to: "合成终点",
            geometry: [alighting, destination],
            steps: [
              {
                instruction: "沿合成步道到达终点",
                geometry: [alighting, destination],
                distanceMeters: 40,
                durationSeconds: 60,
                maneuver: "STRAIGHT",
              },
            ],
            distanceMeters: 40,
            durationSeconds: 60,
            startTime: time(arrival),
            endTime: time(arrival + 60),
          },
        ],
      };
    },
  );
  await page.clock.install({ time: now });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: origin.lat,
    longitude: origin.lng,
    accuracy: 5,
  });
  const unexpectedRequests: string[] = [];
  let routeQueries = 0;
  let tile = "";
  await page.route(/^https:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://worker.test") {
      unexpectedRequests.push(url.origin);
      return route.abort();
    }
    const path = url.pathname;
    if (path === "/v1/auth/pair")
      return route.fulfill({
        json: {
          deviceToken: "synthetic-chiibus-device-token",
          expiresAt: time(86400),
        },
      });
    if (path === "/v1/providers")
      return route.fulfill({ json: { google: { configured: true } } });
    if (path === "/v1/routes/transit") {
      routeQueries++;
      const request = route.request().postDataJSON();
      expect(request.origin).toEqual(origin);
      expect(request.routeProvider).toBe("TRANSITOUS");
      return route.fulfill({
        json: { requestVersion: request.requestVersion, routes },
      });
    }
    if (path === "/v1/maps/google/session")
      return route.fulfill({
        json: {
          session: "synthetic-chiibus",
          expiry: String(now / 1000 + 3600),
          tileWidth: 256,
          tileHeight: 256,
        },
      });
    if (path === "/v1/maps/google/viewport")
      return route.fulfill({ json: { copyright: "Synthetic map fixture" } });
    if (path.startsWith("/v1/maps/google/tiles/"))
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(tile, "base64"),
      });
    unexpectedRequests.push(path);
    return route.abort();
  });
  await page.goto("/");
  tile = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#aaa";
    ctx.fillRect(0, 120, 256, 5);
    return canvas.toDataURL("image/png").split(",")[1];
  });
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
  await expect(page.getByRole("tab")).toHaveCount(3);
  const summary = page.locator("#route-summary");
  const canvas = page.locator("#route-preview");
  await expect(canvas).toBeVisible();
  const mapSignatures: string[] = [];
  for (const [index, line] of [
    "赤坂ルート",
    "青山ルート",
    "合成地下铁",
  ].entries()) {
    await page.getByRole("tab").nth(index).click();
    await expect(page.getByRole("tab").nth(index)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(summary).toContainText(
      `乘坐 ${index < 2 ? "公交 " : ""}${line} · 往合成总站`,
    );
    await expect(summary).toContainText("合成中途站");
    await expect(canvas).toHaveAttribute(
      "aria-label",
      `路线 ${index + 1} 道路地图`,
    );
    await expect(canvas).toBeVisible();
    if (index)
      await expect
        .poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL()))
        .not.toBe(mapSignatures[index - 1]);
    mapSignatures.push(
      await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL()),
    );
  }
  expect(new Set(mapSignatures).size).toBe(3);
  await page.getByRole("tab").nth(1).click();
  await expect(summary).toContainText("公交 青山ルート");
  await expect(summary).not.toContainText(
    /站台|建议入口|建议出口|线路名称待补充/,
  );
  await page.getByRole("button", { name: "开始导航 ↗" }).click();
  const departure = page.locator("#nav-departure");
  await expect(departure).toContainText("下一班 公交 青山ルート · 往合成总站");
  await expect(departure).toContainText("时刻表发车");
  await expect(departure).toContainText(/\d+分\d+秒/);
  const before = await departure.textContent();
  await page.clock.fastForward(2000);
  await expect(departure).not.toHaveText(before!);
  await expect(page.locator("#nav-access")).toBeHidden();

  // Shared overview model feeds G2 full-screen route pages; native transport is not mocked here.
  const overview = await page.evaluate(async (routes) => {
    const modulePath = "/src/route-overview.ts";
    const { routeOverviewSteps } = await import(modulePath);
    return routes
      .slice(0, 2)
      .map((route) =>
        routeOverviewSteps(route, 0, 0).map(
          (step: { text: string }) => step.text,
        ),
      );
  }, routes);
  for (const [index, steps] of overview.entries()) {
    expect(steps).toHaveLength(4);
    expect(steps.join("\n")).toContain(
      index === 0 ? "公交 赤坂ルート" : "公交 青山ルート",
    );
    expect(steps.join("\n")).toContain("合成中途站");
    expect(steps.join("\n")).toContain("合成上车站");
    expect(steps.join("\n")).toContain("合成下车站");
    expect(steps.join("\n")).not.toMatch(/站台|建议入口|建议出口/);
  }
  expect(routeQueries).toBe(1);
  expect(unexpectedRequests).toEqual([]);
});
