import type { AiProvider, KeyTester, ProviderAdapter, Registry } from "@atps/core";
import { createAnthropicAdapter, createAnthropicKeyTester, listAnthropicModels } from "./anthropic";
import { createGeminiAdapter, createGeminiKeyTester, listGeminiModels } from "./gemini";
import { createOpenAIAdapter, createOpenAIKeyTester, listOpenAIModels } from "./openai";
import { createProviderRegistry } from "./registries";
import type { ProviderOptions } from "./shared";

export { createCredentialRegistry, createProviderRegistry, createRoleRegistry, type CredentialRegistry } from "./registries";

// T13：三家 provider adapter 與儲存前測試呼叫
export { createAnthropicAdapter, createAnthropicKeyTester } from "./anthropic";
export { createGeminiAdapter, createGeminiKeyTester } from "./gemini";
export { createOpenAIAdapter, createOpenAIKeyTester } from "./openai";
export { ProviderError, classifyProviderError } from "./errors";
export { extractJson, stripInjectedNulls, toProviderSchema, type SchemaDialect } from "./schema";
export type { ProviderOptions } from "./shared";

// T14：五個 RoleSpec
export { defaultRoles, roleSpec } from "./roles";

export function defaultProviders(options: ProviderOptions = {}): Registry<ProviderAdapter> {
  const registry = createProviderRegistry();
  registry.register(createAnthropicAdapter(options));
  registry.register(createGeminiAdapter(options));
  registry.register(createOpenAIAdapter(options));
  return registry;
}

export function defaultKeyTesters(options: ProviderOptions = {}): KeyTester[] {
  return [createAnthropicKeyTester(options), createGeminiKeyTester(options), createOpenAIKeyTester(options)];
}

// 角色設定使用的供應商代碼（aiProvider）與 adapter id 對照
const ADAPTER_IDS: Record<AiProvider, string> = { anthropic: "anthropic", google: "gemini", openai: "openai" };

export function adapterFor(registry: Registry<ProviderAdapter>, provider: AiProvider): ProviderAdapter {
  return registry.require(ADAPTER_IDS[provider]);
}

// 決策 0006：以使用者本人的 key 列出可用模型
export async function listModels(provider: AiProvider, apiKey: string, options: ProviderOptions = {}): Promise<string[]> {
  switch (provider) {
    case "anthropic":
      return listAnthropicModels(apiKey, options);
    case "google":
      return listGeminiModels(apiKey, options);
    case "openai":
      return listOpenAIModels(apiKey, options);
  }
}
