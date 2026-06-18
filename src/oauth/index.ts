import type { OAuthController, OAuthCredentials } from "./types";
import type { OcxConfig, OcxProviderConfig } from "../types";
import { loadConfig, resolveEnvValue, saveConfig } from "../config";
import { getCredential, saveCredential } from "./store";
import { loginXai, refreshXaiToken } from "./xai";
import { loginAnthropic, refreshAnthropicToken } from "./anthropic";
import { loginKimi, refreshKimiToken } from "./kimi";

const REFRESH_SKEW_MS = 60_000;

interface OAuthProviderDef {
  login(ctrl: OAuthController): Promise<OAuthCredentials>;
  refresh(refreshToken: string, signal?: AbortSignal): Promise<OAuthCredentials>;
  /** provider entry written into config.json on first login. */
  providerConfig: OcxProviderConfig;
  defaultModel: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderDef> = {
  xai: {
    login: (ctrl) => loginXai(ctrl, { importLocal: "fallback" }),
    refresh: refreshXaiToken,
    providerConfig: {
      adapter: "openai-chat",
      baseUrl: "https://api.x.ai/v1",
      authMode: "oauth",
      // Real xAI model ids (verified live via GET api.x.ai/v1/models); the proxy also fetches
      // the live list at sync time, so this is the routing hint / fallback + explicit additions.
      models: ["grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning", "grok-build-0.1", "grok-composer-2.5-fast"],
      defaultModel: "grok-4.3",
      // These don't accept a reasoning/thinking param — never forward reasoning_effort for them.
      noReasoningModels: ["grok-build-0.1", "grok-composer-2.5-fast"],
    },
    defaultModel: "grok-4.3",
  },
  anthropic: {
    login: (ctrl) => loginAnthropic(ctrl, { importLocal: "fallback" }),
    refresh: refreshAnthropicToken,
    providerConfig: {
      adapter: "anthropic",
      baseUrl: "https://api.anthropic.com",
      authMode: "oauth",
      models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
      defaultModel: "claude-sonnet-4-5",
    },
    defaultModel: "claude-sonnet-4-5",
  },
  kimi: {
    login: (ctrl) => loginKimi(ctrl),
    refresh: refreshKimiToken,
    providerConfig: {
      adapter: "openai-chat",
      baseUrl: "https://api.kimi.com/coding/v1",
      authMode: "oauth",
      models: ["kimi-k2.6", "kimi-k2.5"],
      defaultModel: "kimi-k2.6",
    },
    defaultModel: "kimi-k2.6",
  },
};

export function isOAuthProvider(name: string): boolean {
  return name in OAUTH_PROVIDERS;
}

/** Provider ids that support real OAuth login (drives the GUI's "Log in with …" buttons). */
export function listOAuthProviders(): string[] {
  return Object.keys(OAUTH_PROVIDERS);
}

/** Return a valid access token, refreshing + persisting if expired. Throws if not logged in. */
export async function getValidAccessToken(provider: string): Promise<string> {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) throw new Error(`Unknown OAuth provider: ${provider}`);
  const cred = getCredential(provider);
  if (!cred) throw new Error(`Not logged in to ${provider}. Run: ocx login ${provider}`);
  if (cred.expires > Date.now() + REFRESH_SKEW_MS) return cred.access;
  const fresh = await def.refresh(cred.refresh);
  saveCredential(provider, fresh);
  return fresh.access;
}

/**
 * Shared bearer-token resolver for /models listing — used by BOTH server.ts:fetchAllModels and
 * codex-catalog.ts:fetchProviderModels so OAuth providers' models are listed once logged in.
 * Returns undefined for forward-mode or oauth-not-logged-in (caller skips).
 */
export async function resolveModelsAuthToken(name: string, prov: OcxProviderConfig): Promise<string | undefined> {
  if (prov.authMode === "forward") return undefined;
  if (prov.authMode === "oauth") {
    try {
      return await getValidAccessToken(name);
    } catch {
      return undefined;
    }
  }
  return resolveEnvValue(prov.apiKey);
}

/** Add/refresh an OAuth provider's config entry on a config object (does not persist). */
export function upsertOAuthProvider(config: OcxConfig, provider: string): void {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) return;
  config.providers[provider] = { ...def.providerConfig };
}

/** Run the login flow, persist the credential + upsert the provider entry to disk, return cred. */
export async function runLogin(provider: string, ctrl: OAuthController): Promise<OAuthCredentials> {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) throw new Error(`Unknown OAuth provider: ${provider}`);
  const cred = await def.login(ctrl);
  saveCredential(provider, cred);
  const config = loadConfig();
  upsertOAuthProvider(config, provider);
  saveConfig(config);
  return cred;
}

/**
 * GUI async login: start the flow, return the auth URL EARLY (the flow keeps running in the
 * background until the callback server captures the redirect), with a concurrency guard and an
 * error surfaced via getLoginStatus().
 */
const loginState = new Map<string, { error?: string; done: boolean }>();

export function getLoginStatus(provider: string): { loggedIn: boolean; email?: string; error?: string } {
  const cred = getCredential(provider);
  const st = loginState.get(provider);
  return { loggedIn: !!cred, email: cred?.email, error: st?.error };
}

export function clearLoginState(provider: string): void {
  loginState.delete(provider);
}

export async function startLoginFlow(provider: string): Promise<{ url: string; instructions?: string }> {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) throw new Error(`Unknown OAuth provider: ${provider}`);
  const existing = loginState.get(provider);
  if (existing && !existing.done) {
    throw new Error(`A login for ${provider} is already in progress`);
  }
  loginState.set(provider, { done: false });
  return new Promise((resolve, reject) => {
    let urlResolved = false;
    const ctrl: OAuthController = {
      onAuth: ({ url, instructions }) => {
        urlResolved = true;
        resolve({ url, instructions });
      },
      onProgress: () => {},
    };
    // Background: runLogin persists the credential + upserts the provider entry to disk config.
    runLogin(provider, ctrl)
      .then(() => {
        loginState.set(provider, { done: true });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        loginState.set(provider, { done: true, error: msg });
        if (!urlResolved) reject(e);
      });
  });
}
