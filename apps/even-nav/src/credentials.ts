import { NavError } from "../../../packages/contracts/src/index";
import { WorkerClient } from "./client";
import { getEvenBridge, isEvenHost } from "./runtime";

export const DEVICE_CREDENTIAL_KEY = "even-nav.device-credential.v1";
export interface DeviceCredential {
  version: 1;
  origin: string;
  deviceToken: string;
  expiresAt: string;
}
export interface CredentialStore {
  kind: "EVEN_APP" | "BROWSER_PREVIEW";
  read(): Promise<string>;
  write(value: string): Promise<void>;
}
export function createCredentialStore(): CredentialStore {
  // Only the explicitly local Vite development preview may use browser storage.
  // A production Beta always waits for native readiness, even when injection is late.
  const native =
    isEvenHost() ||
    !(
      import.meta.env.DEV &&
      ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
    );
  return {
    kind: native ? "EVEN_APP" : "BROWSER_PREVIEW",
    async read() {
      if (native)
        return (await getEvenBridge()).getLocalStorage(DEVICE_CREDENTIAL_KEY);
      return localStorage.getItem(DEVICE_CREDENTIAL_KEY) || "";
    },
    async write(value) {
      if (native) {
        const bridge = await getEvenBridge();
        if (
          !(await bridge.setLocalStorage(DEVICE_CREDENTIAL_KEY, value)) ||
          (await bridge.getLocalStorage(DEVICE_CREDENTIAL_KEY)) !== value
        )
          throw new Error("Credential storage unavailable");
      } else {
        if (value) localStorage.setItem(DEVICE_CREDENTIAL_KEY, value);
        else localStorage.removeItem(DEVICE_CREDENTIAL_KEY);
        if ((localStorage.getItem(DEVICE_CREDENTIAL_KEY) || "") !== value)
          throw new Error("Credential storage unavailable");
      }
    },
  };
}
export function decodeCredential(
  value: string,
  origin: string,
  now = Date.now(),
): DeviceCredential | undefined {
  try {
    if (!value || value.length > 12000) return;
    const data = JSON.parse(value) as DeviceCredential;
    if (
      data.version !== 1 ||
      data.origin !== origin ||
      typeof data.deviceToken !== "string" ||
      data.deviceToken.length < 20 ||
      data.deviceToken.length > 8192 ||
      /\s/.test(data.deviceToken) ||
      typeof data.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(data.expiresAt)) ||
      Date.parse(data.expiresAt) <= now
    )
      return;
    return {
      version: 1,
      origin,
      deviceToken: data.deviceToken,
      expiresAt: data.expiresAt,
    };
  } catch {
    return;
  }
}
export type RestoreResult =
  "EMPTY" | "RESTORED" | "EXPIRED_OR_INVALID" | "OFFLINE";
export class DeviceCredentials {
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  private credential?: DeviceCredential;
  constructor(
    readonly client: WorkerClient,
    readonly store: CredentialStore,
  ) {}
  private save(value: string): Promise<void> {
    const operation = this.writes
      .catch(() => {})
      .then(() => this.store.write(value));
    this.writes = operation;
    return operation;
  }
  async restore(): Promise<RestoreResult> {
    const generation = ++this.generation;
    const raw = await this.store.read();
    if (generation !== this.generation) return "EMPTY";
    if (!raw) return "EMPTY";
    const credential = decodeCredential(raw, this.client.origin);
    if (!credential) {
      this.client.configure("");
      await this.save("");
      return "EXPIRED_OR_INVALID";
    }
    this.credential = credential;
    this.client.configure(credential.deviceToken);
    try {
      await this.client.request("/v1/providers");
      return generation === this.generation ? "RESTORED" : "EMPTY";
    } catch (error) {
      if (generation !== this.generation) return "EMPTY";
      if (error instanceof NavError && error.code === "AUTH_FAILED") {
        await this.invalidate();
        return "EXPIRED_OR_INVALID";
      }
      // Keep the valid stored device credential through temporary network outages.
      return "OFFLINE";
    }
  }
  async pair(
    ownerToken: string,
  ): Promise<{ saved: boolean; verified: boolean; expiresAt: string }> {
    const generation = ++this.generation;
    const issued = await this.client.requestWithCredential<{
      deviceToken: string;
      expiresAt: string;
    }>("/v1/auth/pair", {}, ownerToken);
    const credential = decodeCredential(
      JSON.stringify({ version: 1, origin: this.client.origin, ...issued }),
      this.client.origin,
    );
    if (!credential || credential.deviceToken === ownerToken.trim())
      throw new NavError("AUTH_FAILED", "配对返回的设备凭据无效，请检查后端。");
    if (generation !== this.generation)
      throw new NavError("AUTH_FAILED", "配对已取消。");
    this.credential = credential;
    this.client.configure(credential.deviceToken);
    let saved = true;
    try {
      await this.save(JSON.stringify(credential));
    } catch {
      // This session can continue, but never claim it will survive a relaunch.
      saved = false;
      await this.save("").catch(() => {});
    }
    try {
      await this.client.request("/v1/providers");
      return { saved, verified: true, expiresAt: credential.expiresAt };
    } catch (error) {
      if (error instanceof NavError && error.code === "AUTH_FAILED") {
        await this.invalidate();
        throw error;
      }
      return { saved, verified: false, expiresAt: credential.expiresAt };
    }
  }
  async invalidate(): Promise<void> {
    this.generation++;
    this.credential = undefined;
    this.client.configure("");
    await this.save("");
  }
  async forget(): Promise<{ revoked: boolean; removed: boolean }> {
    this.generation++;
    const token = this.credential?.deviceToken;
    this.credential = undefined;
    this.client.configure("");
    // Local removal is attempted first; a network failure cannot postpone forgetting.
    let removed = true;
    try {
      await this.save("");
    } catch {
      removed = false;
    }
    let revoked = false;
    if (token) {
      try {
        const response = await this.client.requestWithCredential<{
          revoked: boolean;
        }>("/v1/auth/revoke", {}, token);
        revoked = response.revoked === true;
      } catch (error) {
        revoked = error instanceof NavError && error.code === "AUTH_FAILED";
      }
    } else revoked = true;
    return { revoked, removed };
  }
}
