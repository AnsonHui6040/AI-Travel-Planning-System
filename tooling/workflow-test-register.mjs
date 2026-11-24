// T24：在 workflow 測試 worker 註冊 workflow-test-loader.mjs（說明見該檔）
import { register } from "node:module";

register("./workflow-test-loader.mjs", import.meta.url);
