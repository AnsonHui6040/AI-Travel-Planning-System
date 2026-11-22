## Grill-Me Decisions

來源：多_AI_協作旅行規劃與旅行現場動態調整_SOP.docx（2026-11-22 讀取）

- **定位**：先自己旅行用（你同同行者）；用過之後再決定公開。所有設計都要預留公開（帳號、多租戶、成本、私隱），但第一版唔做公開功能。
- **產品形態**：Web App（PWA）＋後端。AI 全部喺後端調用，API key 唔落手機；PWA 要可以離線睇當日行程。
- **AI 供應商**：Claude、Gemini、OpenAI 三家都接駁；每個角色可以由使用者自己揀模型。需要 provider adapter 層，角色同模型解耦。
- **獨立核實規則**：Research 同 Verification 揀同一家時，警告但允許；該項資料最高只可以標 Partially Verified。每項資料要記錄產生者同核實者（provider＋model）。
- **離線**：離線可讀＋預算資料。Morning Check 時預先計好每站最遲離開時間、附近 Backup，存落手機；離線可以睇行程、倒數、備用方案；重算等有網，修改排隊。
- **供應商備援**：每個角色設主模型＋備援次序，但出事時先問使用者再切換（唔自動切）。等候期間畫面顯示預算 Backup。切換後如果同 Research 同家，套用「最高 Partially Verified」規則。
- **寫入權**：所有 AI（包括 Master Planner）只可以輸出符合 schema 嘅變更提案 JSON；只有一個後端函式（例如 applyChange）檢查狀態機同批准規則之後寫入。AI 冇資料庫寫入權。
- **批准規則**：新候選、候選核實狀態 → 自動；已批准項目事實失效 → 自動標 At Risk＋通知，重排要批准；L1 延誤 10–20 分鐘 → 自動壓縮緩衝＋通知；L2／L3／L4、Major、加入空檔候選 → 一律要使用者批准。
- **平台**：Next.js 放 Vercel＋Supabase（Postgres、Auth、Storage、RLS）。另外準備 Docker（Next.js standalone Dockerfile＋docker-compose，Supabase 用 CLI 本地 Docker），需要時先部署去其他地方，第一版唔部署 Docker。長工作用背景 job。
- **目的地範圍**：通用＋日本優先。路線同地點用 Google Maps Platform；天氣用 Open-Meteo；即時交通狀態第一版接日本 ODPT；其他地區日後加 adapter。
- **相片**：只永久存 Google place_id；有網時即時顯示 Google 相（附來源標示）；離線卡片用使用者上載或 Wikimedia Commons CC 相（存 Supabase Storage，記錄授權同作者）；冇相就顯示當地名稱同地址。
- **訂閱登入額度（2026-11-22 查證）**：Claude（Agent SDK 文件：未經批准唔准第三方提供 claude.ai 登入或訂閱額度）同 Gemini（Gemini CLI 條款禁止第三方借用 OAuth）都唔可以用；OpenAI「Sign in with ChatGPT」token sharing 自助只限開源／本機／自架 VM，遠端託管要填 interest form。Claude Max／Ultra／Team 附送每月 Console API credit，可以經 API key 用（覆蓋範圍待確認）。
- **API key**：第一版就做 BYOK（用戶自備 API key，加密存 Supabase Vault，你自己都行呢個流程）。每家 provider 有「認證方式」介面（api_key／plan_oauth），OpenAI plan 登入等批咗或者 Docker 自架時先開。使用者要自己填 OpenAI interest form。
- **Key 隔離（分享）**：每個人只可以用自己嘅 key。分享者嘅 key 永遠唔會畀被分享者觸發；被分享者要觸發任何 AI 動作，一定要用佢自己嘅 key。
- **成本控制**：只防迴圈。每個角色設最多步數同 token 上限，超過就停；唔設金額上限，只顯示每個角色用量。
- **分享權限**：共同批准。Owner 同 Companion 都可以批准；Viewer 只讀。（衝突規則見下一條）
- **批准衝突**：先到先得＋版本檢查（樂觀鎖）。每個提案記錄 base version；批准時正式行程已變就自動失效，要對最新版本重算再批。離線排隊嘅修改同樣處理。所有成員即時收通知。
- **敏感資料**：使用者自己揀。每個敏感欄位兩個開關：「俾 AI」同「俾 Viewer／唯讀連結」，預設全部關。個人資料由當事人控制（同行者自己嘅健康限制由佢自己揀）。敏感欄位加密存。（敏感欄位範圍已由 M-11 決定收窄，見下）
- **記憶**：三層（個人偏好、Planning Rules、單趟旅行 context）。旅後 AI 對比 Planned vs Actual 提出規則，使用者批准先寫入；AI 冇記憶寫入權。全部存自己資料庫，三家 AI 共用，可以睇、改、刪。
- **共用記憶**：共同行程自動合併所有成員嘅一般記憶；敏感記憶（健康、飲食限制等）跟敏感欄位開關，預設唔合併。限制數值衝突時取最保守值（待實作時用模板 H 確認），畫面標明有衝突但唔顯示係邊個。（2026-11-22 已被「M-11 敏感欄位」決定取代，見下）
- **AI 上網**：兩者都用。一般研究用供應商內建搜尋（Claude web search、Gemini Search／Maps grounding、OpenAI web search）；Verification 核實官方資料時用後端白名單 fetch。白名單放 repo 設定檔，只可以經 PR 改，AI 唔可以加網域。白名單 fetch 要防 SSRF：只限 https、解析 DNS 後擋私有 IP、唔跟去白名單以外嘅 redirect、限大小同時間。所有網頁內容當不可信資料，只可以變候選，要附來源網址。
- **安全關卡**：CI 必過先可以 merge：RLS 權限測試、gitleaks、依賴漏洞 high 以上、AI 輸出 schema 驗證、prompt injection 回歸測試集、SSRF 測試。每個 PR 另外跑 /security-review。
- **模組化**：模組化單體（一個 Next.js 專案，分 packages）。核心領域（狀態機、版本、批准）唔依賴任何外部服務；四類擴充點（AI provider、角色、資料源、地區 pack）用註冊表＋契約測試。
- **日後功能（預留擴充點，第一版唔做）**：預算同記帳（金額、幣別、分帳）、日曆／地圖匯出（ICS、地點清單）、推播同定位提醒（通知同位置事件介面）、訂票／訂位整合（匯入介面，自動建 Hard Constraint）。
- **驗收**：三層。① 自動測試（核心邏輯、RLS、契約測試，E2E 用錄製 AI 回應重播報告東京 Day 3 案例）；② AI 品質評估集（固定場景跑真 AI，硬性規則判定，每場景 5 次全過）；③ 真機（iPhone PWA 離線、定位、推播）標 TBD，等使用者親手測完先算 PASS。
- **維護**：系統維護只喺旅前手動做（行旅前維護 checklist：真 API 契約測試、AI 評估集、依賴更新、資料庫備份、模型下架檢查）。CI 安全關卡照舊喺每個 PR 跑。
- **旅前再核實**：屬產品功能，自動：T-7 同 T-1 自動跑 Verification，有問題標 At Risk 通知。

### Open Items
- 背景 job 技術（Vercel Workflow 或 Supabase Queues）：Task 1 spike 時決定。
- L1 自動壓縮緩衝之後，下一個 Hard Constraint 前最少要留幾多分鐘：實作前用模板 H 狀態表確認。
- 共用記憶限制衝突「取最保守值」嘅具體規則：實作前用模板 H 確認。
- OpenAI「Sign in with ChatGPT」interest form：使用者自己填。
- Claude plan 附送 Console API credit 係咪覆蓋 Agent SDK 以外嘅 API 調用：實作 AI 層前再查證。

### 2026-11-22 文件複核修正（使用者回覆「全部照建議改」）
- **背景 job 用 key（C-12）**：job 記錄發起人，只解密發起人嘅 key；T31 排程用 Owner 嘅 key，要 Owner 明確開啟。
- **敏感欄位**：由兩個開關改為三個（俾 AI、俾其他成員、俾 Viewer／唯讀連結），預設全關；Owner 同 Companion 都要跟當事人開關。
- **登入**：Google＋magic link 喺 T03 做；Apple 等有 Apple Developer Program 帳號先開。
- **RLS**：`trip_members` 同 RLS helper 喺 T03 建立；之後每張新表跟權限表寫 policy＋pgTAP。
- **維護補充**：旅行之間開住 Dependabot security alerts／updates（PR 由使用者 merge）；旅前維護第一步係 T-10 或之前確認 Supabase 專案冇暫停。
- **相片同 place_id**：AI 唔准輸出圖片網址；place_id 由伺服器用 Places 搜尋解析（S-16）。
- **狀態**：新增行程、每日、提案狀態（§2.8）同同步觸發事件表（§2.9），T07 前用模板 H 確認。
- **地圖**：第一版唔嵌地圖，用 Google Maps URLs 開 App 導航（D26）。

### 2026-11-22 審查報告高嚴重度決定
- **H-01 日本路線來源**：唔接任何路線 API。日本交通時間由 AI 依官方資料估算＋固定緩衝，全部標「估算」，附 Google Maps 連結俾使用者喺 App 確認。（已核實：Google Routes API 唔包括日本大眾運輸合作夥伴；NAVITIME RapidAPI 免費版每月 500 次且係估算時間；駅すぱあと API 係法人向）
- **H-02 可儲存資料來源**：名稱、地址、營業時間以 Verification 讀到嘅官方網站為準；座標用 Google 經緯度，最多存 30 日，到期自動重取（資料庫同離線包都要跟）。Google 只永久存 place_id；Google 名稱、相片、評分只喺有網時即時顯示。唔接 OpenStreetMap。
- **H-03 AI 輸入**：AI 只用自己上網搜尋到嘅資料填寫（位置、區域、交通估算、營業時間等）；prompt 唔含任何 Google Maps 內容，包括座標同由座標推算嘅分區結果。Google 座標只用喺伺服器畫面顯示（例如距離目前位置）同導航連結。品質靠嚴格 schema、輸入驗證同報錯（使用者原話：「只需要正確規範同埋輸入驗證及報錯就唔會有事，其他問題都係」）。
- **H-04 即時運行資訊**（按同一原則套用，未逐項再問）：ODPT 只接基本ライセンス同 CC 授權資料集（東京 Metro、都營等）；其他營運商（JR 東日本、私鐵）由 Verification 用白名單 fetch 讀官方運行情報頁，輸出經 schema 驗證；冇來源嘅路線顯示「無即時資料」。
- **補記（側邊對話已批准但漏記）**：D04 介面語言台灣繁體中文；D05 登入 Supabase Auth（Google、Email magic link，Apple 等有開發者帳號先開）。兩項喺側邊對話「PASS，寫文件」嗰張清單入面。
- **審查報告其餘中、低問題**：按報告第 9 節次序，喺對應 Task 開始前修正；M-08 Task 次序要喺 T01 前改。
- **M-08 Task 次序（使用者：「按你規劃改」）**：T02 同 T03 對調（CI 先、Supabase 後），CI 關卡由建立測試嘅 Task 逐個啟用；T08 同 T09 對調（批准規則先、applyChange 後），通知同未讀表放 T09；T11 加 `MemoryReader` 預設介面；T12 只做 key 儲存，測試呼叫分到 T13、T19、T22；T20 同 T22 對調（日本 RegionPack 先、ODPT 同天氣 adapter 後）；Backup 每區至少一個嘅檢查由 T26 搬去 T27。

### 2026-11-22 規格缺口第二批（使用者要求日後提問用書面中文並解釋英文術語）
- **M-02 核實門檻**：Verified 同 Partially Verified 可以入行程草案（Partially 喺 Card 標示）；Unverified 同 Conflict 唔可以。重新核實時項目由已核實返去待核實。
- **M-03 衝突處理**：事實資料（例如營業時間）按證據次序自動更正並記入 Change Log；影響已批准或已鎖定行程嘅時間或內容就標 At Risk 並出提案等批准。「差異重大」標準 T10 前用狀態表確認。
- **M-11 敏感欄位**：只有全名、電話、電郵；唔收護照同身分證號碼。使用者已確認健康、飲食、訂位代號、飯店確認碼、住宿地址、預算都唔算敏感（會俾 AI、所有成員同分享連結睇到），同行者健康限制自動合併入共同行程。取代之前「健康類記憶預設唔合併」。
- **M-12 權限**：照建議表補齊動作；同行者權限同建立者接近，只有旅前再核實排程限建立者；唯讀成員睇得到 Change Log；建立者要先轉移身分先可以退出。
- **M-04、M-06**（按審查建議直接寫入，冇另外提問）：新增 §2.10 衝突處理、§2.11 資料實體；新增 `packages/db`、port 定義（M-04）同套件依賴表（M-05）。
