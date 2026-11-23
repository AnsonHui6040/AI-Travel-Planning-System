import {
  checkCredentialProvider,
  checkProviderAdapter,
  checkRoleSpec,
  createRegistry,
  type CredentialProvider,
  type KeyTester,
  type ProviderAdapter,
  type Registry,
  type RoleSpec,
} from "@atps/core";
import { createAnthropicAdapter, createAnthropicKeyTester } from "./anthropic";
import { createGeminiAdapter, createGeminiKeyTester } from "./gemini";
import { createOpenAIAdapter, createOpenAIKeyTester } from "./openai";
import type { ProviderOptions } from "./shared";

// 第 2.3 節 AI provider、角色、認證方式三個註冊表。新增實作只需註冊並通過契約（第 7.2 節）

export function createProviderRegistry(): Registry<ProviderAdapter> {
  return createRegistry<ProviderAdapter>({ kind: "ProviderAdapter", idOf: (a) => a.id, check: checkProviderAdapter });
}

export function createRoleRegistry(): Registry<RoleSpec> {
  return createRegistry<RoleSpec>({ kind: "RoleSpec", idOf: (r) => r.id, check: checkRoleSpec });
}

export interface CredentialRegistry extends Registry<CredentialProvider> {
  // 目前可用的認證方式；plan_oauth 第一版不列入
  available(): CredentialProvider[];
}

export function createCredentialRegistry(): CredentialRegistry {
  const registry = createRegistry<CredentialProvider>({
    kind: "CredentialProvider",
    idOf: (c) => c.kind,
    check: checkCredentialProvider,
  });
  return { ...registry, available: () => registry.list().filter((c) => c.available) };
}

// T13：三家 provider adapter 與儲存前測試呼叫
export { createAnthropicAdapter, createAnthropicKeyTester } from "./anthropic";
export { createGeminiAdapter, createGeminiKeyTester } from "./gemini";
export { createOpenAIAdapter, createOpenAIKeyTester } from "./openai";
export { ProviderError, classifyProviderError } from "./errors";
export { extractJson, stripInjectedNulls, toProviderSchema, type SchemaDialect } from "./schema";
export type { ProviderOptions } from "./shared";

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
