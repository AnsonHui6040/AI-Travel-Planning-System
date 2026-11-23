// T13：三家供應商的錄製回應（依官方 API 文件格式建立的合成資料，不含真實 key 或使用者資料）。
// 每一筆是一次 HTTP 回應：狀態碼、標頭與 JSON 內容。

export interface RecordedResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export const SAMPLE_OUTPUT = { candidates: [{ name: "淺草寺", reason: "早上人少" }] };
const OUTPUT_TEXT = JSON.stringify(SAMPLE_OUTPUT);
const CITED_URL = "https://www.senso-ji.jp/about/";

export const anthropicFixtures = {
  structured: {
    status: 200,
    headers: { "content-type": "application/json", "request-id": "req_fixture_1" },
    body: {
      id: "msg_fixture_1",
      type: "message",
      role: "assistant",
      model: "claude-fixture",
      content: [{ type: "text", text: OUTPUT_TEXT }],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 120, output_tokens: 40 },
    },
  },
  search: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: {
      id: "msg_fixture_2",
      type: "message",
      role: "assistant",
      model: "claude-fixture",
      content: [
        { type: "text", text: "我先查官方資訊。" },
        {
          type: "server_tool_use",
          id: "srvtoolu_fixture",
          name: "web_search",
          input: { query: "淺草寺 開放時間" },
        },
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_fixture",
          content: [
            {
              type: "web_search_result",
              url: CITED_URL,
              title: "淺草寺",
              encrypted_content: "fixture-encrypted",
              page_age: "2026-11-01",
            },
          ],
        },
        {
          type: "text",
          text: "淺草寺早上六點開門。",
          citations: [
            {
              type: "web_search_result_location",
              url: CITED_URL,
              title: "淺草寺",
              encrypted_index: "fixture-index",
              cited_text: "本堂 6:00 開堂",
            },
            {
              type: "web_search_result_location",
              url: "http://insecure.example.com/",
              title: "非 https 來源",
              encrypted_index: "fixture-index-2",
              cited_text: "x",
            },
          ],
        },
        { type: "text", text: "```json\n" + OUTPUT_TEXT + "\n```" },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 900, output_tokens: 80, server_tool_use: { web_search_requests: 1 } },
    },
  },
  refusal: {
    status: 200,
    body: {
      id: "msg_fixture_3",
      type: "message",
      role: "assistant",
      model: "claude-fixture",
      content: [{ type: "text", text: "I can't help with that." }],
      stop_reason: "refusal",
      stop_sequence: null,
      stop_details: { type: "refusal", category: null, explanation: null },
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  },
  models: {
    status: 200,
    body: { data: [{ type: "model", id: "claude-fixture", display_name: "Fixture", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: "claude-fixture", last_id: "claude-fixture" },
  },
  error: (status: number, type: string): RecordedResponse => ({
    status,
    headers: { "content-type": "application/json", "retry-after-ms": "1" },
    body: { type: "error", error: { type, message: "fixture error" } },
  }),
} satisfies Record<string, RecordedResponse | ((status: number, type: string) => RecordedResponse)>;

export const geminiFixtures = {
  structured: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: {
      candidates: [{ content: { role: "model", parts: [{ text: OUTPUT_TEXT }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 110, candidatesTokenCount: 35, totalTokenCount: 145 },
      modelVersion: "gemini-fixture",
    },
  },
  search: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: {
      candidates: [
        {
          content: { role: "model", parts: [{ text: OUTPUT_TEXT }] },
          finishReason: "STOP",
          index: 0,
          groundingMetadata: {
            webSearchQueries: ["淺草寺 開放時間"],
            groundingChunks: [{ web: { uri: CITED_URL, title: "senso-ji.jp" } }, { web: { uri: "http://insecure.example.com/", title: "x" } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 70, totalTokenCount: 870 },
      modelVersion: "gemini-fixture",
    },
  },
  refusal: {
    status: 200,
    body: {
      candidates: [{ finishReason: "SAFETY", index: 0 }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
    },
  },
  models: {
    status: 200,
    body: { models: [{ name: "models/gemini-fixture", displayName: "Fixture" }] },
  },
  error: (status: number, type: string): RecordedResponse => ({
    status,
    headers: { "content-type": "application/json" },
    body: { error: { code: status, message: "fixture error", status: type } },
  }),
} satisfies Record<string, RecordedResponse | ((status: number, type: string) => RecordedResponse)>;

const openaiResponse = (output: unknown[], usage = { input: 130, output: 45 }) => ({
  id: "resp_fixture",
  object: "response",
  created_at: 1795400000,
  status: "completed",
  model: "gpt-fixture",
  output,
  usage: {
    input_tokens: usage.input,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: usage.output,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: usage.input + usage.output,
  },
});

export const openaiFixtures = {
  structured: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: openaiResponse([
      {
        type: "message",
        id: "msg_fixture",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: OUTPUT_TEXT, annotations: [] }],
      },
    ]),
  },
  search: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: openaiResponse(
      [
        { type: "web_search_call", id: "ws_fixture", status: "completed", action: { type: "search", query: "淺草寺 開放時間" } },
        {
          type: "message",
          id: "msg_fixture",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: OUTPUT_TEXT,
              annotations: [
                { type: "url_citation", url: CITED_URL, title: "淺草寺", start_index: 0, end_index: 10 },
                { type: "url_citation", url: "http://insecure.example.com/", title: "x", start_index: 0, end_index: 1 },
              ],
            },
          ],
        },
      ],
      { input: 850, output: 75 },
    ),
  },
  refusal: {
    status: 200,
    body: openaiResponse([
      {
        type: "message",
        id: "msg_fixture",
        status: "completed",
        role: "assistant",
        content: [{ type: "refusal", refusal: "I can't help with that." }],
      },
    ]),
  },
  models: {
    status: 200,
    body: { object: "list", data: [{ id: "gpt-fixture", object: "model", created: 1795400000, owned_by: "openai" }] },
  },
  error: (status: number, type: string): RecordedResponse => ({
    status,
    headers: { "content-type": "application/json", "retry-after-ms": "1" },
    body: { error: { message: "fixture error", type, param: null, code: type } },
  }),
} satisfies Record<string, RecordedResponse | ((status: number, type: string) => RecordedResponse)>;

export const CITED = CITED_URL;
