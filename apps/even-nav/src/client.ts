import { NavError } from "../../../packages/contracts/src/index";

export class WorkerClient {
  private token = "";
  onAuthFailure?: () => void;
  readonly origin: string;
  constructor() {
    const configured = import.meta.env.VITE_WORKER_ORIGIN || "";
    this.origin = configured ? new URL(configured).origin : "";
  }
  configure(token: string) {
    this.token = token.trim();
  }
  get configured() {
    return Boolean(this.origin && this.token);
  }
  async requestWithCredential<T>(
    path: string,
    body: unknown,
    credential: string,
  ): Promise<T> {
    const response = await this.fetch(path, body, undefined, credential.trim());
    return response.json() as Promise<T>;
  }
  async request<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetch(path, body, signal);
    return response.json() as Promise<T>;
  }
  async fetch(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    credential = this.token,
  ): Promise<Response> {
    if (!this.origin || !credential)
      throw new NavError(
        "CONFIG_MISSING",
        "请先连接你的个人 Worker。",
        false,
        "在设置中完成一次设备配对。",
      );
    if (!path.startsWith("/v1/")) throw new Error("Invalid API path");
    const timeout = AbortSignal.timeout(15000);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    timeout.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await fetch(this.origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) {
        if (
          response.status === 401 &&
          credential === this.token &&
          !path.startsWith("/v1/auth/")
        )
          this.onAuthFailure?.();
        const payload = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; retryable?: boolean };
        };
        const code =
          response.status === 401
            ? "AUTH_FAILED"
            : response.status === 429
              ? "QUOTA_EXCEEDED"
              : payload.error?.code;
        const safeMessages: Record<string, string> = {
          CONFIG_MISSING: "此服务尚未配置，请检查个人 Worker 设置。",
          AUTH_FAILED: "设备凭据已失效，请在设置中重新配对。",
          QUOTA_EXCEEDED: "请求额度已达上限，请稍后再试或检查预算。",
          NO_ROUTE: "当前条件下没有可用路线，请调整模式或出发时间。",
          LINK_RESOLUTION_BLOCKED:
            "分享链接无法安全展开，请粘贴完整 Maps URL 或输入坐标。",
          DESTINATION_MISSING: "未找到明确目的地，请补充地址或坐标。",
        };
        throw new NavError(
          (code && code in safeMessages
            ? code
            : "PROVIDER_UNAVAILABLE") as NavError["code"],
          safeMessages[code || ""] || "服务暂不可用。请检查连接后重试。",
          Boolean(payload.error?.retryable),
        );
      }
      return response;
    } catch (error) {
      if (error instanceof NavError || signal?.aborted) throw error;
      throw new NavError(
        "PROVIDER_UNAVAILABLE",
        "连接超时或网络不可用，请重试。",
        true,
      );
    } finally {
      signal?.removeEventListener("abort", abort);
      timeout.removeEventListener("abort", abort);
    }
  }
}
