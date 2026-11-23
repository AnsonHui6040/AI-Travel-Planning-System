import type { Metadata } from "next";
import { FIELD_LABELS } from "../../../../lib/server/sensitive-fields-core";
import { loadMyInfo } from "../../../../lib/server/sensitive-fields";
import { MyInfoForms } from "./my-info-forms";
import "../../../settings/settings.css";

export const metadata: Metadata = { title: "我的聯絡資料" };
export const dynamic = "force-dynamic";

export default async function MyInfoPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadMyInfo(tripId);
  return (
    <main className="settings">
      <h1>我的聯絡資料</h1>
      {view.state === "signed_out" ? <p>請先登入。</p> : null}
      {view.state === "not_found" ? <p>找不到這個行程，或你不是成員。</p> : null}
      {view.state === "ok" ? (
        <>
          <p>
            {view.tripName}。這些資料只用於此行程，加密儲存。三個開關預設關閉，只有你可以修改；清空欄位後儲存即刪除。
          </p>
          <MyInfoForms tripId={tripId} own={view.own} />
          <section aria-labelledby="shared-heading" className="shared">
            <h2 id="shared-heading">同行成員提供的資料</h2>
            {view.shared.length === 0 ? (
              <p>目前沒有成員提供資料給你。</p>
            ) : (
              <table className="usage" aria-label="同行成員提供的資料">
                <thead>
                  <tr>
                    <th scope="col">成員</th>
                    <th scope="col">欄位</th>
                    <th scope="col">內容</th>
                  </tr>
                </thead>
                <tbody>
                  {view.shared.map((s) => (
                    <tr key={`${s.memberName}:${s.field}:${s.value}`}>
                      <th scope="row">{s.memberName}</th>
                      <td>{FIELD_LABELS[s.field]}</td>
                      <td>{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
