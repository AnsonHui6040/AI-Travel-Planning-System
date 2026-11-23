import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import type { FetchTransport, ResolveHost } from "./fetch-types";

// T16：白名單 fetch 的 Node 連線層。連線固定到已驗證的位址，避免 DNS rebinding

export const nodeResolve: ResolveHost = async (host) => {
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

// https.request 的 lookup：忽略主機名稱，只回傳已驗證的位址
export function pinnedLookup(address: string) {
  const family = isIP(address);
  return (_host: string, options: { all?: boolean }, callback: LookupCallback): void => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

export const nodeTransport: FetchTransport = ({ url, address, headers, signal }) =>
  new Promise((resolve, reject) => {
    const options: RequestOptions = {
      method: "GET",
      protocol: "https:",
      host: url.hostname,
      servername: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      headers,
      lookup: pinnedLookup(address) as unknown as RequestOptions["lookup"],
      agent: false,
      signal,
    };
    const req = request(options, (res) => {
      // 再次確認實際連線的位址
      if (res.socket.remoteAddress !== undefined && res.socket.remoteAddress !== address) {
        res.destroy();
        reject(new Error("連線位址與驗證結果不符"));
        return;
      }
      const flat: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(res.headers)) flat[key] = Array.isArray(value) ? value.join(", ") : value;
      resolve({
        status: res.statusCode ?? 0,
        headers: flat,
        body: res,
        cancel: () => {
          res.destroy();
        },
      });
    });
    req.on("error", reject);
    req.end();
  });
