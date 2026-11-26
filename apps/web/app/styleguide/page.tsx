import type { Metadata } from "next";
import "./styleguide.css";

// 元件樣板頁：靜態畫面，不讀資料、不送出任何東西。淺色與深色並排，樣式與正式頁面共用 globals.css。
// 色彩依 ORYZO 工作版，按鈕依 Meta Astryx（docs/verification/UI-astryx-buttons.md）

export const metadata: Metadata = { title: "元件樣板", robots: { index: false, follow: false } };

const COLORS = [
  { token: "--text", name: "文字", use: "內文、標題" },
  { token: "--muted", name: "次要文字", use: "說明、日期、狀態" },
  { token: "--accent", name: "點綴", use: "At Risk、衝突、晚到、錯誤、危險按鈕" },
  { token: "--line-strong", name: "控制項邊框", use: "輸入欄外框" },
  { token: "--line", name: "分隔線", use: "段落與清單分隔" },
];

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTONS: ReadonlyArray<{ variant: ButtonVariant; name: string; label: string; loading: string; use: string }> = [
  { variant: "primary", name: "主要", label: "執行 Morning Check", loading: "檢查中…", use: "每個畫面只有一個" },
  { variant: "secondary", name: "次要", label: "記錄", loading: "記錄中…", use: "一般動作、清單中重複的動作" },
  { variant: "ghost", name: "低強調", label: "取消", loading: "處理中…", use: "取消、標為已讀" },
  { variant: "danger", name: "危險", label: "刪除", loading: "刪除中…", use: "刪除、否決、移除；會寫入的先確認" },
];

const TABS = ["今天", "每日", "候選", "提案", "記憶", "旅後"];

function Panel({ theme, title }: { theme: "light" | "dark"; title: string }) {
  const id = (s: string) => `${theme}-${s}`;
  return (
    <section data-theme={theme} className="sg-panel" aria-label={title}>
      <h2>{title}</h2>

      <h3>行程分頁</h3>
      <nav aria-label={`${title}行程分頁`} className="trip-nav sg-nav">
        {TABS.map((t, i) => (
          <a key={t} href="#top" aria-current={i === 0 ? "page" : undefined}>
            {t}
          </a>
        ))}
      </nav>

      <h3>按鈕</h3>
      <table className="sg-table">
        <thead>
          <tr>
            <th scope="col">種類</th>
            <th scope="col">一般</th>
            <th scope="col">停用</th>
            <th scope="col">載入中</th>
          </tr>
        </thead>
        <tbody>
          {BUTTONS.map((b) => (
            <tr key={b.variant}>
              <th scope="row">
                {b.name}
                <span className="muted">{b.use}</span>
              </th>
              <td>
                <button className={b.variant} type="button">
                  {b.label}
                </button>
              </td>
              <td>
                <button className={b.variant} type="button" disabled>
                  {b.label}
                </button>
              </td>
              <td>
                <button className={b.variant} type="button" disabled aria-busy="true">
                  {b.loading}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sg-row">
        <a className="pill-link" href="#top">
          Incident Mode
        </a>
        <span className="muted">導覽用連結，外觀與次要按鈕相同</span>
      </p>

      <h3>確認</h3>
      <div className="sg-dialog" role="group" aria-label={`${title}確認範例`}>
        <p>刪除「每日步行上限」？刪除後 AI 不會再使用，無法復原。</p>
        <div className="sg-row">
          <button className="ghost" type="button">
            取消
          </button>
          <button className="danger" type="button">
            刪除
          </button>
        </div>
      </div>
      <p className="muted">實際使用瀏覽器內建的確認視窗；這裡只示意文字與按鈕的層級。</p>

      <h3>輸入欄</h3>
      <div className="sg-fields">
        <label htmlFor={id("item")}>
          項目
          <input id={id("item")} defaultValue="每日步行上限" />
        </label>
        <label htmlFor={id("time")}>
          到達
          <input id={id("time")} type="time" defaultValue="09:15" />
        </label>
        <label htmlFor={id("kind")}>
          類型
          <select id={id("kind")} defaultValue="constraint">
            <option value="constraint">限制</option>
            <option value="preference">偏好</option>
          </select>
        </label>
        <label htmlFor={id("check")} className="sg-check">
          <input id={id("check")} type="checkbox" defaultChecked />
          提供給 AI
        </label>
      </div>

      <h3>標示與訊息</h3>
      <p className="sg-row">
        <span className="sg-tag sg-accent">At Risk</span>
        <span className="sg-tag sg-accent">成員間有不同設定，已取最保守值</span>
        <span className="sg-tag">已去過</span>
        <span className="sg-tag sg-quiet">Day Ready</span>
      </p>
      <p className="sg-ok">已儲存</p>
      <p className="error">實際時間不可晚於現在</p>

      <h3>清單列</h3>
      <ul className="sg-list">
        <li>
          <div className="sg-row">
            <strong>淺草寺</strong>
            <span className="muted">已完成</span>
          </div>
          <dl className="sg-times">
            <div>
              <dt>排定</dt>
              <dd>09:00–10:30</dd>
            </div>
            <div>
              <dt>實際</dt>
              <dd>
                09:15–10:40 <span className="sg-late">晚 15 分鐘</span>
              </dd>
            </div>
          </dl>
        </li>
        <li>
          <div className="sg-row">
            <strong>晴空塔</strong>
            <span className="sg-accent-text">沒有紀錄</span>
          </div>
        </li>
      </ul>

      <h3>文字</h3>
      <p className="sg-h1">當日行程</p>
      <p className="sg-h2">Morning Check</p>
      <p>正文 17px：今天還沒有執行 Morning Check。</p>
      <p className="muted sg-small">次要 15px：東京一日，2026-11-20</p>

      <h3>色彩</h3>
      <dl className="sg-colors">
        {COLORS.map((c) => (
          <div key={c.token}>
            {c.token.startsWith("--line") ? (
              <dt>
                {c.name}
                <span className={`sg-rule sg-c${c.token.slice(1)}`} aria-hidden="true" />
              </dt>
            ) : (
              <dt className={`sg-c${c.token.slice(1)}`}>{c.name}</dt>
            )}
            <dd className="muted">
              <code>{c.token}</code>，{c.use}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function StyleguidePage() {
  return (
    <main className="sg" id="top">
      <h1>元件樣板</h1>
      <p className="muted">靜態畫面，不讀取資料、不送出任何內容。左邊淺色、右邊深色（手機上為上下排列）；App 會跟隨系統設定切換。</p>
      <div className="sg-grid">
        <Panel theme="light" title="淺色" />
        <Panel theme="dark" title="深色" />
      </div>
    </main>
  );
}
