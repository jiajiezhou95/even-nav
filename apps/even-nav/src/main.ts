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
import { EvenDevice, type DeviceAction, type DeviceFix } from "./device";
import { NavigationMap } from "./map";
import { staleThreshold } from "./freshness";
import { createCredentialStore, DeviceCredentials } from "./credentials";
import {
  conciseInstruction,
  currentStepDetail,
  guidanceView,
  hudStatus,
  type ManeuverIcon,
} from "./guidance";
import { maneuverSvg, maneuverPng } from "./maneuver-icons";
import { movementBearingFromHistory } from "./direction";
import { createImuProbe, type ImuProbePhase } from "./imu-probe";
import packageInfo from "../../../package.json";

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
const client = new WorkerClient(),
  session = new NavigationSession({ staleMs: 5000 }),
  map = new NavigationMap(client);
const credentials = new DeviceCredentials(client, createCredentialStore());
let imuProbe: ReturnType<typeof createImuProbe> | undefined;
let imuStarting = false;
let imuEpoch = 0;
let imuUploadBusy = false;
let imuSampleRevision = 0;
let imuUploadMessage = "";
let imuUploadLabel: ImuProbePhase | "" = "";
const imuActionLabels: Record<ImuProbePhase, string> = {
  still: "保持静止",
  left: "向左转头",
  right: "向右转头",
  nod: "点头",
  tilt: "侧倾",
  phone: "仅转动手机",
};
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
let candidateChosen = false;
let mapError = "",
  mapPicking = false,
  sequence = 0,
  lastFrame = 0,
  tick: ReturnType<typeof setInterval> | undefined;
let mapBusy = false,
  mapPending = false,
  previousMapVersion = -1;
let zoomRedraw: ReturnType<typeof setTimeout> | undefined;
let navigationViewKey = "";
let directionHistory: DeviceFix[] = [];
let pageSuspended = false,
  lifecycleEpoch = 0;
let lifecycleStop: Promise<void> = Promise.resolve();
let lifecycleRestore: Promise<void> | undefined;
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
      <div id="input-help" class="muted small">可直接长按粘贴</div>
      <button id="import" class="primary wide">导入链接 <span>↗</span></button>
    </section>
    <nav class="fallbacks" aria-label="其他输入方式"><button id="manual-button">⌖ 输入地址 / 经纬度</button><button id="pick-button">⊕ 地图选点</button></nav>
    <div class="status-strip" id="health" aria-live="polite"></div>
    <div id="message" aria-live="polite"></div>
    <section id="workflow"></section>
    <section class="map-card" id="map-panel" hidden><div class="section-label"><span>地图</span><span id="map-state">正在加载</span></div><div id="map-host"></div><img id="google-attribution" src="/attribution/google-maps.svg" alt="Google Maps" hidden><p id="map-caption" class="small muted"></p><p id="attribution" class="attribution"></p><button id="refresh-map" class="text-button">刷新地图</button></section>
    <section class="explainer"><div class="path-line"><span>01 粘贴</span><i></i><span>02 确认路线</span><i></i><span>03 抬头出发</span></div></section>
    <footer><span>EVEN NAV</span></footer>
  </main>
  <dialog id="settings"><form method="dialog"><div class="dialog-heading"><h2>连接你的导航服务</h2><button aria-label="关闭设置" class="icon-button">×</button></div></form>
    <p class="small muted">Even Nav ${escape(packageInfo.version)}</p>
    <p class="muted">Google Key 保存在你自己的 Worker 中。此处只连接已打包允许的后端。</p>
    <label for="worker-origin">已绑定的 Worker 地址</label><input id="worker-origin" readonly value="${escape(client.origin)}" placeholder="尚未绑定，需配置并重新打包">
    <p class="small muted">更换域名后需重新打包，网络白名单会随构建更新。</p>
    <label for="worker-token">Worker 首次配对凭据</label><input id="worker-token" type="password" autocomplete="off" placeholder="只用于首次配对，不保存此管理员凭据">
    <p class="small muted">${credentials.store.kind === "EVEN_APP" ? "配对后的设备凭据保存在 Even App 应用存储，下次自动连接。这不等同于硬件安全存储。" : "浏览器预览：设备凭据保存在当前网站的本地存储，仅适用于此浏览器。"} 原始分享链接和路线不持久保存。</p>
    <p id="credential-status" class="small muted" aria-live="polite"></p>
    <button id="connect-backend" class="primary wide">首次配对并连接</button><button id="retry-backend" class="secondary wide">重试已保存的连接</button><button id="forget-backend" class="secondary wide danger">断开并忘记此设备</button><button id="connect-device" class="secondary wide">连接 Even App / G2</button>
    <button id="browser-location" class="text-button wide">启用浏览器开发定位</button><p class="small muted">开发定位不等于 Even GPS、G2 显示或锁屏持续导航。</p>
    <section class="imu-controls" aria-label="眼镜传感器采样"><h3>眼镜传感器采样</h3><p class="small muted">手机放稳；仅采样，不用于导航朝向。每次只做一种动作，最多 60 秒。停止后选择动作，手动上传到你的个人 Worker，保留最近 20 次上传；上传内容只有动作标签、XYZ、动作阶段和相对时间。</p>
    <button id="imu-start" class="secondary">开始采样</button><button id="imu-stop" class="secondary" disabled>停止采样</button>
    <p class="small muted">采样过程中的分段标记（可选）</p>
    <div class="imu-phases">${Object.entries({
      still: "静止",
      left: "向左转头",
      right: "向右转头",
      nod: "点头",
      tilt: "侧倾",
      phone: "仅转动手机",
    })
      .map(
        ([phase, label]) =>
          `<button data-imu-phase="${phase}" aria-pressed="${phase === "still"}">${label}</button>`,
      )
      .join("")}</div>
    <p id="imu-stats" class="small" aria-live="polite">尚未采样</p>
    <div id="imu-export" hidden><label for="imu-upload-label">这次做了哪个动作</label><select id="imu-upload-label" required><option value="">请选择这次采样的动作</option>${Object.entries(
      imuActionLabels,
    )
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join(
        "",
      )}</select><button id="imu-upload" class="secondary" disabled>上传采样</button><p id="imu-upload-status" class="small" aria-live="polite"></p><label for="imu-report">本机采样结果（也可长按全选复制）</label><textarea id="imu-report" readonly rows="5"></textarea></div></section>
  </dialog>
  <dialog id="manual"><form method="dialog"><div class="dialog-heading"><h2>手动输入目的地</h2><button aria-label="关闭手动输入" class="icon-button">×</button></div></form>
    <label for="manual-input">完整地址或 纬度, 经度</label><input id="manual-input" placeholder="例如：35.6812, 139.7671"><p class="small muted">坐标按 WGS84 纬度在前。地址补全仅在提交时请求。</p><button id="manual-submit" class="primary wide">确认输入</button>
  </dialog>`;
$("#map-host").append(map.canvas);

function renderHealth() {
  renderImu();
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
  return conciseInstruction(state, mode);
}
function itinerary(route: Route) {
  return route.legs
    .map(
      (
        leg,
      ) => `<li><span class="leg-mode">${escape({ WALK: "步行", DRIVE: "驾驶", WAIT: "候车", RIDE: "乘车", TRANSFER: "换乘" }[leg.mode])}</span>
    <div><strong>${escape(leg.line || leg.to || (leg.mode === "WALK" ? "步行" : leg.mode === "DRIVE" ? "驾驶" : "下一段"))}</strong>${leg.headsign ? `<span>往 ${escape(leg.headsign)}</span>` : ""}<span>${escape([leg.from, leg.to].filter(Boolean).join(" → "))}</span>
    ${leg.steps.length ? `<ol class="itinerary-steps">${leg.steps.map((step) => `<li><span>${escape(step.instruction)}</span><small>${distance(step.distanceMeters)}</small></li>`).join("")}</ol>` : ""}
    <span>${duration(leg.durationSeconds)}${leg.startTime ? ` · ${time(leg.startTime)}` : ""}${leg.platform ? ` · ${escape(leg.platform)} 站台` : ""}${leg.mode === "RIDE" ? ` · ${leg.realtime ? "含实时数据" : "计划时刻 · 延误未知"}` : ""}${leg.staySeated ? " · 直通无需下车" : ""}</span></div></li>`,
    )
    .join("");
}
function guidanceMarkup(state = session.snapshot) {
  const view = guidanceView(state, mode);
  return `<div class="guidance-current"><span id="nav-current-icon" class="maneuver-icon" data-icon="${view.icon}" aria-hidden="true">${maneuverSvg(view.icon)}</span><span><span id="nav-current-text">${escape(view.action)}</span><span id="nav-step-distance" >${escape(view.distance || "")}</span></span></div><div id="nav-next" class="guidance-next" ${view.next ? "" : "hidden"}><span class="next-label">下一步</span><span id="nav-next-icon" class="maneuver-icon" data-icon="${view.nextIcon || "none"}" aria-hidden="true">${maneuverSvg(view.nextIcon || "none")}</span><span id="nav-next-text">${escape(view.next || "")}</span></div>`;
}
function updateIcon(selector: string, icon: ManeuverIcon) {
  const element = $(selector);
  if (element.dataset.icon !== icon) {
    element.innerHTML = maneuverSvg(icon);
    element.dataset.icon = icon;
  }
}
function updateNavigationTelemetry(state = session.snapshot) {
  const view = guidanceView(state, mode);
  $("#nav-current-text").textContent = view.action;
  $("#nav-step-distance").textContent = view.distance || "";
  $("#nav-next").hidden = !view.next;
  $("#nav-next-text").textContent = view.next || "";
  updateIcon("#nav-current-icon", view.icon);
  updateIcon("#nav-next-icon", view.nextIcon || "none");
  $("#current-step-detail").textContent = currentStepDetail(state);
  $("#nav-distance").textContent = distance(state.remainingMeters);
  $("#nav-fix").hidden = !view.stale;
  $("#nav-replan").hidden = !state.replanNeeded;
}
function render() {
  const openedDetails = Array.from(
    document.querySelectorAll<HTMLDetailsElement>(".navigation details"),
  ).map((detail) => detail.open);
  renderHealth();
  renderMessage();
  $("#import").textContent = busy ? "处理中…" : "导入链接 ↗";
  const state = session.snapshot;
  document.body.classList.toggle(
    "navigating",
    ["NAVIGATING", "ARRIVED"].includes(state.phase),
  );
  document.body.classList.toggle(
    "choosing-route",
    state.phase === "ROUTE_SELECTION",
  );
  // GPS and health ticks update text only: preserve the user's touch target,
  // expanded itinerary and scroll position while the navigation structure is unchanged.
  const nextNavigationKey = ["NAVIGATING", "ARRIVED"].includes(state.phase)
    ? JSON.stringify([
        state.phase,
        state.route?.id,
        state.legIndex,
        state.paused,
        state.boarded,
        mode,
        busy,
        device.source,
      ])
    : "";
  if (
    nextNavigationKey &&
    navigationViewKey === nextNavigationKey &&
    $("#nav-instruction")
  ) {
    updateNavigationTelemetry(state);
    return;
  }
  navigationViewKey = nextNavigationKey;
  // Keep the real canvas and its listeners when rebuilding route cards.
  $("#workflow").after($("#map-panel"));
  let html = "";
  if (busy)
    html += `<div class="loading" role="status"><span class="spinner"></span>${state.phase === "PLANNING" ? "正在查询实际路线…" : "正在处理输入…"}<button id="cancel" class="text-button">取消</button></div>`;
  if (
    state.intent &&
    destination &&
    ["DESTINATION_CONFIRMATION", "PLANNING"].includes(state.phase)
  ) {
    const candidates = state.intent.destinationCandidates;
    html += `<section class="confirmation panel"><div class="section-label"><span>01 / 确认目的地</span><span>${escape(destination.evidence === "INFERRED" ? "需仔细核对" : "等待你确认")}</span></div>
      <h2>${candidateChosen ? escape(destination.label || destination.address || "所选位置") : "请选择你的目的地"}</h2>${candidateChosen && destination.address ? `<p>${escape(destination.address)}</p>` : ""}
      ${candidates.length > 1 ? `<label for="candidate">存在多个候选，请选择</label><select id="candidate"><option value="" disabled ${candidateChosen ? "" : "selected"}>请选择目的地</option>${candidates.map((candidate, i) => `<option value="${i}" ${candidateChosen && JSON.stringify(candidate) === JSON.stringify(destination) ? "selected" : ""}>${escape([candidate.label, candidate.address].filter(Boolean).join(" · ") || `${candidate.coordinate?.lat}, ${candidate.coordinate?.lng}`)}</option>`).join("")}</select>` : ""}
      ${candidateChosen && destination.coordinate ? `<p class="coordinate">${destination.coordinate.lat.toFixed(6)}, ${destination.coordinate.lng.toFixed(6)}</p>` : ""}
      ${candidates.some((candidate) => candidate.source === "GOOGLE_API_CONTENT") ? '<img class="provider-attribution" src="/attribution/google-maps.svg" alt="Google Maps">' : ""}
      ${state.intent.warnings.length ? `<details class="route-notes"><summary>导入备注</summary>${state.intent.warnings.map((warning) => `<p class="small muted">${escape(warning)}</p>`).join("")}</details>` : ""}
      ${state.intent.waypoints.length ? `<p class="small">途经 ${state.intent.waypoints.length} 个地点</p>` : ""}
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
      <button id="plan" class="primary wide" ${busy || !candidateChosen ? "disabled" : ""}>${destination.evidence === "INFERRED" ? "已核对推测落点，查询路线" : "确认目的地，查询路线"}</button></section>`;
  }
  if (state.phase === "ROUTE_SELECTION") {
    const routes = state.routes.slice(0, 3);
    const route = routes.find((item) => item.id === selected);
    const routeIndex = routes.findIndex((item) => item.id === selected);
    html += `<section class="route-choice"><div class="section-label"><span>02 / 选择路线</span><span>${modes[mode]}</span></div><h2>${escape(destination?.label || destination?.address || "前往目的地")}</h2>
      <div class="route-map-pane"><canvas id="route-preview" aria-label="路线 ${routeIndex + 1} 道路地图" hidden></canvas><p id="route-map-status" role="status">地图加载中…</p><img id="route-map-logo" class="provider-attribution" src="/attribution/google-maps.svg" alt="Google Maps" hidden><p id="route-copyright" class="attribution"></p><button id="retry-route-map" class="text-button" hidden>重试地图</button></div>
      <div class="route-tabs" role="tablist" aria-label="可选路线">${routes.map((item, i) => `<button id="route-tab-${i}" role="tab" data-route="${escape(item.id)}" aria-selected="${selected === item.id}" aria-controls="route-summary" tabindex="${selected === item.id ? 0 : -1}"><span>路线 ${i + 1}</span><strong>${duration(item.durationSeconds)}</strong></button>`).join("")}</div>`;
    if (route) {
      const ride = route.legs.filter((leg) => leg.mode === "RIDE");
      const walking = route.legs
        .filter((leg) => leg.mode === "WALK" || leg.mode === "TRANSFER")
        .reduce((sum, leg) => sum + leg.distanceMeters, 0);
      const warnings = route.warnings.filter(
        (warning) => !/beta|测试版|试用版/i.test(warning),
      );
      html += `<article id="route-summary" class="route-card" role="tabpanel" aria-labelledby="route-tab-${routeIndex}"><p class="route-summary-line">${distance(route.distanceMeters)} · 到达 ${time(route.legs.at(-1)?.endTime || Date.now() + route.durationSeconds * 1000)}${mode === "TRANSIT" ? ` · 步行 ${distance(walking)} · ${ride.slice(1).filter((leg) => !leg.staySeated).length} 次换乘` : ""}</p>
        <ol class="legs selected-itinerary">${itinerary(route)}</ol>${warnings.length ? `<details class="route-notes"><summary>路线备注</summary>${warnings.map((warning) => `<p class="small muted">${escape(warning)}</p>`).join("")}</details>` : ""}</article>`;
    }
    html += `<button id="start" class="primary wide" ${!selected || busy ? "disabled" : ""}>开始导航 ↗</button></section>`;
  }
  if (["NAVIGATING", "ARRIVED"].includes(state.phase)) {
    const leg = state.route?.legs[state.legIndex];
    const view = guidanceView(state, mode);
    html += `<section class="panel navigation"><div class="section-label"><span>${state.phase === "ARRIVED" ? "到达附近" : state.paused ? "已暂停" : "03 / 导航中"}</span><span>${device.source === "BROWSER_DEV" ? "浏览器开发预览" : "Even 手机定位"}</span></div><div id="nav-instruction" role="heading" aria-level="2">${guidanceMarkup(state)}</div><div class="big-distance"><strong id="nav-distance">${distance(state.remainingMeters)}</strong><span>总剩余距离</span></div>
      <p id="nav-fix" class="gps-status warning" ${view.stale ? "" : "hidden"}><span class="location-dot" aria-hidden="true"></span>更新定位中</p>
      <p id="nav-replan" class="warning" ${state.replanNeeded ? "" : "hidden"}>检测到偏航、路线过期或错过发车，请重新规划。</p>
      <div class="nav-actions"><button id="pause" class="secondary">${state.paused ? "继续" : "暂停"}</button><button id="replan" class="secondary">重新规划</button><button id="end" class="secondary danger">结束</button></div>
      ${mode === "TRANSIT" && !state.paused ? `<div class="transit-actions">${leg?.mode === "WAIT" || (leg?.mode === "RIDE" && !state.boarded) ? '<button data-transit="BOARDED" class="secondary">已上车</button>' : ""}${leg?.mode === "RIDE" && state.boarded ? '<button data-transit="ALIGHTED" class="secondary">已下车</button>' : ""}${leg?.mode === "TRANSFER" ? '<button data-transit="TRANSFER_COMPLETED" class="secondary">已完成换乘</button>' : ""}</div>` : ""}
      <details><summary>当前步骤详情</summary><p id="current-step-detail">${escape(currentStepDetail(state))}</p></details><details class="full-itinerary"><summary>查看完整行程</summary><ol class="legs">${state.route ? itinerary(state.route) : ""}</ol></details></section>`;
  }
  if (state.phase === "ENDED")
    html +=
      '<section class="panel"><h2>本次导航已结束</h2><p>定位和地图更新已停止。</p></section>';
  $("#workflow").innerHTML = html;
  if (state.phase === "ROUTE_SELECTION") $("#map-panel").hidden = true;
  renderRoutePreview();
  document
    .querySelectorAll<HTMLDetailsElement>(".navigation details")
    .forEach((detail, i) => {
      detail.open = openedDetails[i] || false;
    });
  $("#cancel")?.addEventListener("click", cancel);
  $("#candidate")?.addEventListener("change", (event) => {
    candidateChosen = true;
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
  const routeTabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-route]"),
  );
  routeTabs.forEach((button, index) => {
    button.onclick = () => {
      selected = button.dataset.route!;
      render();
      $<HTMLButtonElement>(`#route-tab-${index}`)?.focus({
        preventScroll: true,
      });
    };
    button.onkeydown = (event) => {
      const next =
        event.key === "ArrowRight"
          ? (index + 1) % routeTabs.length
          : event.key === "ArrowLeft"
            ? (index + routeTabs.length - 1) % routeTabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? routeTabs.length - 1
                : undefined;
      if (next === undefined) return;
      event.preventDefault();
      routeTabs[next].click();
    };
  });
  $("#retry-route-map")?.addEventListener("click", () => {
    map.dispose();
    void drawMap();
  });
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
  directionHistory = [];
  candidateChosen = false;
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
    }
    const candidates: EndpointCandidate[] = [];
    for (const candidate of intent.destinationCandidates) {
      if (request.signal.aborted) return;
      if (candidate.coordinate) candidates.push(candidate);
      else {
        const enriched = await client.request<{
          candidates: EndpointCandidate[];
        }>("/v1/destinations/resolve", { candidate }, request.signal);
        candidates.push(...enriched.candidates);
      }
    }
    if (request.signal.aborted) return;
    if (
      !candidates.length ||
      candidates.some((candidate) => !candidate.coordinate)
    )
      throw new NavError(
        "DESTINATION_MISSING",
        "未找到可确认的地点，请输入完整地址或坐标。",
      );
    intent.destinationCandidates = candidates;
    if (
      request.signal.aborted ||
      !session.acceptImport(request.version, intent)
    )
      return;
    destination = intent.destinationCandidates[0];
    candidateChosen = intent.destinationCandidates.length === 1;
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
  if (busy || !candidateChosen || !destination?.coordinate) return;
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
      requestAnimationFrame(() => {
        if (
          session.snapshot.version === request.version &&
          session.snapshot.phase === "ROUTE_SELECTION"
        )
          $("#workflow").scrollIntoView({ behavior: "auto", block: "start" });
      });
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
  if (imuBlocksNavigation()) {
    notice = "请先停止传感器采样，再开始导航。";
    render();
    return;
  }
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
    startNavigationTick();
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
function startNavigationTick() {
  if (tick || pageSuspended) return;
  tick = setInterval(() => {
    session.refreshHealth();
    render();
    void drawMap();
  }, 1000);
}
function onFix(value: DeviceFix) {
  fix = value;
  const previous = session.snapshot.location;
  if (session.updateLocation(value) && previous) {
    if (!directionHistory.length) directionHistory.push(previous);
    directionHistory = [...directionHistory, value]
      .filter((item) => value.timestamp - item.timestamp <= 30000)
      .slice(-61);
  }
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
  if (zoomRedraw) clearTimeout(zoomRedraw);
  zoomRedraw = undefined;
  if (close) await imuProbe?.stop();
  if (tick) clearInterval(tick);
  tick = undefined;
  device.setVersion(session.snapshot.version + 1);
  await device.stopLocation();
  if (close) await device.close();
}
async function handleAction(action: DeviceAction) {
  if (action === "ZOOM_IN" || action === "ZOOM_OUT") {
    if (
      pageSuspended ||
      imuBlocksNavigation() ||
      !["NAVIGATING", "ARRIVED"].includes(session.snapshot.phase)
    )
      return;
    if (!map.adjustZoom(action === "ZOOM_IN" ? 1 : -1)) return;
    if (zoomRedraw) clearTimeout(zoomRedraw);
    zoomRedraw = setTimeout(() => {
      zoomRedraw = undefined;
      if (
        !pageSuspended &&
        !imuBlocksNavigation() &&
        ["NAVIGATING", "ARRIVED"].includes(session.snapshot.phase)
      )
        void drawMap();
    }, 200);
    return;
  }
  if (action === "RESUME" && imuBlocksNavigation()) return;
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
      startNavigationTick();
    }
    render();
    if (action !== "END") await drawMap();
  } catch (caught) {
    report(caught);
  }
}
function renderRoutePreview() {
  const canvas = $<HTMLCanvasElement>("#route-preview");
  if (!canvas) return;
  const route = session.snapshot.routes.find((item) => item.id === selected);
  const shown = Boolean(route && map.paintRoutePreview(canvas, route));
  canvas.hidden = !shown;
  $("#route-map-logo").hidden = !shown;
  $("#route-map-status").hidden = shown;
  const missingGeometry =
    route && !route.legs.some((leg) => leg.geometry.length > 1);
  $("#route-map-status").textContent =
    mapError ||
    (missingGeometry ? "这条路线没有可显示的路径。" : "地图加载中…");
  $("#retry-route-map").hidden = !mapError;
  $("#route-copyright").textContent = [
    shown ? map.previewCopyright : "",
    ...(route?.attribution || []),
  ]
    .filter(Boolean)
    .join(" · ");
}
async function drawMap() {
  if (pageSuspended) return;
  const state = session.snapshot;
  if (state.phase === "DESTINATION_CONFIRMATION" && !candidateChosen) return;
  const route =
    state.route && ["NAVIGATING", "ARRIVED"].includes(state.phase)
      ? state.route
      : state.routes.find((candidate) => candidate.id === selected);
  const center = ["NAVIGATING", "ARRIVED"].includes(state.phase)
    ? state.location?.coordinate
    : destination?.coordinate || fix?.coordinate;
  if (!center) return;
  $("#map-panel").hidden = state.phase === "ROUTE_SELECTION";
  if (!client.configured) {
    mapError = "请先在设置中连接导航服务。";
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
  mapError = "";
  renderRoutePreview();
  try {
    const bearing = currentMovementBearing();
    const glassesMap =
      device.connected && ["NAVIGATING", "ARRIVED"].includes(state.phase);
    map.setSize(glassesMap ? 576 : 288, glassesMap ? 192 : 144);
    await map.draw(
      center,
      destination,
      route,
      state.location?.coordinate || fix?.coordinate,
      state.phase === "ROUTE_SELECTION" ? state.routes.slice(0, 3) : [],
      bearing === undefined || !state.location
        ? undefined
        : {
            bearing,
            timestamp: state.location.timestamp,
            maxAgeMs: staleThreshold(mode),
          },
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
      const icon = guidanceView(state, mode).icon;
      const iconPixels = await maneuverPng(icon);
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
        icon: { key: icon, pixels: iconPixels },
        guidance: guidanceView(state, mode),
        instruction: instruction(state),
        status: hudStatus(state, mode),
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
          icon: { key: "none", pixels: await maneuverPng("none") },
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
function currentMovementBearing() {
  const state = session.snapshot;
  if (state.phase !== "NAVIGATING" || state.paused) return;
  return movementBearingFromHistory(directionHistory, mode);
}
function updateMapCaption() {
  renderRoutePreview();
  $("#map-state").textContent = map.ready ? "北向上" : "地图暂不可用";
  $("#map-caption").textContent =
    mapError ||
    (mapPicking
      ? "点击地图选择目的地。选择后仍需确认路线。"
      : session.snapshot.phase === "ROUTE_SELECTION"
        ? "点击路线或下方卡片选择。"
        : `实心圆：最后定位 · 空心圆：目的地${currentMovementBearing() !== undefined ? " · 箭头：行进方向" : ""}。`);
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
function imuBlocksNavigation() {
  const state = imuProbe?.snapshot();
  return (
    imuStarting ||
    state?.status === "starting" ||
    state?.status === "recording" ||
    Boolean(state?.mayBeEnabled)
  );
}
function renderImu() {
  const state = imuProbe?.snapshot();
  const active = imuBlocksNavigation();
  $<HTMLButtonElement>("#imu-start").disabled =
    active ||
    busy ||
    ["NAVIGATING", "ARRIVED"].includes(session.snapshot.phase);
  $<HTMLButtonElement>("#imu-stop").disabled = !active;
  $<HTMLButtonElement>("#imu-upload").disabled =
    active ||
    state?.status !== "stopped" ||
    !state.samples.length ||
    !imuUploadLabel ||
    imuUploadBusy ||
    authBusy ||
    !client.configured;
  $<HTMLSelectElement>("#imu-upload-label").disabled = imuUploadBusy;
  $("#imu-upload-status").textContent =
    imuUploadMessage ||
    (client.configured
      ? imuUploadLabel
        ? "点击上传后，可凭回执查找采样。"
        : "请选择这次做的动作，再上传采样。"
      : "请先配对并连接个人 Worker；也可复制下方本机结果。");
  if (!state) return;
  const last = state.samples.at(-1);
  $("#imu-stats").textContent = state.error
    ? `采样操作未完成${state.mayBeEnabled ? "；IMU 可能仍在运行，请重试停止" : "，请检查 G2 连接"}。`
    : `${{ idle: "尚未采样", starting: "正在启动", recording: "正在采样", stopped: "已停止", error: "采样错误" }[state.status]} · ${state.summary.count} 条${last ? ` · X ${last.x.toFixed(3)} / Y ${last.y.toFixed(3)} / Z ${last.z.toFixed(3)}` : ""}`;
  $("#imu-export").hidden = active || !state.samples.length;
  if (!active)
    $<HTMLTextAreaElement>("#imu-report").value = JSON.stringify(
      state,
      null,
      2,
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-imu-phase]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.imuPhase === state.phase),
      ),
    );
}
$("#imu-start").onclick = async () => {
  if (
    imuBlocksNavigation() ||
    busy ||
    ["NAVIGATING", "ARRIVED"].includes(session.snapshot.phase)
  )
    return;
  imuStarting = true;
  imuSampleRevision++;
  imuUploadMessage = "";
  imuUploadLabel = "";
  $<HTMLSelectElement>("#imu-upload-label").value = "";
  renderImu();
  const epoch = lifecycleEpoch,
    probeEpoch = ++imuEpoch;
  try {
    const bridge = await device.prepareImuProbe();
    if (epoch !== lifecycleEpoch || probeEpoch !== imuEpoch || pageSuspended)
      return;
    imuProbe = createImuProbe({ bridge, onChange: renderImu });
    await imuProbe.start();
  } catch {
    $("#imu-stats").textContent =
      "采样未启动，请在 Even App 内连接 G2 后重试。";
  } finally {
    imuStarting = false;
    renderImu();
  }
};
$("#imu-stop").onclick = async () => {
  imuEpoch++;
  await imuProbe?.stop();
  renderImu();
};
document
  .querySelectorAll<HTMLButtonElement>("[data-imu-phase]")
  .forEach(
    (button) =>
      (button.onclick = () =>
        imuProbe?.setPhase(button.dataset.imuPhase as ImuProbePhase)),
  );
$("#imu-upload-label").onchange = () => {
  const value = $<HTMLSelectElement>("#imu-upload-label").value;
  imuUploadLabel = Object.hasOwn(imuActionLabels, value)
    ? (value as ImuProbePhase)
    : "";
  imuUploadMessage = "";
  renderImu();
};
$("#imu-upload").onclick = async () => {
  const state = imuProbe?.snapshot();
  if (
    imuBlocksNavigation() ||
    state?.status !== "stopped" ||
    !state.samples.length ||
    !imuUploadLabel ||
    imuUploadBusy ||
    authBusy ||
    !client.configured
  )
    return;
  const revision = imuSampleRevision;
  imuUploadBusy = true;
  imuUploadMessage = `正在上传 ${state.samples.length} 条采样…`;
  renderImu();
  try {
    const receipt = await client.request<{
      id: string;
      receivedAt: string;
      sampleCount: number;
    }>("/v1/diagnostics/imu", {
      schemaVersion: 1,
      label: imuUploadLabel,
      samples: state.samples.map(({ receivedAt, phase, x, y, z }) => ({
        receivedAt,
        phase,
        x,
        y,
        z,
      })),
    });
    if (
      typeof receipt.id !== "string" ||
      !/^[a-zA-Z0-9-]{8,128}$/.test(receipt.id) ||
      receipt.sampleCount !== state.samples.length
    )
      throw new Error("Invalid upload receipt");
    if (revision === imuSampleRevision)
      imuUploadMessage = `已上传 ${receipt.sampleCount} 条采样 · 回执 ${receipt.id.slice(0, 8)}`;
  } catch {
    if (revision === imuSampleRevision)
      imuUploadMessage =
        "上传未确认，本机采样已保留。请检查个人 Worker 连接后点击「上传采样」重试。";
  } finally {
    imuUploadBusy = false;
    renderImu();
  }
};
$("#settings").addEventListener("close", () => {
  imuEpoch++;
  void imuProbe?.stop();
});
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
  if (session.snapshot.phase === "ROUTE_SELECTION") {
    const routeId = map.routeFromClick(event);
    if (routeId) {
      selected = routeId;
      render();
      void drawMap();
    }
    return;
  }
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
  void imuProbe?.stop();
  pageSuspended = true;
  lifecycleEpoch++;
  lifecycleStop = stopNavigation(false).catch(report);
  map.dispose();
});
async function restorePageNavigation() {
  if (!pageSuspended) return;
  if (lifecycleRestore) return lifecycleRestore;
  const epoch = lifecycleEpoch,
    version = session.snapshot.version;
  const stillActive = () =>
    lifecycleEpoch === epoch &&
    session.snapshot.version === version &&
    session.snapshot.phase === "NAVIGATING" &&
    !session.snapshot.paused;
  lifecycleRestore = (async () => {
    await lifecycleStop;
    if (lifecycleEpoch !== epoch) return;
    if (!stillActive()) {
      pageSuspended = false;
      return;
    }
    try {
      session.refreshHealth();
      notice =
        "已回到页面；正在核对定位与行程有效期。恢复不代表锁屏期间持续更新。";
      render();
      await device.locate();
      if (!stillActive()) {
        if (lifecycleEpoch === epoch) pageSuspended = false;
        return;
      }
      device.setVersion(version);
      await device.startLocation();
      if (!stillActive()) {
        await device.stopLocation();
        if (lifecycleEpoch === epoch) pageSuspended = false;
        return;
      }
      pageSuspended = false;
      startNavigationTick();
      render();
      void drawMap();
    } catch (caught) {
      if (lifecycleEpoch === epoch) {
        pageSuspended = false;
        if (stillActive()) session.pause();
      }
      report(caught);
    }
  })();
  try {
    await lifecycleRestore;
  } finally {
    lifecycleRestore = undefined;
  }
}
window.addEventListener("pageshow", () => void restorePageNavigation());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (pageSuspended) {
    void restorePageNavigation();
  } else if (
    session.snapshot.phase === "NAVIGATING" &&
    !session.snapshot.paused
  ) {
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
