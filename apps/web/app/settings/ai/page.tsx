import type { Metadata } from "next";
import { ROLE_NAMES } from "@atps/core";
import { loadAiSettings } from "../../../lib/server/ai-settings";
import { AiSettingsForms } from "./ai-settings-forms";
import "../settings.css";

export const metadata: Metadata = { title: "AI 角色" };
export const dynamic = "force-dynamic";

const number = (n: number) => n.toLocaleString("zh-TW");

export default async function AiSettingsPage() {
  const view = await loadAiSettings();
  return (
    <main className="settings">
      <h1>AI 角色</h1>
      {view.signedIn ? (
        <>
          <p>
            每個角色依序使用第 1 順位的 AI。供應商故障時會先詢問你，才改用下一順位。Gemini 與 OpenAI
            要先取得模型清單再選擇模型。
          </p>
          {view.warning ? (
            <p role="alert" className="status error">
              {view.warning}
            </p>
          ) : null}
          <AiSettingsForms settings={view.settings} />
          <table className="usage" aria-label="近 30 日用量">
            <caption>近 30 日用量</caption>
            <thead>
              <tr>
                <th scope="col">角色</th>
                <th scope="col">次數</th>
                <th scope="col">步數</th>
                <th scope="col">輸入 token</th>
                <th scope="col">輸出 token</th>
              </tr>
            </thead>
            <tbody>
              {view.usage.map((u) => (
                <tr key={u.role}>
                  <th scope="row">{ROLE_NAMES[u.role]}</th>
                  <td>{number(u.runs)}</td>
                  <td>{number(u.steps)}</td>
                  <td>{number(u.inputTokens)}</td>
                  <td>{number(u.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p>請先登入。</p>
      )}
    </main>
  );
}
