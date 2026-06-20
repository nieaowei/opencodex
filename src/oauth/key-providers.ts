import type { OcxProviderConfig } from "../types";

/**
 * API-key "login" providers: not OAuth — the flow opens the provider's dashboard so the user can
 * create/copy a key, then validates + stores it as the provider's `apiKey` (authMode "key").
 * Most use the OpenAI-compatible chat API (`openai-chat` adapter, `Authorization: Bearer <key>`); a
 * few expose only an Anthropic-compatible endpoint and set `adapter: "anthropic"` (`x-api-key`).
 */
export interface KeyLoginProvider {
  label: string;
  baseUrl: string;
  adapter: string;
  /** Where the user creates/copies the API key. */
  dashboardUrl: string;
  models?: string[];
  defaultModel?: string;
  /**
   * Model ids that do NOT accept image input (the vision sidecar describes images for them) / do NOT
   * accept a reasoning param. Copied into the created provider config by `enrichProviderFromCatalog`,
   * so the classification actually gates the sidecars (matching is tolerant of an Ollama ":size" tag).
   */
  noVisionModels?: string[];
  noReasoningModels?: string[];
}

export const KEY_LOGIN_PROVIDERS: Record<string, KeyLoginProvider> = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", adapter: "openai-chat", dashboardUrl: "https://platform.deepseek.com/api_keys", models: ["deepseek-chat", "deepseek-reasoner"], defaultModel: "deepseek-chat" },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", adapter: "openai-chat", dashboardUrl: "https://cloud.cerebras.ai/platform/apikeys", defaultModel: "llama-3.3-70b" },
  together: { label: "Together", baseUrl: "https://api.together.xyz/v1", adapter: "openai-chat", dashboardUrl: "https://api.together.xyz/settings/api-keys" },
  fireworks: { label: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", adapter: "openai-chat", dashboardUrl: "https://fireworks.ai/account/api-keys" },
  firepass: { label: "Fire Pass (Fireworks Kimi)", baseUrl: "https://api.fireworks.ai/inference/v1", adapter: "openai-chat", dashboardUrl: "https://fireworks.ai/account/api-keys" },
  moonshot: { label: "Moonshot (Kimi API)", baseUrl: "https://api.moonshot.ai/v1", adapter: "openai-chat", dashboardUrl: "https://platform.moonshot.ai/console/api-keys", defaultModel: "kimi-k2-0905-preview" },
  huggingface: { label: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", adapter: "openai-chat", dashboardUrl: "https://huggingface.co/settings/tokens" },
  nvidia: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", adapter: "openai-chat", dashboardUrl: "https://build.nvidia.com" },
  venice: { label: "Venice", baseUrl: "https://api.venice.ai/api/v1", adapter: "openai-chat", dashboardUrl: "https://venice.ai/settings/api" },
  zai: { label: "Z.AI (GLM Coding)", baseUrl: "https://api.z.ai/api/coding/paas/v4", adapter: "openai-chat", dashboardUrl: "https://z.ai/manage-apikey/apikey-list", defaultModel: "glm-4.6" },
  nanogpt: { label: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1", adapter: "openai-chat", dashboardUrl: "https://nano-gpt.com/api" },
  synthetic: { label: "Synthetic", baseUrl: "https://api.synthetic.new/openai/v1", adapter: "openai-chat", dashboardUrl: "https://synthetic.new" },
  "qwen-portal": { label: "Qwen Portal", baseUrl: "https://portal.qwen.ai/v1", adapter: "openai-chat", dashboardUrl: "https://portal.qwen.ai" },
  qianfan: { label: "Qianfan (Baidu)", baseUrl: "https://qianfan.baidubce.com/v2", adapter: "openai-chat", dashboardUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list" },
  alibaba: { label: "Alibaba Coding Plan", baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1", adapter: "openai-chat", dashboardUrl: "https://dashscope.console.aliyun.com/apiKey" },
  parallel: { label: "Parallel", baseUrl: "https://platform.parallel.ai", adapter: "openai-chat", dashboardUrl: "https://platform.parallel.ai" },
  zenmux: { label: "ZenMux", baseUrl: "https://zenmux.ai/api/v1", adapter: "openai-chat", dashboardUrl: "https://zenmux.ai" },
  litellm: { label: "LiteLLM (self-hosted)", baseUrl: "http://localhost:4000/v1", adapter: "openai-chat", dashboardUrl: "https://docs.litellm.ai/docs/proxy/quick_start" },
  // Ollama Cloud — hosted (not local), OpenAI-compatible at /v1, Bearer key from ollama.com.
  // models/noVisionModels reflect the live ollama.com cloud lineup (the proxy still fetches /v1/models
  // live; this is the seed + the vision/text classification, web-verified against ollama.com search
  // filters). Vision-capable cloud models are EXCLUDED from noVisionModels: kimi-k2.5/.6/.7-code,
  // minimax-m3, gemma3/gemma4, qwen3.5, gemini-3-flash-preview, ministral-3, devstral-small-2,
  // mistral-large-3. gpt-oss is text-only despite a stale third-party list claiming otherwise.
  "ollama-cloud": {
    label: "Ollama Cloud",
    baseUrl: "https://ollama.com/v1",
    adapter: "openai-chat",
    dashboardUrl: "https://ollama.com/settings/keys",
    models: ["glm-5.2", "deepseek-v4-pro", "qwen3-coder", "gpt-oss:120b", "kimi-k2.6", "minimax-m3", "qwen3.5", "gemma4"],
    defaultModel: "glm-5.2",
    noVisionModels: [
      "glm-5.2", "glm-5.1", "glm-5", "glm-4.7",
      "minimax-m2.7", "minimax-m2.5", "minimax-m2.1",
      "nemotron-3-ultra", "nemotron-3-super",
      "deepseek-v4-pro", "deepseek-v4-flash",
      "gpt-oss", "qwen3-coder",
    ],
  },
  // ── Brought over from the jawcode provider registry ────────────────────────────────────
  // Real LLM API providers. CLI-agent integrations (cursor, github-copilot, gitlab-duo,
  // google-gemini-cli/antigravity, kilo, opencode, openai-codex) and native-cloud-auth providers
  // (amazon-bedrock, google-vertex) are intentionally excluded. baseUrls are taken from jawcode.
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", adapter: "openai-chat", dashboardUrl: "https://console.mistral.ai/api-keys", defaultModel: "codestral-latest" },
  minimax: { label: "MiniMax", baseUrl: "https://api.minimax.io/v1", adapter: "openai-chat", dashboardUrl: "https://platform.minimax.io", defaultModel: "MiniMax-M2.5" },
  "minimax-cn": { label: "MiniMax (CN)", baseUrl: "https://api.minimaxi.com/v1", adapter: "openai-chat", dashboardUrl: "https://platform.minimaxi.com", defaultModel: "MiniMax-M2.5" },
  "kimi-code": { label: "Kimi (coding)", baseUrl: "https://api.kimi.com/coding/v1", adapter: "openai-chat", dashboardUrl: "https://platform.moonshot.cn/console/api-keys", defaultModel: "kimi-k2.5" },
  "opencode-zen": { label: "opencode zen", baseUrl: "https://opencode.ai/zen/v1", adapter: "openai-chat", dashboardUrl: "https://opencode.ai/auth" },
  // opencode go — routed multi-model endpoint (GLM/DeepSeek/Kimi/Qwen/MiMo). Mirrors the GUI preset in
  // AddProviderModal.tsx so `ocx init` (CLI) reaches the documented GUI parity (was GUI-only → drift bug).
  "opencode-go": { label: "opencode go", baseUrl: "https://opencode.ai/zen/go/v1", adapter: "openai-chat", dashboardUrl: "https://opencode.ai/auth", defaultModel: "kimi-k2.6" },
  "vercel-ai-gateway": { label: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", adapter: "openai-chat", dashboardUrl: "https://vercel.com/dashboard" },
  // Xiaomi MiMo exposes an Anthropic-compatible endpoint → anthropic adapter (x-api-key).
  xiaomi: { label: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/anthropic", adapter: "anthropic", dashboardUrl: "https://xiaomimimo.com", defaultModel: "mimo-v2.5-pro" },
  // ── Gateways / multi-model proxies (standard wire; subscription-token auth) ──────────────
  // kilo: single-protocol OpenAI-compatible gateway (443 models). Cloudflare AI Gateway: anthropic
  // wire, URL is a template (fill in your account + gateway). github-copilot & gitlab-duo are
  // multi-model gateways whose models span 3 protocols on ONE host — mapped to their universal
  // OpenAI-compatible endpoint (one wire serves the whole lineup). Both need a Bearer subscription
  // token (not a plain API key), and copilot may need a `User-Agent` header via custom provider config.
  kilo: { label: "Kilo", baseUrl: "https://api.kilo.ai/api/gateway", adapter: "openai-chat", dashboardUrl: "https://kilo.ai" },
  "cloudflare-ai-gateway": { label: "Cloudflare AI Gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/{account-id}/{gateway}/anthropic", adapter: "anthropic", dashboardUrl: "https://dash.cloudflare.com/?to=/:account/ai/ai-gateway" },
  "github-copilot": { label: "GitHub Copilot", baseUrl: "https://api.githubcopilot.com", adapter: "openai-chat", dashboardUrl: "https://github.com/settings/copilot" },
  "gitlab-duo": { label: "GitLab Duo", baseUrl: "https://cloud.gitlab.com/ai/v1/proxy/openai/v1", adapter: "openai-chat", dashboardUrl: "https://gitlab.com/-/user_settings/personal_access_tokens" },
};

/**
 * Copy a key-login catalog entry's seed/classification (`models`, `noVisionModels`,
 * `noReasoningModels`, `defaultModel`) onto a provider config being created, for any field the caller
 * didn't already supply. Lets the vision/reasoning classification actually reach the saved config
 * (the GUI/API only send adapter/baseUrl/apiKey/defaultModel). No-op for non-catalog provider names.
 */
export function enrichProviderFromCatalog(name: string, prov: OcxProviderConfig): void {
  const e = KEY_LOGIN_PROVIDERS[name];
  if (!e) return;
  if (!prov.models && e.models) prov.models = [...e.models];
  if (!prov.defaultModel && e.defaultModel) prov.defaultModel = e.defaultModel;
  if (!prov.noVisionModels && e.noVisionModels) prov.noVisionModels = [...e.noVisionModels];
  if (!prov.noReasoningModels && e.noReasoningModels) prov.noReasoningModels = [...e.noReasoningModels];
}

export function isKeyLoginProvider(name: string): boolean {
  return name in KEY_LOGIN_PROVIDERS;
}

export function listKeyLoginProviders(): Array<{ id: string } & KeyLoginProvider> {
  return Object.entries(KEY_LOGIN_PROVIDERS).map(([id, p]) => ({ id, ...p }));
}

/** Best-effort key validation: GET {baseUrl}/models with the key. Returns true/false/unknown. */
export async function validateApiKey(baseUrl: string, key: string): Promise<boolean | "unknown"> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    return "unknown";
  } catch {
    return "unknown";
  }
}
