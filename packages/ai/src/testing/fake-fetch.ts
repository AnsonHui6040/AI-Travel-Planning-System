import type { RecordedResponse } from "./fixtures";

// 以錄製回應取代網路：依序回傳，並記錄每次請求供測試檢查請求格式
export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Step = RecordedResponse | "network-error" | "hang";

export function fakeFetch(steps: Step[]) {
  const requests: CapturedRequest[] = [];
  const queue = [...steps];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    for (const [key, value] of new Headers(init?.headers).entries()) headers[key] = value;
    const rawBody = typeof init?.body === "string" ? init.body : await request.clone().text();
    requests.push({
      url: request.url,
      method: request.method,
      headers,
      body: rawBody ? safeJson(rawBody) : undefined,
    });

    const step = queue.shift();
    if (step === undefined) throw new Error("fake fetch：沒有更多錄製回應");
    if (step === "network-error") throw new TypeError("fetch failed");
    if (step === "hang") {
      const signal = init?.signal ?? request.signal;
      return new Promise<Response>((_, reject) => {
        const abort = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
        if (signal?.aborted) abort();
        signal?.addEventListener("abort", abort);
      });
    }
    return new Response(JSON.stringify(step.body), {
      status: step.status,
      headers: { "content-type": "application/json", ...step.headers },
    });
  };

  return { fetch, requests, remaining: () => queue.length };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
