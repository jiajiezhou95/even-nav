import "./style.css";
import {
  NavigationSession,
  parseSharedInput,
  distanceMeters,
} from "../../../packages/core/src/index";
import {
  NavError,
  type EndpointCandidate,
  type ImportedIntent,
  type Mode,
  type Route,
  type ConfirmedTripRequest,
} from "../../../packages/contracts/src/index";
import { WorkerClient } from "./client";
import { EvenDevice, type DeviceFix } from "./device";
import { NavigationMap } from "./map";
import { staleInstruction, staleThreshold } from "./freshness";
import { createCredentialStore, DeviceCredentials } from "./credentials";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const time = (value: string | number) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
const duration = (seconds: number) => `${Math.ceil(seconds / 60)} 分钟`;
const distance = (meters: number) =>
  meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
const modes = { WALK: "步行", DRIVE: "驾驶", TRANSIT: "公共交通" };
const sourceLabels = {
  GOOGLE_MAPS_SHARED_LINK: "Google Maps 分享链接",
  GOOGLE_API_CONTENT: "Google 地点服务",
  OPEN_DATA: "开放地理数据",
  USER_INDEPENDENT_INPUT: "独立手动输入",
};
const evidenceLabels = {
  DOCUMENTED_FIELD: "公开字段",
  VERIFIED_LEGACY: "兼容格式",
  INFERRED: "推测结果，请核对",
  USER_INPUT: "用户输入",
};
const client = new WorkerClient(),
  session = new NavigationSession({ staleMs: 5000 }),
  map = new NavigationMap(client);
const credentials = new DeviceCredentials(client, createCredentialStore());
let authBusy = true;
let credentialStatus = "正在检查此设备的配对状态…";
let destination: EndpointCandidate | undefined,
  fix: DeviceFix | undefined,
  mode: Mode = "WALK";
let busy = false,
  selected = "",
  error = "",
  notice = "",
  health = "G2 未连接",
  backend = "未配置后端";
let originSelection = "current",
  departureSelection = "";
let mapError = "",
  mapPicking = false,
  sequence = 0,
  lastFrame = 0,
  tick: ReturnType<typeof setInterval> | undefined;
let mapBusy = false,
  mapPending = false,
  previousMapVersion = -1;
let lastMapFrame:
  | {
      version: number;
      pixels: Uint8Array;
      attribution: string;
      fixTimestamp?: number;
    }
  | undefined;
const device = new EvenDevice(
  onFix,
  (message) => {
    health = message;
    renderHealth();
  },
  (action) => void handleAction(action),
);

$("#app").innerHTML = `
  <header class="topbar"><a class="wordmark" href="#" aria-label="Even Nav 首页"><span class="mark">↗</span> even<span>nav</span></a><button class="icon-button" id="settings-button" aria-label="设置">⚙</button></header>
  <main>
    <div class="eyebrow">为你的下一程</div><h1>路在眼前。<br><span>从一个链接开始。</span></h1>
    <p class="intro">在 Google Maps 找好目的地，<br>把分享链接粘贴在这里。</p>
    <section class="import-card" aria-label="导入目的地">
      <div class="input-heading"><label for="share-input">GOOGLE MAPS 分享链接</label><button id="paste" class="text-button">粘贴</button></div>
      <textarea id="share-input" rows="3" maxlength="8192" spellcheck="false" placeholder="粘贴地点、路线链接或分享文本…" aria-describedby="input-help"></textarea>
      <div id="input-help" class="muted small">可直接长按粘贴 · 不读取剪贴板历史</div>
      <button id="import" class="primary wide">导入链接 <span>↗</span></button>
    </section>
    <nav class="fallbacks" aria-label="其他输入方式"><button id="manual-button">⌖ 输入地址 / 经纬度</button><button id="pick-button">⊕ 地图选点</button></nav>
    <div class="status-strip" id="health" aria-live="polite"></div>
    <div id="message" aria-live="polite"></div>
    <section id="workflow"></section>
    <section class="map-card" id="map-panel" hidden><div class="section-label"><span>地图预览</span><span id="map-state">等待真实底图</span></div><div id="map-host"></div><img id="google-attribution" src="/attribution/google-maps.svg" alt="Google Maps" hidden><p id="map-caption" class="small muted"></p><p id="attribution" class="attribution"></p><button id="refresh-map" class="text-button">刷新地图</button></section>
    <section class="explainer"><div class="path-line"><span>01 粘贴</span><i></i><span>02 确认路线</span><i></i><span>03 抬头出发</span></div><p>目的地从 Maps 导入，路线在 Even Nav 重新计算。<br>步行、驾驶，以及日本公共交通。</p></section>
    <footer><span>EVEN NAV</span><span>本人 Beta · 实机验证待完成</span></footer>
  </main>
  <dialog id="settings"><form method="dialog"><div class="dialog-heading"><h2>连接你的导航服务</h2><button aria-label="关闭设置" class="icon-button">×</button></div></form>
    <p class="muted">Google Key 保存在你自己的 Worker 中。此处只连接已打包允许的后端。</p>
    <label for="worker-origin">已绑定的 Worker 地址</label><input id="worker-origin" readonly value="${escape(client.origin)}" placeholder="尚未绑定，需配置并重新打包">
    <p class="small muted">更换域名后需重新打包，网络白名单会随构建更新。</p>
    <label for="worker-token">Worker 首次配对凭据</label><input id="worker-token" type="password" autocomplete="off" placeholder="只用于首次配对，不保存此管理员凭据">
    <p class="small muted">${credentials.store.kind === "EVEN_APP" ? "配对后的设备凭据保存在 Even App 应用存储，下次自动连接。这不等同于硬件安全存储。" : "浏览器预览：设备凭据保存在当前网站的本地存储，仅适用于此浏览器。"} 原始分享链接和路线不持久保存。</p>
    <p id="credential-status" class="small muted" aria-live="polite"></p>
    <button id="connect-backend" class="primary wide">首次配对并连接</button><button id="retry-backend" class="secondary wide">重试已保存的连接</button><button id="forget-backend" class="secondary wide danger">断开并忘记此设备</button><button id="connect-device" class="secondary wide">连接 Even App / G2</button>
    <button id="browser-location" class="text-button wide">启用浏览器开发定位</button><p class="small muted">开发定位不等于 Even GPS、G2 显示或锁屏持续导航。</p>
  </dialog>
  <dialog id="manual"><form method="dialog"><div class="dialog-heading"><h2>手动输入目的地</h2><button aria-label="关闭手动输入" class="icon-button">×</button></div></form>
    <label for="manual-input">完整地址或 纬度, 经度</label><input id="manual-input" placeholder="例如：35.6812, 139.7671"><p class="small muted">坐标按 WGS84 纬度在前。地址补全仅在提交时请求。</p><button id="manual-submit" class="primary wide">确认输入</button>
  </dialog>`;
$("#map-host").append(map.canvas);

function renderHealth() {
  $("#health").innerHTML =
    `<span><i class="${client.configured ? "ok" : ""}"></i>${escape(backend)}</span><span><i class="${device.connected ? "ok" : ""}"></i>${escape(health)}</span>`;
  $("#credential-status").textContent = credentialStatus;
  $<HTMLButtonElement>("#connect-backend").disabled =
    authBusy || client.configured;
  $<HTMLButtonElement>("#retry-backend").disabled =
    authBusy || !client.configured;
  $<HTMLButtonElement>("#forget-backend").disabled = authBusy;
}
function renderMessage() {
  $("#message").innerHTML = error
    ? `<div class="message error" role="alert"><strong>暂时无法继续</strong><p>${escape(error)}</p><button id="dismiss-error" class="text-button">知道了</button></div>`
    : notice
      ? `<div class="message">${escape(notice)}</div>`
      : "";
  $("#dismiss-error")?.addEventListener("click", () => {
    error = "";
    renderMessage();
  });
}
function report(caught: unknown) {
  if (caught instanceof DOMException && caught.name === "AbortError") return;
  error =
    caught instanceof NavError
      ? `${caught.message} ${caught.fallback}`
      : "操作未完成，请检查连接后重试。";
  busy = false;
  render();
}
function instruction(state = session.snapshot) {
  const leg = state.route?.legs[state.legIndex];
  if (state.phase === "ARRIVED") return "已到达目的地附近，请检查入口";
  if (state.paused) return "导航已暂停";
  const stale = staleInstruction(state.location?.timestamp, mode);
  if (state.phase === "NAVIGATING" && stale) {
    if (leg?.mode === "RIDE" || leg?.mode === "WAIT")
      return `定位过期 · 计划${leg.mode === "RIDE" ? "乘车" : "候车"} ${leg.line || ""} → ${leg.to || leg.headsign || "目的站"} · 请手动确认`;
    return stale;
  }
  if (!leg) return "等待选择路线";
  if (leg.mode === "WAIT") return `候车 ${leg.line || ""} ${leg.to || ""}`;
  if (leg.mode === "RIDE")
    return `${leg.line || "乘车"} → ${leg.to || leg.headsign || "目的站"}${leg.staySeated ? " · 直通无需下车" : ""}`;
  if (leg.mode === "TRANSFER") return `换乘 ${leg.to || ""}`;
  return (
    leg.steps[state.stepIndex]?.instruction ||
    `${leg.mode === "DRIVE" ? "驾驶" : "步行"}至 ${leg.to || destination?.label || "下一地点"}`
  );
}
function itinerary(route: Route) {
  return route.legs
    .map(
      (
        leg,
      ) => `<li><span class="leg-mode">${escape({ WALK: "步行", DRIVE: "驾驶", WAIT: "候车", RIDE: "乘车", TRANSFER: "换乘" }[leg.mode])}</span>
    <div><strong>${escape(leg.line || leg.steps[0]?.instruction || leg.to || "下一段")}</strong>${leg.headsign ? `<span>往 ${escape(leg.headsign)}</span>` : ""}<span>${escape([leg.from, leg.to].filter(Boolean).join(" → "))}</span>
    <span>${duration(leg.durationSeconds)}${leg.startTime ? ` · ${time(leg.startTime)}` : ""}${leg.platform ? ` · ${escape(leg.platform)} 站台` : ""}${leg.mode === "RIDE" ? ` · ${leg.realtime ? "含实时数据" : "计划时刻 · 延误未知"}` : ""}${leg.staySeated ? " · 直通无需下车" : ""}</span></div></li>`,
    )
    .join("");
}
function render() {
  const stepsOpen = Boolean(
    document.querySelector<HTMLDetailsElement>(".navigation details")?.open,
  );
  renderHealth();
  renderMessage();
  $("#import").textContent = busy ? "处理中…" : "导入链接 ↗";
  const state = session.snapshot;
  document.body.classList.toggle(
    "navigating",
    ["NAVIGATING", "ARRIVED"].includes(state.phase),
  );
  let html = "";
  if (busy)
    html += `<div class="loading" role="status"><span class="spinner"></span>${state.phase === "PLANNING" ? "正在查询实际路线…" : "正在处理输入…"}<button id="cancel" class="text-button">取消</button></div>`;
  if (
    state.intent &&
    destination &&
    ["DESTINATION_CONFIRMATION", "PLANNING", "ROUTE_SELECTION"].includes(
      state.phase,
    )
  ) {
    const candidates = state.intent.destinationCandidates;
    html += `<section class="confirmation panel"><div class="section-label"><span>01 / 确认目的地</span><span>${escape(destination.evidence === "INFERRED" ? "需仔细核对" : "等待你确认")}</span></div>
      <h2>${escape(destination.label || destination.address || "所选位置")}</h2>${destination.address ? `<p>${escape(destination.address)}</p>` : ""}
      ${candidates.length > 1 ? `<label for="candidate">存在多个候选，请选择</label><select id="candidate">${candidates.map((candidate, i) => `<option value="${i}" ${JSON.stringify(candidate) === JSON.stringify(destination) ? "selected" : ""}>${escape(candidate.label || candidate.address || `${candidate.coordinate?.lat}, ${candidate.coordinate?.lng}`)}</option>`).join("")}</select>` : ""}
      <p class="coordinate">${destination.coordinate ? `${destination.coordinate.lat.toFixed(6)}, ${destination.coordinate.lng.toFixed(6)}` : "尚无精确坐标 · 需要补全"}</p>
      <p class="small muted">来源：${escape(sourceLabels[destination.source])} · ${escape(evidenceLabels[destination.evidence])}</p>
      <div class="notice">已导入目的地。本插件会重新计算路线，可能与 Google Maps 中选择的路线不同。</div>
      ${state.intent.warnings.map((warning) => `<p class="warning">${escape(warning)}</p>`).join("")}
      ${state.intent.waypoints.length ? `<p class="warning">包含 ${state.intent.waypoints.length} 个途经点；按原顺序提交，不支持时明确报错。</p>` : ""}
      <label for="origin">起点</label><select id="origin"><option value="current" ${originSelection === "current" ? "selected" : ""}>当前手机位置（默认）</option>${state.intent.originCandidate?.coordinate ? `<option value="shared" ${originSelection === "shared" ? "selected" : ""}>明确使用链接原起点</option>` : ""}</select>
      <div class="mode-picker" role="group" aria-label="出行模式">${Object.entries(
        modes,
      )
        .map(
          ([key, label]) =>
            `<button data-mode="${key}" class="${mode === key ? "active" : ""}" aria-pressed="${mode === key}">${label}</button>`,
        )
        .join("")}</div>
      ${mode === "TRANSIT" ? `<label for="departure">出发时间（日本时间，留空为现在）</label><input type="datetime-local" id="departure" value="${escape(departureSelection)}">` : ""}
      ${mode === "WALK" ? '<p class="small warning">步行路线为 beta，可能缺少人行道或步行路径。请留意现场道路与交通安全。</p>' : ""}
      <button id="plan" class="primary wide" ${busy ? "disabled" : ""}>${destination.evidence === "INFERRED" ? "已核对推测落点，查询路线" : "确认目的地，查询路线"}</button></section>`;
  }
  if (state.phase === "ROUTE_SELECTION") {
    html += `<section class="panel"><div class="section-label"><span>02 / 选择实际路线</span><span>最多 3 条</span></div><p class="muted small">以下为本次重新查询的结果，请确认后开始。</p>`;
    html += state.routes
      .map((route, i) => {
        const ride = route.legs.filter((leg) => leg.mode === "RIDE");
        const transfer = ride.slice(1).filter((leg) => !leg.staySeated).length;
        const walking = route.legs
          .filter((leg) => leg.mode === "WALK" || leg.mode === "TRANSFER")
          .reduce((sum, leg) => sum + leg.distanceMeters, 0);
        return `<article class="route-card ${selected === route.id ? "selected" : ""}"><button class="route-select" data-route="${escape(route.id)}"><span class="route-number">${i + 1}</span><div><strong>${duration(route.durationSeconds)}</strong><span>到达 ${time(route.legs.at(-1)?.endTime || Date.now() + route.durationSeconds * 1000)} · ${distance(route.distanceMeters)}</span><span>步行 ${distance(walking)}${mode === "TRANSIT" ? ` · ${transfer} 次换乘` : ""}</span></div><span class="radio">${selected === route.id ? "●" : "○"}</span></button><p class="small muted">来源 ${escape(route.provider)} · 底图 ${escape(route.basemapProvider)}</p>
      ${route.warnings.map((warning) => `<p class="warning small">${escape(warning)}</p>`).join("")}<details ${selected === route.id ? "open" : ""}><summary>行程与后续步骤</summary><ol class="legs">${itinerary(route)}</ol></details></article>`;
      })
      .join("");
    html += `<button id="start" class="primary wide" ${!selected || busy ? "disabled" : ""}>开始导航 ↗</button><p class="small muted">开始前重新获取当前位置。预览过期或起点改变时需要重新查询。</p></section>`;
  }
  if (["NAVIGATING", "ARRIVED"].includes(state.phase)) {
    const leg = state.route?.legs[state.legIndex];
    html += `<section class="panel navigation"><div class="section-label"><span>${state.phase === "ARRIVED" ? "到达附近" : state.paused ? "已暂停" : "03 / 导航中"}</span><span>${device.source === "BROWSER_DEV" ? "浏览器开发预览" : "Even 手机定位"}</span></div><h2>${escape(instruction())}</h2><div class="big-distance">${distance(state.remainingMeters)}<span>剩余距离</span></div>
      <p class="${state.locationStale ? "warning" : "muted"}">最后可靠定位：${state.location ? time(state.location.timestamp) + " JST" : "未知"}${state.locationStale ? " · 定位过期，请检查现场" : ""}</p>
      ${state.replanNeeded ? '<p class="warning">检测到偏航、路线过期或错过发车，请重新规划。</p>' : ""}
      <div class="nav-actions"><button id="pause" class="secondary">${state.paused ? "继续" : "暂停"}</button><button id="replan" class="secondary">重新规划</button><button id="end" class="secondary danger">结束</button></div>
      ${mode === "TRANSIT" && !state.paused ? `<div class="transit-actions">${leg?.mode === "WAIT" || (leg?.mode === "RIDE" && !state.boarded) ? '<button data-transit="BOARDED" class="secondary">已上车</button>' : ""}${leg?.mode === "RIDE" && state.boarded ? '<button data-transit="ALIGHTED" class="secondary">已下车</button>' : ""}${leg?.mode === "TRANSFER" ? '<button data-transit="TRANSFER_COMPLETED" class="secondary">已完成换乘</button>' : ""}</div><p class="small muted">地下无 GPS 时依靠你的确认推进；计划时刻不会证明已上车或到站。</p>` : ""}
      <details><summary>查看完整行程</summary><ol class="legs">${state.route ? itinerary(state.route) : ""}</ol></details></section>`;
  }
  if (state.phase === "ENDED")
    html +=
      '<section class="panel"><h2>本次导航已结束</h2><p>定位和地图更新已停止。</p></section>';
  $("#workflow").innerHTML = html;
  if (
    stepsOpen &&
    document.querySelector<HTMLDetailsElement>(".navigation details")
  )
    document.querySelector<HTMLDetailsElement>(".navigation details")!.open =
      true;
  $("#cancel")?.addEventListener("click", cancel);
  $("#candidate")?.addEventListener("change", (event) => {
    destination =
      session.snapshot.intent!.destinationCandidates[
        Number((event.target as HTMLSelectElement).value)
      ];
    render();
    void drawMap();
  });
  $("#origin")?.addEventListener("change", (event) => {
    originSelection = (event.target as HTMLSelectElement).value;
  });
  $("#departure")?.addEventListener("change", (event) => {
    departureSelection = (event.target as HTMLInputElement).value;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        mode = button.dataset.mode as Mode;
        selected = "";
        session.config.staleMs = staleThreshold(mode);
        const previous = session.snapshot.intent;
        if (previous) {
          const request = session.beginRequest("IMPORTING");
          session.acceptImport(request.version, previous);
        }
        map.clear();
        render();
        void drawMap();
      }),
  );
  $("#plan")?.addEventListener("click", () => void plan());
  document.querySelectorAll<HTMLButtonElement>("[data-route]").forEach(
    (button) =>
      (button.onclick = () => {
        selected = button.dataset.route!;
        render();
        void drawMap();
      }),
  );
  $("#start")?.addEventListener("click", () => void start());
  $("#pause")?.addEventListener(
    "click",
    () => void handleAction(state.paused ? "RESUME" : "PAUSE"),
  );
  $("#end")?.addEventListener("click", () => void handleAction("END"));
  $("#replan")?.addEventListener("click", () => void plan());
  document.querySelectorAll<HTMLButtonElement>("[data-transit]").forEach(
    (button) =>
      (button.onclick = () => {
        try {
          session.confirmTransit(
            button.dataset.transit as
              "BOARDED" | "ALIGHTED" | "TRANSFER_COMPLETED",
          );
          render();
          void drawMap();
        } catch (e) {
          report(e);
        }
      }),
  );
}
function cancel() {
  session.cancel();
  device.setVersion(session.snapshot.version);
  busy = false;
  notice = "操作已取消。";
  render();
}
async function importInput(text: string, selectedFromGoogleMap = false) {
  const request = session.beginRequest("IMPORTING");
  busy = true;
  error = "";
  notice = "";
  destination = undefined;
  selected = "";
  lastMapFrame = undefined;
  map.dispose();
  $("#map-panel").hidden = true;
  render();
  originSelection = "current";
  departureSelection = "";
  try {
    await stopNavigation(false);
    if (request.signal.aborted) return;
    let intent: ImportedIntent;
    try {
      intent = parseSharedInput(text);
    } catch (caught) {
      if (
        caught instanceof NavError &&
        caught.code === "LINK_RESOLUTION_BLOCKED"
      )
        intent = await client.request(
          "/v1/import/resolve",
          { text },
          request.signal,
        );
      else throw caught;
    }
    if (selectedFromGoogleMap) {
      intent.destinationCandidates = intent.destinationCandidates.map(
        (candidate) => ({
          ...candidate,
          source: "GOOGLE_API_CONTENT",
          extractedFrom: "google-basemap-user-selection",
        }),
      );
      intent.warnings.push(
        "此落点来自 Google 底图，仍沿用 Google 数据来源与地图使用限制。",
      );
    }
    if (
      request.signal.aborted ||
      !session.acceptImport(request.version, intent)
    )
      return;
    destination = intent.destinationCandidates[0];
    mode = intent.modeHint || mode;
    session.config.staleMs = staleThreshold(mode);
    busy = false;
    if (!destination)
      throw new NavError("DESTINATION_MISSING", "未找到明确目的地。");
    render();
    $("#workflow").scrollIntoView({ behavior: "smooth", block: "start" });
    void drawMap();
  } catch (caught) {
    if (!request.signal.aborted) {
      session.cancel();
      report(caught);
    }
  }
}
async function plan() {
  if (!destination) return;
  const intent = session.snapshot.intent!;
  const originChoice = originSelection;
  const departure = departureSelection;
  const request = session.beginRequest("PLANNING");
  busy = true;
  error = "";
  notice = "";
  render();
  try {
    await stopNavigation(false);
    if (request.signal.aborted) return;
    if (!destination.coordinate) {
      const enriched = await client.request<{
        candidates: EndpointCandidate[];
      }>(
        "/v1/destinations/resolve",
        { candidate: destination },
        request.signal,
      );
      if (request.signal.aborted) return;
      if (!enriched.candidates.length)
        throw new NavError(
          "DESTINATION_MISSING",
          "地址补全没有返回候选，请输入完整地址或坐标。",
        );
      const confirm = session.beginRequest("IMPORTING");
      session.acceptImport(confirm.version, {
        ...intent,
        destinationCandidates: enriched.candidates,
        warnings: [...intent.warnings, "补全结果需要再次确认。"],
      });
      destination = enriched.candidates[0];
      busy = false;
      notice = "已找到候选，请核对落点后再次查询。";
      render();
      void drawMap();
      return;
    }
    const current = await device.locate();
    if (request.signal.aborted) return;
    const sharedOrigin = intent.originCandidate?.coordinate;
    const origin =
      originChoice === "shared" && sharedOrigin
        ? sharedOrigin
        : current.coordinate;
    const trip: ConfirmedTripRequest = {
      requestVersion: request.version,
      origin,
      originPolicy:
        originChoice === "shared" && sharedOrigin
          ? "EXPLICIT_SHARED_ORIGIN"
          : "CURRENT_DEVICE_LOCATION",
      destination,
      mode,
      departureTime: departure
        ? new Date(`${departure}:00+09:00`).toISOString()
        : new Date().toISOString(),
      waypoints: intent.waypoints,
      routeProvider: mode === "TRANSIT" ? "TRANSITOUS" : "GOOGLE_ROUTES",
      basemapProvider: "GOOGLE_TILES",
      userConfirmed: true,
    };
    const response = await client.request<{
      routes: Route[];
      requestVersion: number;
    }>(
      mode === "TRANSIT" ? "/v1/routes/transit" : "/v1/routes/road",
      trip,
      request.signal,
    );
    if (request.signal.aborted) return;
    if (response.requestVersion !== request.version)
      throw new NavError(
        "PROVIDER_UNAVAILABLE",
        "后端返回了不匹配的路线版本，请重新查询。",
        true,
      );
    if (session.acceptRoutes(request.version, response.routes, origin)) {
      selected = response.routes[0]?.id || "";
      busy = false;
      render();
      void drawMap();
    }
  } catch (caught) {
    if (!request.signal.aborted) {
      session.cancel();
      report(caught);
    }
  }
}
async function start() {
  if (busy) return;
  const version = session.snapshot.version,
    routeId = selected;
  let started = false;
  try {
    busy = true;
    render();
    const current = await device.locate();
    if (version !== session.snapshot.version) return;
    session.start(routeId, current);
    started = true;
    device.setVersion(session.snapshot.version);
    await device.startLocation();
    busy = false;
    if (tick) clearInterval(tick);
    tick = setInterval(() => {
      session.refreshHealth();
      render();
      void drawMap();
    }, 1000);
    render();
    await drawMap();
  } catch (caught) {
    if (started) {
      session.pause();
      await stopNavigation(false).catch(() => {});
    }
    busy = false;
    report(caught);
  }
}
function onFix(value: DeviceFix) {
  fix = value;
  session.updateLocation(value);
  if (session.snapshot.phase === "ARRIVED") void device.stopLocation();
  if (
    session.snapshot.phase === "NAVIGATING" ||
    session.snapshot.phase === "ARRIVED"
  ) {
    render();
    void drawMap();
  }
}
async function stopNavigation(close: boolean) {
  if (tick) clearInterval(tick);
  tick = undefined;
  device.setVersion(session.snapshot.version + 1);
  await device.stopLocation();
  if (close) await device.close();
}
async function handleAction(action: "PAUSE" | "RESUME" | "END") {
  try {
    if (action === "END") {
      session.end();
      await stopNavigation(true);
      lastMapFrame = undefined;
      map.dispose();
      $("#map-panel").hidden = true;
    } else if (action === "PAUSE") {
      session.pause();
      await device.stopLocation();
    } else {
      session.resume();
      device.setVersion(session.snapshot.version);
      await device.locate();
      await device.startLocation();
    }
    render();
    if (action !== "END") await drawMap();
  } catch (caught) {
    report(caught);
  }
}
async function drawMap() {
  const state = session.snapshot;
  const route =
    state.route && ["NAVIGATING", "ARRIVED"].includes(state.phase)
      ? state.route
      : state.routes.find((candidate) => candidate.id === selected);
  const center = ["NAVIGATING", "ARRIVED"].includes(state.phase)
    ? state.location?.coordinate
    : destination?.coordinate || fix?.coordinate;
  if (!center) return;
  $("#map-panel").hidden = false;
  if (!client.configured) {
    mapError = "连接个人 Worker 后显示真实底图。";
    updateMapCaption();
    return;
  }
  if (mapBusy) {
    mapPending = true;
    return;
  }
  mapBusy = true;
  const version = state.version;
  if (version !== previousMapVersion) {
    map.clear();
    previousMapVersion = version;
    device.setVersion(version);
  }
  try {
    await map.draw(
      center,
      destination,
      route,
      state.location?.coordinate || fix?.coordinate,
    );
    if (version !== session.snapshot.version) return;
    mapError = "";
    if (
      map.ready &&
      device.connected &&
      ["NAVIGATING", "ARRIVED"].includes(state.phase) &&
      Date.now() - lastFrame >= 1000
    ) {
      lastFrame = Date.now();
      const pixels = await map.pixels();
      if (version !== session.snapshot.version) return;
      lastMapFrame = {
        version,
        pixels,
        attribution: map.attribution,
        fixTimestamp: state.location?.timestamp,
      };
      device.queue.push({
        sequence: ++sequence,
        version,
        pixels,
        instruction: instruction(state),
        status: `${state.paused ? "暂停 · " : ""}${staleInstruction(state.location?.timestamp, mode) ? "定位过期 · " : ""}GPS ${state.location ? time(state.location.timestamp) : "未知"} JST · ${distance(state.remainingMeters)}`,
        attribution: map.attribution,
      });
    }
  } catch (caught) {
    if (!(caught instanceof DOMException && caught.name === "AbortError")) {
      mapError =
        caught instanceof NavError
          ? caught.message
          : "真实地图加载失败，请检查后端与网络。";
      // A failed tile request must not leave precise old instructions on otherwise responsive glasses.
      if (
        device.connected &&
        lastMapFrame?.version === version &&
        version === session.snapshot.version
      ) {
        device.queue.push({
          sequence: ++sequence,
          version,
          pixels: lastMapFrame.pixels,
          instruction: "地图更新失败，请以现场道路为准；暂停转向指示",
          status: `保留旧图 · GPS ${lastMapFrame.fixTimestamp ? time(lastMapFrame.fixTimestamp) : "未知"} JST`,
          attribution: lastMapFrame.attribution,
        });
      }
    }
  } finally {
    mapBusy = false;
    updateMapCaption();
    if (mapPending) {
      mapPending = false;
      void drawMap();
    }
  }
}
function updateMapCaption() {
  $("#map-state").textContent = map.ready ? "北向上 · 真实瓦片" : "底图未就绪";
  $("#map-caption").textContent =
    mapError ||
    (mapPicking
      ? "点击地图选择目的地。选择后仍需确认路线。"
      : "实心圆：最后可靠定位 · 空心圆：目的地。");
  $("#attribution").textContent = map.attribution;
  $("#google-attribution").hidden = !map.ready;
  map.canvas.hidden = !map.ready;
}
$("#settings-button").onclick = () =>
  $<HTMLDialogElement>("#settings").showModal();
$("#manual-button").onclick = () => $<HTMLDialogElement>("#manual").showModal();
$("#manual-submit").onclick = () => {
  const value = $<HTMLInputElement>("#manual-input").value;
  $<HTMLDialogElement>("#manual").close();
  void importInput(value);
};
$("#import").onclick = () =>
  void importInput($<HTMLTextAreaElement>("#share-input").value);
$("#share-input").addEventListener("input", () => {
  if (busy) cancel();
});
$("#paste").onclick = async () => {
  try {
    $<HTMLTextAreaElement>("#share-input").value =
      await navigator.clipboard.readText();
    notice = "已粘贴，请点击导入链接。";
  } catch {
    notice = "无法读取剪贴板，请长按输入框使用系统粘贴。";
    $<HTMLTextAreaElement>("#share-input").focus();
  }
  renderMessage();
};
$("#connect-backend").onclick = async () => {
  if (authBusy || client.configured) return;
  let ownerToken = $<HTMLInputElement>("#worker-token").value;
  $<HTMLInputElement>("#worker-token").value = "";
  authBusy = true;
  error = "";
  credentialStatus = "正在为此设备配对…";
  renderHealth();
  try {
    const result = await credentials.pair(ownerToken);
    ownerToken = "";
    backend = result.verified ? "后端已连接" : "已配对，连接待重试";
    credentialStatus = result.saved
      ? `设备凭据已保存，下次自动连接。有效期至 ${result.expiresAt.slice(0, 10)}。`
      : "设备凭据保存失败；仅本次连接已确认，下次可能需要重新配对。";
    $<HTMLDialogElement>("#settings").close();
    notice =
      credentialStatus +
      (result.verified ? "" : " 网络暂不可用，可在设置中重试已保存的连接。");
    render();
    if (result.verified) void drawMap();
  } catch (caught) {
    ownerToken = "";
    backend = "后端连接失败";
    credentialStatus = "配对未完成，请检查首次配对凭据后重试。";
    $<HTMLDialogElement>("#settings").close();
    report(caught);
  } finally {
    authBusy = false;
    renderHealth();
  }
};
$("#retry-backend").onclick = async () => {
  if (authBusy || !client.configured) return;
  authBusy = true;
  renderHealth();
  try {
    await client.request("/v1/providers");
    backend = "后端已连接";
    notice = "已恢复连接，无需重新输入配对凭据。";
    error = "";
    $<HTMLDialogElement>("#settings").close();
    render();
    void drawMap();
  } catch (caught) {
    if (caught instanceof NavError && caught.code === "AUTH_FAILED")
      await invalidateCredentials();
    else {
      backend = "连接待重试";
      notice = "网络暂不可用，已保留设备凭据，可稍后重试。";
      render();
    }
  } finally {
    authBusy = false;
    renderHealth();
  }
};
$("#forget-backend").onclick = async () => {
  if (authBusy) return;
  authBusy = true;
  renderHealth();
  session.end();
  void stopNavigation(false);
  map.dispose();
  lastMapFrame = undefined;
  $("#map-panel").hidden = true;
  const result = await credentials.forget();
  backend = "未配置后端";
  credentialStatus = result.removed
    ? result.revoked
      ? "此设备凭据已移除并撤销。"
      : "本机凭据已移除；网络不可用，服务端撤销未确认。可轮换 Worker 管理员密钥使旧凭据失效。"
    : result.revoked
      ? "服务端凭据已撤销，但本机存储清除未确认。请检查应用存储权限。"
      : "本次连接已断开；本机清除和服务端撤销均未确认。请检查存储权限与网络。";
  notice = credentialStatus;
  error = "";
  $<HTMLDialogElement>("#settings").close();
  authBusy = false;
  render();
};
async function invalidateCredentials() {
  backend = "设备凭据已失效";
  session.pause();
  void stopNavigation(false);
  try {
    await credentials.invalidate();
    credentialStatus = "失效的设备凭据已移除，请重新配对。";
  } catch {
    credentialStatus =
      "设备凭据已失效；本机清除未确认，请检查应用存储后重新配对。";
  }
  notice = credentialStatus;
  render();
}
client.onAuthFailure = () => {
  if (!authBusy) void invalidateCredentials();
};
async function restoreCredentials() {
  try {
    const result = await credentials.restore();
    if (result === "RESTORED") {
      backend = "后端已连接";
      credentialStatus = "已自动恢复此设备的连接，无需再次输入配对凭据。";
    } else if (result === "OFFLINE") {
      backend = "连接待重试";
      credentialStatus = "已保留设备凭据，网络暂不可用；可在设置中重试连接。";
    } else if (result === "EXPIRED_OR_INVALID") {
      backend = "需要重新配对";
      credentialStatus = "设备凭据已过期、失效或后端地址改变，请重新配对。";
      notice = credentialStatus;
    } else credentialStatus = "首次使用请配对一次，之后自动连接。";
  } catch {
    backend = "配对存储不可用";
    credentialStatus = "无法读取或清除此设备的配对存储，请检查应用存储权限。";
    notice = credentialStatus;
  } finally {
    authBusy = false;
    render();
  }
}
$("#connect-device").onclick = async () => {
  try {
    await device.connect();
    await device.locate();
    $<HTMLDialogElement>("#settings").close();
    render();
  } catch (caught) {
    $<HTMLDialogElement>("#settings").close();
    report(caught);
  }
};
$("#browser-location").onclick = () => {
  try {
    device.useBrowserDevelopment();
    $<HTMLDialogElement>("#settings").close();
    render();
  } catch (caught) {
    report(caught);
  }
};
$("#refresh-map").onclick = () => {
  map.dispose();
  void drawMap();
};
$("#pick-button").onclick = async () => {
  try {
    if (!fix) fix = await device.locate();
    mapPicking = true;
    notice = "请在真实道路地图上选择落点。";
    render();
    await drawMap();
    $("#map-panel").scrollIntoView({ behavior: "smooth" });
  } catch (caught) {
    report(caught);
  }
};
map.canvas.onclick = (event) => {
  if (!mapPicking) return;
  const point = map.pointFromClick(event);
  if (!point) return;
  const previous = destination?.coordinate;
  void importInput(`${point.lat}, ${point.lng}`, true).then(() => {
    mapPicking = false;
    notice = previous
      ? `新落点距原点 ${distance(distanceMeters(previous, point))}，请检查是否误触。`
      : "已选择地图落点，请核对坐标。";
    render();
  });
};
window.addEventListener("pagehide", () => {
  void stopNavigation(false);
  map.dispose();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && session.snapshot.phase === "NAVIGATING") {
    session.refreshHealth();
    notice =
      "已回到页面；正在核对定位与行程有效期。恢复不代表锁屏期间持续更新。";
    render();
    void device.locate().catch(report);
  }
});
render();
updateMapCaption();
void restoreCredentials();
