import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";

export function isEvenHost(): boolean {
  return Boolean(
    (window as Window & { flutter_inappwebview?: { callHandler?: unknown } })
      .flutter_inappwebview?.callHandler,
  );
}

let pendingBridge: Promise<EvenAppBridge> | undefined;
export function getEvenBridge(): Promise<EvenAppBridge> {
  // The SDK waits for evenAppBridgeReady when native injection arrives after page load.
  // Production credential storage must wait here, never fall back to browser storage.
  if (!pendingBridge) {
    pendingBridge = (async () => {
      const sdk = await import("@evenrealities/even_hub_sdk");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          sdk.waitForEvenAppBridge(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Even bridge timeout")),
              8000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })().catch((error) => {
      pendingBridge = undefined;
      throw error;
    });
  }
  return pendingBridge;
}
