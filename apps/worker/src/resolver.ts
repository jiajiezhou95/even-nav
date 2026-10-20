import {
  NavError,
  type ImportedIntent,
} from "../../../packages/contracts/src/index";
import {
  parseSharedInput,
  validateMapsUrl,
  isShortMapsUrl,
} from "../../../packages/core/src/index";
import type { Fetcher } from "../../../packages/providers/src/index";
export async function resolveImport(
  text: string,
  fetcher: Fetcher = fetch,
): Promise<ImportedIntent> {
  let intent: ImportedIntent | undefined;
  try {
    intent = parseSharedInput(text);
  } catch (e) {
    if (
      !(e instanceof NavError) ||
      ![
        "UNSUPPORTED_LINK",
        "DESTINATION_MISSING",
        "LINK_RESOLUTION_BLOCKED",
      ].includes(e.code)
    )
      throw e;
  }
  const urls = text.match(/https:\/\/[^\s<>"']+/g) ?? [];
  const short = urls.filter((s) => {
    try {
      return isShortMapsUrl(validateMapsUrl(s));
    } catch {
      return false;
    }
  });
  if (short.length === 0) {
    if (intent) return intent;
    return parseSharedInput(text);
  }
  if (short.length !== 1 || urls.length !== 1)
    throw new NavError("AMBIGUOUS_DESTINATION", "请选择一个链接");
  let current = validateMapsUrl(short[0]);
  const seen = new Set<string>();
  const deadline = Date.now() + 12000;
  for (let hop = 0; hop <= 5; hop++) {
    current = validateMapsUrl(current.toString());
    if (seen.has(current.href))
      throw new NavError("REDIRECT_LOOP", "分享链接重定向循环");
    seen.add(current.href);
    if (!isShortMapsUrl(current)) {
      const result = parseSharedInput(current.href);
      if (result.destinationCandidates.length) return result;
      throw new NavError("LINK_RESOLUTION_BLOCKED", "链接没有可解析目的地");
    }
    const request = async (method: string) => {
      if (Date.now() >= deadline)
        throw new NavError("LINK_TIMEOUT", "链接展开超时", true);
      try {
        return await fetcher(current, {
          method,
          redirect: "manual",
          credentials: "omit",
          headers: { Accept: "text/html" },
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(4000, deadline - Date.now())),
          ),
        });
      } catch {
        throw new NavError("LINK_TIMEOUT", "链接展开超时", true);
      }
    };
    let response = await request("HEAD");
    if (
      response.status === 405 ||
      response.status === 501 ||
      (!response.headers.get("Location") && response.status === 200)
    ) {
      await response.body?.cancel();
      response = await request("GET");
    }
    const location = response.headers.get("Location");
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status) || !location)
      throw new NavError(
        "LINK_RESOLUTION_BLOCKED",
        "链接需要登录、脚本或不可用",
      );
    if (location.length > 8192)
      throw new NavError("UNSAFE_URL", "重定向地址过长");
    if (hop === 5)
      throw new NavError("LINK_RESOLUTION_BLOCKED", "重定向次数过多");
    current = validateMapsUrl(new URL(location, current).href);
  }
  throw new NavError("LINK_RESOLUTION_BLOCKED", "链接展开失败");
}
