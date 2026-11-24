import type { Metadata } from "next";
import { loadInvitePreview } from "../../../lib/server/members";
import { AcceptInviteForm } from "./accept-form";
import "../../settings/settings.css";

// T32：邀請連結。受邀者登入後才看得到行程名稱與角色，接受後加入

export const metadata: Metadata = { title: "行程邀請", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const ROLE_LABELS = { companion: "Companion（可提出與批准修改）", viewer: "Viewer（只能檢視）" } as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await loadInvitePreview(token);
  return (
    <main className="settings">
      <h1>行程邀請</h1>
      {preview.state === "signed_out" ? <p>請先登入，再開啟這個邀請連結。</p> : null}
      {preview.state === "invalid" ? <p>邀請連結無效、已使用、已撤銷或已過期。請向行程的 Owner 索取新的連結。</p> : null}
      {preview.state === "member" ? <p>你已經是「{preview.tripName}」的成員。</p> : null}
      {preview.state === "valid" ? (
        <>
          <p>
            你受邀加入「{preview.tripName}」，角色為 {ROLE_LABELS[preview.role]}。
          </p>
          <AcceptInviteForm token={token} />
        </>
      ) : null}
    </main>
  );
}
