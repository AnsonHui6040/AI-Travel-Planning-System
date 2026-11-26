"use client";

import { useActionState } from "react";
import type { MembersActionResult } from "../../../../lib/server/members-core";
import { changeRole, createInvite, createReadonlyLink, leaveTrip, removeMember, revokeInvite, revokeReadonlyLink } from "./actions";

// T32：成員管理的表單。表單內只有隱藏欄位與按鈕（React 19 會在 Server Action 後重設表單）

type Action = (previous: MembersActionResult | null, form: FormData) => Promise<MembersActionResult>;

function ActionButton({
  action,
  fields,
  label,
  confirmText,
  linkLabel = "邀請連結",
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  confirmText?: string;
  linkLabel?: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form
      action={run}
      className="member-action"
      onSubmit={(event) => {
        if (confirmText && !window.confirm(confirmText)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button className={confirmText ? "danger" : "secondary"} type="submit" disabled={pending}>
        {label}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
      {state?.link ? (
        <p className="invite-link">
          <input readOnly value={state.link} aria-label={linkLabel} onFocus={(e) => e.currentTarget.select()} />
        </p>
      ) : null}
    </form>
  );
}

export function InviteButtons({ tripId }: { tripId: string }) {
  return (
    <div className="invite-buttons">
      <ActionButton action={createInvite} fields={{ tripId, role: "companion" }} label="建立 Companion 邀請連結" />
      <ActionButton action={createInvite} fields={{ tripId, role: "viewer" }} label="建立 Viewer 邀請連結" />
    </div>
  );
}

export function RevokeInviteButton({ tripId, invitationId }: { tripId: string; invitationId: string }) {
  return <ActionButton action={revokeInvite} fields={{ tripId, invitationId }} label="撤銷" />;
}

export function MemberControls({ tripId, userId, name, role }: { tripId: string; userId: string; name: string; role: "companion" | "viewer" }) {
  const next = role === "companion" ? "viewer" : "companion";
  return (
    <div className="member-controls">
      <ActionButton action={changeRole} fields={{ tripId, userId, role: next }} label={next === "viewer" ? "改為 Viewer" : "改為 Companion"} />
      <ActionButton
        action={removeMember}
        fields={{ tripId, userId }}
        label="移除"
        confirmText={`移除 ${name}？其在此行程的敏感欄位與記憶會一併刪除。`}
      />
    </div>
  );
}

export function LeaveTripButton({ tripId }: { tripId: string }) {
  return <ActionButton action={leaveTrip} fields={{ tripId }} label="退出這個行程" confirmText="退出後就看不到這個行程，確定退出？" />;
}

// T33：唯讀連結
export function ReadonlyLinkButtons({ tripId }: { tripId: string }) {
  return (
    <div className="invite-buttons">
      <ActionButton action={createReadonlyLink} fields={{ tripId, days: "7" }} label="建立唯讀連結（7 天）" linkLabel="唯讀連結" />
      <ActionButton action={createReadonlyLink} fields={{ tripId, days: "30" }} label="建立唯讀連結（30 天）" linkLabel="唯讀連結" />
    </div>
  );
}

export function RevokeReadonlyLinkButton({ tripId, linkId }: { tripId: string; linkId: string }) {
  return <ActionButton action={revokeReadonlyLink} fields={{ tripId, linkId }} label="撤銷" />;
}
