import type { Metadata } from "next";
import { listOwnApiKeys } from "../../../lib/server/api-keys";
import { ApiKeyForms } from "./api-key-forms";
import "../settings.css";

export const metadata: Metadata = { title: "API key" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const { signedIn, keys } = await listOwnApiKeys();
  return (
    <main className="settings">
      <h1>API key</h1>
      {signedIn ? (
        <>
          <p>每個 key 只供你本人的請求與你發起的背景工作使用，不會提供給同行成員。儲存後只顯示末四碼。</p>
          <ApiKeyForms keys={keys} />
        </>
      ) : (
        <p>請先登入。</p>
      )}
    </main>
  );
}
