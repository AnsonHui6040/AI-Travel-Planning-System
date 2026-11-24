import type { Metadata } from "next";
import { loadMembers } from "../../../../lib/server/members";
import { InviteButtons, LeaveTripButton, MemberControls, ReadonlyLinkButtons, RevokeInviteButton, RevokeReadonlyLinkButton } from "./member-forms";
import "../../../settings/settings.css";
import "./members.css";

export const metadata: Metadata = { title: "成員" };
export const dynamic = "force-dynamic";

const ROLE_LABELS = { owner: "Owner", companion: "Companion", viewer: "Viewer" } as const;
const STATUS_LABELS = { active: "有效", accepted: "已接受", revoked: "已撤銷", expired: "已過期" } as const;
const LINK_STATUS_LABELS = { active: "有效", revoked: "已撤銷", expired: "已過期" } as const;
function formatDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

export default async function MembersPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadMembers(tripId);
  if (view.state !== "ok") {
    return (
      <main className="settings members">
        <h1>成員</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const isOwner = view.myRole === "owner";
  return (
    <main className="settings members">
      <h1>成員</h1>
      <p className="trip-line">{view.tripName}</p>
      <section aria-labelledby="member-list">
        <h2 id="member-list">目前成員</h2>
        <ul className="member-list">
          {view.members.map((m) => (
            <li key={m.userId} aria-label={m.name}>
              <span className="member-name">
                {m.name}
                {m.isMe ? "（你）" : ""}
              </span>
              <span className="member-role">{ROLE_LABELS[m.role]}</span>
              {isOwner && m.role !== "owner" ? <MemberControls tripId={tripId} userId={m.userId} name={m.name} role={m.role} /> : null}
            </li>
          ))}
        </ul>
      </section>
      {isOwner ? (
        <section aria-labelledby="invite-heading">
          <h2 id="invite-heading">邀請成員</h2>
          <p className="muted">把連結傳給對方，對方登入後開啟即可加入。連結 7 天內有效、只能使用一次，可隨時撤銷。移除成員時，會刪除其在此行程的敏感欄位與記憶。</p>
          <InviteButtons tripId={tripId} />
          {view.invitations.length > 0 ? (
            <ul className="invite-list">
              {view.invitations.map((i) => (
                <li key={i.id}>
                  <span>{ROLE_LABELS[i.role]}</span>
                  <span>
                    {STATUS_LABELS[i.status]}
                    {i.status === "active" ? `，到 ${formatDate(i.expiresAt)}` : ""}
                  </span>
                  {i.status === "active" ? <RevokeInviteButton tripId={tripId} invitationId={i.id} /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {isOwner ? (
        <section aria-labelledby="readonly-heading">
          <h2 id="readonly-heading">唯讀連結</h2>
          <p className="muted">
            拿到連結的人不必登入即可檢視已排入的行程，不能修改、不能使用 AI。只顯示當事人開啟「提供給 Viewer 與唯讀連結」的敏感欄位。可隨時撤銷。
          </p>
          <ReadonlyLinkButtons tripId={tripId} />
          {view.readonlyLinks.length > 0 ? (
            <ul className="invite-list">
              {view.readonlyLinks.map((l) => (
                <li key={l.id}>
                  <span>唯讀連結</span>
                  <span>
                    {LINK_STATUS_LABELS[l.status]}
                    {l.status === "active" ? `，到 ${formatDate(l.expiresAt)}` : ""}
                  </span>
                  {l.status === "active" ? <RevokeReadonlyLinkButton tripId={tripId} linkId={l.id} /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="leave-heading">
          <h2 id="leave-heading">退出行程</h2>
          <LeaveTripButton tripId={tripId} />
        </section>
      )}
    </main>
  );
}
