# 實作計畫審查報告

| 項目 | 內容 |
|---|---|
| 審查對象 | `docs/implementation-plan.md`（564 行） |
| 對照資料 | `.claude/bee-context.local.md`、SOP 原始報告（全文與 4 張圖） |
| 審查日期 | 2026-11-22 |
| 外部來源取得日期 | 2026-11-22 |
| 問題總數 | 44（高 4、中 22、低 18） |

行號以 `L` 加數字表示，指 `docs/implementation-plan.md`。

## 1. 檢查項目總結

| # | 檢查項目 | 結果 | 問題編號 |
|---|---|---|---|
| 1 | SOP 覆蓋 | 8 個階段、3 張 Checklist、4 張圖的節點大部分有對應；6 個問題 | M-03、M-13、M-16、M-20、L-03、L-04 |
| 2 | 決定一致 | 27 條決定與 8 條複核修正全部有體現；3 個問題 | M-22、L-01、L-02 |
| 3 | 六個範疇加實作清單、驗收、維護 | 九項均未達可直接開工，缺口見第 3 節 | 見第 3 節 |
| 4 | 內部一致 | 編號引用與章節引用全部存在；15 個問題 | M-02、M-04–M-12、M-15、L-05、L-06、L-08、L-15 |
| 5 | 可行性 | 4 個高嚴重度問題，均在外部資料；另 9 個問題 | H-01–H-04、M-01、M-17–M-19、M-21、L-12、L-13、L-17、L-18 |
| 6 | 成品規範 | 樣本數標記 0、粵語字 0、分隔點與箭嘴 0；3 個問題 | L-09、L-10、L-11 |

其餘問題（M-14、L-07、L-14、L-16）屬程式安全與驗收細節，歸入第 3 節對應範疇。

## 2. 高嚴重度問題

### H-01 Google Routes API 不提供日本的大眾運輸路線

| 項目 | 內容 |
|---|---|
| 行號 | L27（D13）、L381（T19）、L394（T27）、L395（T28）、L397（T30 交通時間與首末班車） |
| 文件假設 | 日本優先的地點與路線全部由 Google Maps Platform 提供，T19 實作「Routes 大眾運輸路線」 |
| 證據 | Google Maps Platform FAQ「In which countries are transit directions available?」一條列明 Routes API 支援所有 Google Transit 合作夥伴，但日本的合作夥伴除外。Routes API 涵蓋範圍頁的日本一列只有開車、步行等項目，沒有大眾運輸 |
| 來源 | https://developers.google.com/maps/faq 、https://developers.google.com/maps/documentation/routes/coverage |
| 影響 | T27 以實際交通時間分群、T28 門到門比較、T30 首末班車核查、T36 至 T38 的最遲離開時間，在日本均無資料來源 |
| 建議 | D13 增列日本大眾運輸路線來源，並列入第 11 節待決定項目，於 T19 開始前以 spike 定案。可選方向：日本本地路線 API（需另查條款與費用）、以 ODPT 時刻表資料自行計算、或只以 Google Maps URLs 交由 Google Maps App 查詢並由使用者輸入時間。T27、T28、T30 的 PASS 標準隨定案結果改寫 |

### H-02 Google Maps 內容的儲存與快取範圍遠小於文件假設

| 項目 | 內容 |
|---|---|
| 行號 | L25（D11）、L88–L91（第 2.4 節位置、可使用日期與時段）、L381（T19「place_id 以外的內容依條款期限快取」）、L412（T35 離線包）、L444 與 L324（錄製回應契約測試）、L561（待決定項目） |
| 文件假設 | place_id 以外的 Google 內容可在某個期限內快取；離線包可保存預先計算的資料 |
| 證據 | Google Maps Platform Terms of Service 第 3.2.3 條 (a) 禁止預先擷取、索引、儲存 Google Maps Content，並以複製保存商家名稱、地址為例；(b) 禁止快取，除非 Service Specific Terms 明文允許。Service Specific Terms 總則第 3 條允許快取 place_id；第 14.3 條（Places API）與第 19.3 條（Routes API）只允許暫存經緯度最多連續 30 日，到期必須刪除。條款沒有給營業時間、名稱、地址、路線時間任何快取期限 |
| 來源 | https://cloud.google.com/maps-platform/terms 、https://cloud.google.com/maps-platform/terms/maps-service-terms 、https://developers.google.com/maps/documentation/places/web-service/policies |
| 影響 | 行程項目若把 Places 回傳的名稱、地址、營業時間或 Routes 回傳的交通時間寫入資料庫或離線包，即超出條款。旅前規劃通常超過 30 日，經緯度亦需到期重取。把真實 Google API 回應錄製成測試 fixture 存入 repo 同樣屬於儲存 |
| 建議 | 1. 第 2.4 節每個欄位標明資料來源類別：使用者輸入、AI 研究（網頁）、Google（只存 place_id；經緯度附取得時間並於 30 日內刪除或重取）。2. 名稱、營業時間、休館日改以 Verification 取得的官方網站資料為準，Google 內容只作即時顯示與比對。3. T19 的 PASS 改為「資料庫與離線包除 place_id 及未逾 30 日的經緯度外沒有任何 Google 內容」。4. 契約測試 fixture 改用合成資料。5. L561 的待決定項目改為「Google 以外的離線資料來源」 |

### H-03 把 Google Maps 內容送入非 Google 的 LLM 產生行程，條款上有禁止風險

| 項目 | 內容 |
|---|---|
| 行號 | L243（S-04：Transport 使用路線 adapter；伺服器先取得即時資料再傳入 Master Planner 與 Live Planner）、L395（T28）、L415（T38） |
| 文件假設 | 伺服器取得的 Google 地點與路線資料可放入 Claude、OpenAI 的 prompt，由 AI 產生比較與行程提案 |
| 證據 | Terms of Service 第 3.2.3 條 (c) 禁止以 Google Maps Content 為基礎建立內容。Service Specific Terms 第 10 條（Maps Experience Agent Tools）以「有限例外」形式，允許經該工具把 Google Maps Content 與 LLM 輸出結合後顯示，條件包括附上 Google Maps 來源連結。由此推論，例外以外的途徑不在允許範圍 |
| 來源 | https://cloud.google.com/maps-platform/terms 、https://cloud.google.com/maps-platform/terms/maps-service-terms |
| 核實狀態 | 條款原文已核實；「把 Places 與 Routes 回應放入第三方 LLM prompt」是否屬於第 3.2.3 條 (c) 的禁止範圍為條文解讀，未核實，需向 Google 或法律意見確認 |
| 建議 | 列入第 11 節待決定項目並於 T19 開始前定案。可選方向：1. 交通比較、最遲離開時間、分群全部改為伺服器端決定性計算，AI 只接收不含 Google 內容的結果代號。2. 需要 AI 讀取地圖內容的角色改用 Google 提供的 grounding 工具，並接受該角色只能使用 Gemini。3. 路線與地點事實改用 Google 以外的來源 |

### H-04 ODPT 列車運行資訊的授權與覆蓋不足以支撐「日本交通營運資訊」

| 項目 | 內容 |
|---|---|
| 行號 | L27（D13）、L153（鐵路局部停駛）、L382（T20）、L413（T36 交通）、L414（T37 即時交通） |
| 文件假設 | ODPT 可提供日本列車營運狀態 |
| 證據 | ODPT 開發者網站的規約頁列出三類授權：CC 類授權、公共交通オープンデータ基本ライセンス（營利與非營利均可，需註冊）、公共交通オープンデータチャレンジ限定ライセンス（以參加挑戰賽為前提）。資料目錄中，東京メトロ運行情報為基本ライセンス，東京都交通局運行情報為 CC BY 4.0；JR 東日本（JR東日本アイステイションズ提供）、京急電鐵、東急電鐵、西武鐵道的運行情報標示為「チャレンジ2026限定」。運行情報共 58 個資料集，搜尋結果首 12 筆全為首都圈營運商，其餘地區未逐一核對 |
| 來源 | https://developer.odpt.org/terms 、https://developer.odpt.org/terms/data_basic_license.html 、https://developer.odpt.org/challenge_license 、https://ckan.odpt.org/dataset?q=運行情報 |
| 影響 | 本專案不是挑戰賽作品，JR 東日本各線的運行情報不可使用；首都圈以外的覆蓋未核實。Incident 分級 L3「鐵路中斷」與旅前再核實的交通項目在大部分路線沒有資料 |
| 建議 | 1. D13 寫明第一版可用範圍（基本ライセンス與 CC BY 的營運商清單）。2. 其餘營運商改由 Verification 以白名單 fetch 讀取營運商官方運行情報頁，白名單由日本 `RegionPack` 提供。3. T20 的 PASS 加入「只接入基本ライセンス或 CC 授權的資料集」的檢查。4. 沒有資料來源的路線在畫面標示「無即時資料」，不得顯示為正常 |

## 3. 九個範疇是否足夠開工

| 範疇 | 判斷 | 缺少的內容 | 問題編號 |
|---|---|---|---|
| 模組化 | 不足 | 資料存取層的位置與 port；套件之間完整的允許依賴方向；資料模型（實體清單與欄位來源） | M-04、M-06 |
| 連接安全 | 不足 | C-01、C-11 沒有 Task；magic link 寄信條件；Realtime、Storage、邀請 token、排程端點沒有規則 | M-01、M-07、L-14 |
| 記憶 | 不足 | 記憶進入下一趟規劃的規則與測試；T41 一個 Task 涵蓋 11 條規則但只有 3 個測試 | M-09、M-20 |
| 日後新增功能 | 大致足夠 | 提案、離線包、AI 輸出的 schema 版本欄位與相容規則未定 | L-16 |
| 分享 | 不足 | 權限表缺列；敏感欄位清單；角色模型設定屬於個人或行程 | M-11、M-12、M-13 |
| 程式安全 | 不足 | S-08、S-11 沒有 Task；CI 內 prompt injection 測試的性質；S-03 與自動核實互相矛盾；SSRF 清單不完整 | M-07、M-14、M-15、L-07 |
| 實作清單 | 不足 | Task 次序 7 處倒置；旅前修改與 Major 變更流程、維護工具、正式環境建立沒有 Task | M-08、M-16、M-17 |
| 驗收 | 不足 | 14 個 Task 的 PASS 標準不可量度或覆蓋不足；E1 判定與 T38 衝突；E7、R7–R9 沒有 Task | M-07、M-09、M-10 |
| 維護 | 不足 | 備份方法與範圍；成員 API key 檢查與 C-02 衝突；旅程期間部署凍結與回復；外部資料的顯示義務 | M-17、M-19、L-13 |

## 4. 中嚴重度問題

| 編號 | 行號 | 問題與證據 | 建議改法 |
|---|---|---|---|
| M-01 | L19、L349、L404 | D05 的 Email magic link 在正式環境無法寄給同行者。Supabase 內建 SMTP 只寄給專案所屬組織的成員，目前上限為每小時 2 封，官方說明不供正式使用。T02 的 PASS 在本機環境會通過，正式環境會失敗。來源：https://supabase.com/docs/guides/auth/auth-smtp | T02 加入自訂 SMTP 設定，PASS 加上「非組織成員的信箱在正式專案收到 magic link」；SMTP 供應商列入第 11 節 |
| M-02 | L100–L114、L207 | 生命週期的「已核實」與四種核實狀態的關係沒有定義：Partially Verified、Unverified 的項目能否進入行程草案未寫明，D07 使同一家設定的項目最高只到 Partially Verified。第 2.9 節把項目改為 Unverified 並重新核實，但狀態表沒有「已核實」回到「待核實」的轉換 | 第 2.5 節增加一張對照表：每種核實狀態可停留的生命週期狀態；寫明 Partially Verified 可否進入草案；補上重新核實時的生命週期轉換 |
| M-03 | L362、L124–L132 | SOP 衝突處理流程圖沒有成文規則，T10 只列四個判斷點。圖中「比較旅行目標」、「時間、成本、體驗、風險」、「Master Planner 選擇」、「採用較可靠資料」四個節點沒有對應；後兩者會在沒有使用者批准下更新已批准行程，與 D10 衝突。「差異是否重大」沒有門檻，也不在第 11 節。批准表沒有「非 Incident 的 Minor 變更」一列 | 新增一節寫出流程每個分支的結果（自動、提案待批准、保留在候選）；寫明 D10 之下兩個自動分支一律轉為提案；重大門檻列入第 11 節；批准表補 Minor 一列 |
| M-04 | L86–L94、L358、L391、L393、L395、L396 | 資料模型不完整。T24 要求的推薦原因、地區、限制在第 2.4 節沒有欄位；證據順序需要的來源等級、T26 的八個篩選維度、T29 Card 的排定時段與可移動範圍均沒有欄位。Mobility Segment、每日時段、Trip Baseline、Incident、Snapshot、Actual Timeline、通知沒有資料單位定義，T06 只涵蓋第 2.4 節 | 第 2 節增加實體清單與各實體欄位；T06 的範圍改為全部實體，或在各 Task 內容列明其建立的資料表 |
| M-05 | L116、L243–L244、L362、L392 | 證據順序無法執行：沒有定義由誰判定某來源屬於設施官方資訊，來源欄位只有網址與取得時間。白名單只能經 PR 修改，個別餐廳與景點的官方網域不會預先在白名單內，Verification 如何取得最高等級證據沒有寫明 | 寫明來源等級的判定方式（白名單網域為官方交通與旅遊局；設施官方網域由 place_id 對應的網站欄位或使用者確認）；來源增加等級欄位；寫明白名單以外的設施官方網站以何種工具讀取 |
| M-06 | L68、L70、L240、L360、L49–L61 | M-01 規定 `packages/core` 不得 import 外部 SDK，但 `applyChange` 需要寫入資料庫；第 2.1 節沒有資料存取套件，也沒有 repository port 的定義。M-03 要求檢查依賴方向，但只有 M-01 定義了方向，其餘 8 個套件之間的允許關係未列 | 增加一條規則定義 port 與其實作位置；列出全部套件的允許依賴矩陣，作為 dependency-cruiser 設定的依據 |
| M-07 | L221、L231、L247、L250、L462、L475–L477 | 沒有 Task 對應的規則：C-01、C-11（Origin 驗證與速率限制，後者在 serverless 需要共用儲存）、S-08（CSP、HSTS、sanitize）、S-11。沒有 Task 對應的驗收項目：E7、R7、R8、R9 | C-11、S-08 各立一個 Task 或併入 T02、T03；S-11 併入 T01；C-01 併入 T12 與 T19；E7 掛 T18，R9 掛 T19，R7 掛 T29 與 T38，R8 掛最後一個 Task |
| M-08 | L337、L348–L350、L360–L361、L363、L369–L370、L382、L384、L393–L394、L398、L406 | Task 次序倒置 7 處：1. 第 8.1 節第 4 點要求 S-14 關卡全過，但 T01、T02 在建立 CI 的 T03 之前；T03 要執行的 RLS、SSRF、injection、schema 測試在 T02、T14、T16、T18 才出現。2. T12 的儲存前測試呼叫需要 T13、T19、T20 的 adapter。3. T26 的 PASS 用到 T27 才產生的區域。4. T20 使用 `RegionPack` 的來源設定，T22 在其後；T11 與 T22 都建立 `RegionPack` 機制。5. T31 的未讀通知依賴 T34。6. T08 的 `applyChange` 依批准規則寫入，批准規則在 T09。7. T14 的記憶範圍與 T23–T30 的規劃在記憶（T41）之前 | 1. T03 移至 T01 之後，S-14 各關卡在對應測試出現時才加入並在 T03 留空位。2. T12 拆為儲存與遮罩（前）、測試呼叫（T13、T19、T20 完成後）。3. T26 的 Backup 檢查移至 T27。4. T22 移至 T20 之前，T11 只建立註冊表。5. 未讀通知的資料表移至 T08 或 T31。6. T09 移至 T08 之前或合併。7. 記憶的讀取介面在 T14 之前建立 |
| M-09 | L362、L370、L371、L374、L382、L390、L393、L394、L396、L413、L414、L422、L423、L416 | PASS 標準不可量度或覆蓋不足：T10（分支未定義）、T13（C-07 的逾時與退避沒有測試）、T14（沒有 token 上限、工具權限、用量顯示）、T17（沒有加密與 log 遮罩）、T20（沒有天氣警報）、T23 與 T29（「UI 截圖」沒有判定條件）、T26（沒有八個維度）、T27（措辭無法判定）、T36（10 個檢查項目與 Day Ready 否決沒有確定性測試）、T37（「偏差」未定義）、T39（只有一個測試）、T40（「欄位齊全」未列欄位）、T41（11 條規則 3 個測試） | 每個 PASS 改為可執行的斷言清單；每條對應規則至少一個測試名稱；UI 項目寫明截圖須顯示的元素 |
| M-10 | L415、L456、L163–L164 | E1 的硬性判定「Day 4、Day 5 無變更」與 T38 允許「使用另一日候選」的方案互相衝突，SOP 案例的方案 C 即改動其他日期。跨日移動單一景點不符合 Major 或 Minor 任何一項定義 | E1 改為「套用使用者選定方案後，未被選定方案涉及的日期無變更；涉及其他日期的方案在比較表標示」；第 2.7 節補上跨日移動的分類 |
| M-11 | L32、L246、L302、L374 | 敏感欄位清單沒有定義，D18、S-07、T17 都以其為前提。不在第 11 節 | 列出敏感欄位（健康與體力限制、飲食限制、年齡、預算、航班與訂位編號、住宿地址等）及各自預設；或列入第 11 節並註明 T17 開始前定案 |
| M-12 | L292–L300、L232、L271 | 權限表缺少動作：手動提出修改、否決提案、編輯基線、開啟旅前再核實排程（C-12 只限 Owner）、觸發 Morning Check 與 Incident Mode、成員自行離開（MEM-09 提及）、上傳照片、檢視 Change Log。T02 與 T32 的 PASS 以「權限表每一格」為準，表不完整則 RLS 不完整 | 權限表補齊上述各列 |
| M-13 | L243、L371、L391 | T14 為「五個 `RoleSpec`」，T24 有 Research A 至 D 四個研究角色。四者是否各自選擇模型沒有寫明；若共用一個模型，SOP 的多 AI 獨立研究變成同一模型的四個提示。決定紀錄「切換備援後與 Research 同一家時套用上限」沒有規則與測試 | 寫明 Research A 至 D 是否為獨立的模型設定欄位；D07 的判定以項目的產生者與核實者為準並寫入第 2.5 節；T14 的 PASS 加入備援切換後的上限測試 |
| M-14 | L253、L372、L375、L445、L462 | S-14 把 prompt injection 回歸測試集列為 CI 必過關卡，但 CI 以錄製回應執行，無法驗證模型行為；T18 的 PASS 沒有區分。AI 評估集以真 AI 執行時使用誰的 API key、在何處執行沒有定義 | 寫明 CI 內的測試為確定性測試（以惡意模型輸出為輸入，驗證伺服器不寫入、不洩漏），模型行為由 E7 驗證；寫明評估集的執行環境與 key 來源 |
| M-15 | L242、L126–L128、L207、L398 | S-03 規定網頁與搜尋結果只可產生候選，但 Verification 以網頁內容自動更新核實狀態與 At Risk 標記（批准表列為自動）。被注入的網頁可造成大量 At Risk 或誤標為 Verified | S-03 改為「只可產生候選與核實結果」；核實結果須附來源等級；同一來源一次觸發的 At Risk 數量設上限並記錄 |
| M-16 | L132、L209、L415、L416、L457、L463 | 鎖定後的旅前修改與 Major 變更分析沒有 Task：E8（航班改一天）掛在 T38，但 T38 的內容為 Incident Mode。空檔加入候選（E2）與活動完成的輸入方式（Actual Timeline 的資料來源）在任何 Task 的內容都沒有出現 | 新增一個 Task 處理鎖定後變更（使用者提出、Major 分析、重算管線）；T38 或 T39 補上空檔提示與活動完成打卡 |
| M-17 | L492–L505、L222 | 維護方法所需的工具沒有 Task：備份與還原、真 API 契約測試模式、白名單連線檢查、線上 build 時間顯示、正式環境的 Vercel 與 Supabase 建立。備份方法未寫；Supabase 文件說明資料庫備份不包含 Storage 物件，並建議 Free 方案以 CLI `db dump` 定期匯出。「每位成員的 key 執行測試呼叫」與 C-02 只容許 key 擁有者本人解密互相衝突。來源：https://supabase.com/docs/guides/platform/backups 、https://supabase.com/docs/guides/database/vault | 新增維護工具 Task；備份一列寫明方法與範圍（資料庫、Storage、Vault root key）；API key 一列改為各成員自行執行並回報 |
| M-18 | L17、L352、L398 | T05 的比較準則缺少兩項：Docker 自架環境能否運作（D03），以及排程能力（T31）。已核實：Vercel Hobby 的 cron 每日最多一次，觸發時間誤差可達 59 分鐘；函式最長 300 秒；Vercel Workflows 可經 Postgres World 在其他基礎設施執行。來源：https://vercel.com/docs/cron-jobs/usage-and-pricing 、https://vercel.com/docs/functions/limitations 、https://vercel.com/docs/workflows 、https://supabase.com/docs/guides/queues | T05 的比較準則加入自架可攜性、排程、單次執行上限；T31 寫明以目的地時區計算 T-7 與 T-1，並容許每日一次的排程精度 |
| M-19 | L27、L382、L412、L496、L522 | 外部資料的顯示義務沒有規則。ODPT 開發者指引要求顯示動態資料的產生時間、依指定間隔更新、不顯示已過期的動態資料，並標示資料來源、不保證正確及開發者聯絡方式；與離線包保存交通狀態及 L522「顯示最後核實時間」衝突。Open-Meteo 免費版需依 CC BY 4.0 標示，限流依 IP 計算，條款指出經 Vercel 等平台可能提早被限流。ODPT 的 key 需每位使用者自行註冊開發者帳號。來源：https://developer.odpt.org/terms/data_basic_use_guideline.html 、https://open-meteo.com/en/terms | 新增一條規則列出各資料源的標示與時效要求；離線包不含 ODPT 動態資料或只顯示產生時間並標示已過期；Open-Meteo 的限流寫入 C-07 與第 10.4 節 |
| M-20 | L263–L273、L390、L423 | SOP 閉環圖的「個人旅行規則進入下一次旅行基線」沒有規則或測試：T23 沒有載入個人偏好與 Planning Rules 的步驟，T41 的 PASS 沒有「上一趟批准的規則影響下一趟規劃」的測試 | 第 5 節加一條規則說明記憶在哪些階段、以何種形式進入 prompt；T41 拆為儲存與批准、合併、進入規劃三個 Task，各有 PASS |
| M-21 | L76、L241、L370 | 「內建搜尋加結構化輸出」在同一請求的可行性三家不一致。Claude：結構化輸出與 citations 不相容並回傳 400，而 web search 的 citations 固定開啟，兩者同一請求並用未有文件明示，未核實。Gemini：結構化輸出與內建工具並用為預覽功能，限 Gemini 3 系列（經 gemini-docs 文件伺服器取得 structured-output 指南）。OpenAI：web search 文件頁沒有提及與結構化輸出並用，未核實。T13 的 PASS 只用錄製回應，無法發現此問題。來源：https://platform.claude.com/docs/en/build-with-claude/structured-outputs 、https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool 、https://ai.google.dev/gemini-api/docs/structured-output 、https://developers.openai.com/api/docs/guides/tools-web-search | `ProviderAdapter` 契約容許「先搜尋、後結構化」兩步驟；T13 的 PASS 加入三家各一次真 API 冒煙測試；三家對搜尋結果的引用顯示要求於 T13 開始前查證並列入第 10.6 節 |
| M-22 | L27、L382、L413 | T20 的「日本官方天氣警報來源」沒有指名，不在 D13，決定紀錄只批准 Open-Meteo。該來源的 API 與條款未核實 | 指名來源並補入 D13 與決定紀錄；條款於 T20 開始前查證，列入第 11 節 |

## 5. 低嚴重度問題

| 編號 | 行號 | 問題與證據 | 建議改法 |
|---|---|---|---|
| L-01 | L80、L363、L315、L444、L467–L477 | 與決定紀錄有出入：擴充點紀錄為四類，文件為五個註冊表；F-04 為「經批准才寫入」，紀錄為自動建立 Hard Constraint；紀錄的真機驗收包含推播，R1–R9 沒有推播項目而 F-03 為預留；E2E 紀錄為東京 Day 3，文件為五日全程 | 逐項向使用者確認後，同步更新文件與決定紀錄 |
| L-02 | L18、L271–L273、L298–L300、L314、L316、L427–L434 | 文件內有決定紀錄沒有記載的新決定：D04 介面語言、F-05 feature flag、F-03 只在 Incident Mode 取得一次位置、MEM-09 至 MEM-11、權限表中 Owner 專屬動作、Phase 8 各項 | 補入決定紀錄，或向使用者確認 |
| L-03 | L204–L213 | SOP 階段一的同步觸發點包含同行者與旅行日期改變，第 2.9 節沒有這兩個事件 | 第 2.9 節補上兩列 |
| L-04 | L393、L397、L415 | 旅前 Checklist 的 18 項沒有彙整成鎖定前的關卡；「戶外活動已有 Backup」與「機場及轉飯店日的行李處理」只有間接對應。現場變動 Checklist 的 Available Window 不在 T38 的 Snapshot 清單 | T30 的 PASS 加入 18 項關卡檢查；T38 的 Snapshot 補上可用時間 |
| L-05 | L128、L207 | 事實失效的對象用詞不一：第 2.6 節為「已批准項目」，第 2.9 節只對「已鎖定項目」標示 At Risk | 統一為「已批准與已鎖定」 |
| L-06 | L110、L118 | 旅後狀態 Skipped、Revisit、Not Recommended 與生命週期終止狀態的關係未定義 | 寫明旅後狀態為獨立欄位，或補上轉換 |
| L-07 | L244、L373 | SSRF 規則與測試未涵蓋：IPv4-mapped IPv6、0.0.0.0、172.16.0.0/12、192.168.0.0/16、100.64.0.0/10、連線時固定使用已檢查的 IP、連接埠限制 | S-05 與 T16 補上 |
| L-08 | L84–L213、L450 | 第 9.2 節要求每個規則編號有對應，但第 2.4 至 2.9 節的表格沒有編號 | 各表加上編號 |
| L-09 | L21 與 L114；L31、L225、L283；L32 與 L302；L200 與 L284；L228 與 L521；L286、L398、L515 | 同一條規則在多處重複敘述，修改時容易不一致。文件沒有重複使用的統計數據 | 保留一處為準，其餘改為引用編號 |
| L-10 | L38、L340、L446、L465；L90；L227、L228、L370 與 L231；L244；L397 | 用字：「真機」台灣慣用「實機」；「優先級」台灣慣用「優先順序」；「限流」與「速率限制」並用；「鏈路本地」台灣慣用「連結本機」；「回流測試」語意不清 | 統一用字 |
| L-11 | L434 | 括號內的「Hobby 方案只限個人非商業使用」屬理由說明。該限制已核實，來源：https://vercel.com/legal/terms | 刪去括號內容 |
| L-12 | L536–L546 | 外部條款清單缺少本報告引用的條款：Google Maps Platform Terms of Service、Places API policies、ODPT 基本ライセンス與開發者指引、Supabase SMTP 與暫停政策、三家 AI 的搜尋工具文件。現有 9 個連結全部回應 200 | 補入清單 |
| L-13 | L494、L507–L511 | 旅行之間的資料保存沒有規則。已核實：Supabase Free 專案 7 日低活動即暫停，暫停後 1 年內可在控制台還原，逾期只能下載備份。沒有旅後備份、旅程期間部署凍結、部署回復的規則；Dependabot PR 合併後是否自動部署未寫明。來源：https://supabase.com/docs/guides/platform/free-project-pausing | 第 10.2 節加入旅後備份與每年至少還原一次；第 10.4 節加入部署凍結與回復 |
| L-14 | L286、L383、L398、L404 | 沒有規則涵蓋：Realtime 頻道授權、Storage bucket 存取政策、邀請 token 的到期與單次使用、排程端點的來源驗證 | 第 3 節補上四條規則 |
| L-15 | L334、L415、L423、L391–L397 | T38、T41 的範圍遠大於一個 PR；SOP 要求不得跳過中間階段，T24 至 T30 沒有階段次序的測試 | 拆分 Task；加入階段閘門測試 |
| L-16 | L454–L463、L444、L322–L326 | 評估集沒有涵蓋旅後記憶提案、交通比較、以真 AI 產生的研究必填欄位；第 9.1 節的全程 E2E 沒有 Task 建立；schema 版本欄位未定 | 增加評估場景；指定建立 E2E 的 Task；提案與離線包加入 schema 版本 |
| L-17 | L395 | T28 的計程車與叫車價格、舒適度、延誤風險沒有資料來源。Routes API 的大眾運輸票價只在能判定全部路段時提供；計程車費用來源未核實。來源：https://developers.google.com/maps/documentation/routes/transit-route | 寫明各比較欄位的來源，沒有來源的欄位標示為估算 |
| L-18 | L222、L369 | C-02 的隔離需自行實作。已核實：Vault 以加密形式儲存，經 `vault.decrypted_secrets` view 解密，存取控制依 SQL 權限，文件提醒能讀取該 view 即可取得明文；service role 繞過 RLS。來源：https://supabase.com/docs/guides/database/vault 、https://supabase.com/docs/guides/database/postgres/row-level-security | T12 寫明以 security definer 函式比對擁有者後才解密，並撤銷其他角色對 view 的權限；PASS 加入權限檢查 |

## 6. SOP 覆蓋對照

| SOP 內容 | 對應 | 結果 |
|---|---|---|
| 四條最高原則 | S-01、第 2.6 節、第 2.4 節、T38 | 有對應 |
| 角色表 6 個角色 | S-04、T14 | 有對應；Master Planner「不可把未核實資料當成已確認」見 M-02 |
| 生命週期圖 11 個狀態與 13 條轉換 | 第 2.5 節 | 完全一致 |
| 景點資料單位 15 個欄位 | 第 2.4 節 | 全部有對應 |
| 旅前 8 個階段 | T23 至 T30 | 逐一對應；階段一同步觸發點見 L-03 |
| 完整循環圖 22 個節點 | T23 至 T41 | 全部有對應；回流至地理分區見 T30 |
| 同步觸發 8 個事件 | 第 2.9 節 | 全部有對應 |
| 版本格式與 7 項紀錄 | 第 2.7 節 | 全部有對應 |
| 衝突處理圖 12 個節點 | T10 | 4 個節點沒有對應，見 M-03 |
| 重算範圍 9 列 | 第 2.6 節 | 全部有對應 |
| Morning Check、離開前檢查 | T36、T37 | 全部有對應 |
| Incident 分級、Snapshot 9 項、替代方案次序、比較表 | 第 2.6 節、T38 | 全部有對應 |
| 東京案例 | E1、E2、E3 | 有對應；判定衝突見 M-10 |
| 旅前 Checklist 18 項 | T23 至 T30 | 16 項有直接對應，2 項間接，見 L-04 |
| 每日出發 Checklist 10 項 | T36 | 全部有對應 |
| 現場變動 Checklist 15 項 | T38 | 14 項有對應，Available Window 見 L-04 |
| 旅後循環 5 個狀態與 6 項比較 | 第 2.5 節、MEM-04、T40 | 全部有對應 |
| 閉環圖 10 個節點 | T23 至 T41 | 「個人旅行規則進入下一次基線」沒有對應，見 M-20 |

## 7. 編號與引用檢查

| 檢查 | 結果 |
|---|---|
| C、S、M、MEM、SH、F、D、T、E、R 共 139 個編號的定義 | 沒有重複或缺號 |
| 引用到不存在的編號 | 0 |
| 「第 X 節」引用 29 處 | 全部存在 |
| 沒有被任何 Task 引用的規則 | C-01、C-11、S-08、S-11（見 M-07） |
| 沒有被任何 Task 引用的驗收項目 | E7、R7、R8、R9（見 M-07） |
| `grep -E '[nN]\s*=\s*[0-9]'` | 0 |
| 粵語字 | 0 |
| 分隔點與箭嘴 | 0 |

## 8. 可行性核實結果

| 假設 | 結論 | 狀態 | 來源 |
|---|---|---|---|
| Supabase Vault 可加密儲存 BYOK | 可行；每專案一把金鑰，隔離需自行以 SQL 權限實作 | 已核實 | https://supabase.com/docs/guides/database/vault |
| RLS 可限制瀏覽器端存取，service role 只在伺服器 | 可行；service role 繞過 RLS，view 預設繞過 RLS | 已核實 | https://supabase.com/docs/guides/database/postgres/row-level-security |
| `supabase test db` 與 pgTAP 測試 RLS | 可行 | 已核實 | https://supabase.com/docs/guides/local-development/testing/overview |
| Supabase Free 暫停與還原 | 7 日低活動暫停；1 年內可還原 | 已核實 | https://supabase.com/docs/guides/platform/free-project-pausing |
| Supabase magic link 寄信 | 內建 SMTP 不可用於同行者 | 已核實 | https://supabase.com/docs/guides/auth/auth-smtp |
| Supabase 備份 | 資料庫備份不含 Storage；Free 方案建議自行 `db dump` | 已核實 | https://supabase.com/docs/guides/platform/backups |
| Supabase Queues | 以 pgmq 為基礎的 Postgres 佇列 | 已核實 | https://supabase.com/docs/guides/queues |
| Vercel 背景工作 | Hobby：cron 每日一次、函式最長 300 秒；Workflows 可長時間執行並可在其他基礎設施執行 | 已核實 | https://vercel.com/docs/cron-jobs/usage-and-pricing 、https://vercel.com/docs/functions/limitations 、https://vercel.com/docs/workflows |
| Vercel Workflows 在 Hobby 方案的用量上限 | 未查到 | 未核實 | — |
| Vercel Hobby 只限個人或非商業使用 | 屬實 | 已核實 | https://vercel.com/legal/terms |
| Google place_id 可永久儲存 | 屬實 | 已核實 | https://cloud.google.com/maps-platform/terms/maps-service-terms |
| Google 其他內容可依期限快取 | 只有經緯度 30 日 | 已核實，見 H-02 | 同上 |
| Places 內容可不搭配地圖顯示 | 可以；不得搭配非 Google 地圖；需 Google Maps 標示，照片需作者標示與原始連結 | 已核實 | https://developers.google.com/maps/documentation/places/web-service/policies |
| Routes API 提供日本大眾運輸 | 不提供 | 已核實，見 H-01 | https://developers.google.com/maps/faq |
| Google 內容可送入第三方 LLM | 條款有禁止風險 | 條款已核實，適用範圍未核實，見 H-03 | https://cloud.google.com/maps-platform/terms |
| Google Maps URLs 不需 API key，支援 `destination_place_id` 與 `travelmode` | 屬實 | 已核實 | https://developers.google.com/maps/documentation/urls/get-started |
| ODPT 提供日本列車營運資訊 | 只有部分首都圈營運商可用 | 已核實，見 H-04 | https://developer.odpt.org/terms 、https://ckan.odpt.org/dataset?q=運行情報 |
| Open-Meteo 可供第一版使用 | 非商業免費；需 CC BY 4.0 標示；每日 10,000 次、每小時 5,000 次、每分鐘 600 次 | 已核實 | https://open-meteo.com/en/terms |
| 日本官方天氣警報來源 | 文件未指名來源 | 未核實，見 M-22 | — |
| Claude 內建搜尋 | 有，支援網域白名單與次數上限 | 已核實 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool |
| Claude 結構化輸出 | 有；與 citations 不相容 | 已核實；與搜尋同一請求並用未核實 | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| Gemini 內建搜尋加結構化輸出 | 預覽功能，限 Gemini 3 系列 | 已核實 | https://ai.google.dev/gemini-api/docs/structured-output |
| OpenAI 內建搜尋 | 有，Responses API 支援網域過濾 | 已核實；與結構化輸出並用未核實 | https://developers.openai.com/api/docs/guides/tools-web-search |
| 三家對搜尋結果的顯示要求 | 未查 | 未核實 | — |
| 第 10.6 節 9 個連結 | 全部回應 200 | 已核實 | 見 `docs/implementation-plan.md` L538–L546 |

## 9. 建議處理次序

1. H-01 至 H-04：四項均改變 D13 與第 2.4 節，需使用者決定方向後才可進入 Phase 3；Phase 0 至 Phase 2 不受影響。
2. M-02、M-03、M-04、M-06、M-11、M-12：屬規格缺口，T06 至 T10 開始前補齊。
3. M-08：調整 Task 次序，T01 開始前完成。
4. 其餘中、低問題：隨對應 Task 開始前修正。
