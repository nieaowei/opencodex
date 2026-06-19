import { useEffect, useMemo, useRef, useState } from "react";
import { IconX, IconLock, IconKey, IconExternal } from "../icons";

export interface ProviderConfig {
  adapter: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  authMode?: "key" | "forward" | "oauth";
}

interface Preset {
  id: string;
  label: string;
  adapter: string;
  baseUrl: string;
  defaultModel?: string;
  /** "oauth": real account login · "forward": gpt ChatGPT passthrough · "key": API key. */
  auth: "oauth" | "forward" | "key";
  /** OAuth registry id (for auth === "oauth"). */
  oauthProvider?: string;
  /** Where to create/copy the API key (for auth === "key" catalog providers). */
  dashboardUrl?: string;
  note?: string;
}

// `oauth` presets log in with the provider's own account (real OAuth). `forward` is the gpt
// ChatGPT-login passthrough. `key` presets need an API key.
const PRESETS: Preset[] = [
  { id: "openai", label: "OpenAI (ChatGPT login)", adapter: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex", auth: "forward", note: "Uses your codex login — no API key" },
  { id: "xai", label: "xAI Grok", adapter: "openai-chat", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-4.3", auth: "oauth", oauthProvider: "xai", note: "Log in with your Grok account" },
  { id: "anthropic", label: "Anthropic Claude", adapter: "anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-5", auth: "oauth", oauthProvider: "anthropic", note: "Log in with your Claude account" },
  { id: "kimi", label: "Kimi", adapter: "openai-chat", baseUrl: "https://api.moonshot.ai/v1", defaultModel: "kimi-k2.6", auth: "oauth", oauthProvider: "kimi", note: "Log in with your Kimi account" },
  { id: "openai-apikey", label: "OpenAI (API key)", adapter: "openai-responses", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5.5", auth: "key" },
  { id: "opencode-go", label: "opencode go", adapter: "openai-chat", baseUrl: "https://opencode.ai/zen/go/v1", defaultModel: "kimi-k2.6", auth: "key", note: "GLM, DeepSeek, Kimi, Qwen, MiMo…" },
  { id: "openrouter", label: "OpenRouter", adapter: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", auth: "key" },
  { id: "groq", label: "Groq", adapter: "openai-chat", baseUrl: "https://api.groq.com/openai/v1", auth: "key" },
  { id: "google", label: "Google Gemini", adapter: "google", baseUrl: "https://generativelanguage.googleapis.com", defaultModel: "gemini-3-pro", auth: "key" },
  { id: "azure-openai", label: "Azure OpenAI", adapter: "azure-openai", baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}", auth: "key" },
  { id: "ollama", label: "Ollama (local)", adapter: "openai-chat", baseUrl: "http://localhost:11434/v1", auth: "key", note: "Local — key usually blank" },
  { id: "vllm", label: "vLLM (local)", adapter: "openai-chat", baseUrl: "http://localhost:8000/v1", auth: "key", note: "Local — key usually blank" },
  { id: "lm-studio", label: "LM Studio (local)", adapter: "openai-chat", baseUrl: "http://localhost:1234/v1", auth: "key", note: "Local — no key needed" },
  { id: "custom", label: "Custom provider", adapter: "openai-chat", baseUrl: "", auth: "key" },
];

interface FormState {
  name: string;
  adapter: string;
  baseUrl: string;
  authMode: "key" | "forward" | "oauth";
  apiKey: string;
  defaultModel: string;
}

export default function AddProviderModal({
  apiBase, existingNames, onClose, onAdded,
}: {
  apiBase: string;
  existingNames: string[];
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [preset, setPreset] = useState<Preset | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [oauthSupported, setOauthSupported] = useState<string[]>([]);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthMsg, setOauthMsg] = useState("");
  const [keyProviders, setKeyProviders] = useState<Preset[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => () => { aliveRef.current = false; }, []); // stop the OAuth poll if the modal unmounts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    fetch(`${apiBase}/api/oauth/providers`).then(r => r.json()).then(d => setOauthSupported(d.providers ?? [])).catch(() => {});
  }, [apiBase]);
  useEffect(() => {
    fetch(`${apiBase}/api/key-providers`).then(r => r.json()).then((d: { providers?: Array<{ id: string; label: string; adapter: string; baseUrl: string; dashboardUrl?: string; defaultModel?: string }> }) => {
      setKeyProviders((d.providers ?? []).map(p => ({
        id: p.id, label: p.label, adapter: p.adapter, baseUrl: p.baseUrl, defaultModel: p.defaultModel, auth: "key" as const, dashboardUrl: p.dashboardUrl,
      })));
    }).catch(() => {});
  }, [apiBase]);

  // Static presets + catalog key-login providers (deduped by id, custom kept last).
  const allPresets = useMemo(() => {
    const ids = new Set(PRESETS.map(p => p.id));
    const extra = keyProviders.filter(p => !ids.has(p.id));
    const customIdx = PRESETS.findIndex(p => p.id === "custom");
    if (customIdx < 0) return [...PRESETS, ...extra];
    return [...PRESETS.slice(0, customIdx), ...extra, ...PRESETS.slice(customIdx)];
  }, [keyProviders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allPresets;
    // Match by provider name/id — not adapter, since most share "openai-chat" and would all match.
    return allPresets.filter(p => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [query, allPresets]);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    setForm({
      name: p.id === "custom" ? "" : p.id,
      adapter: p.adapter,
      baseUrl: p.baseUrl,
      authMode: p.auth,
      apiKey: "",
      defaultModel: p.defaultModel ?? "",
    });
    setError(""); setOauthMsg("");
  };

  const back = () => { setPreset(null); setForm(null); setError(""); setOauthMsg(""); };

  const submit = async () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) { setError("Provider name is required"); return; }
    if (!form.baseUrl.trim()) { setError("Base URL is required"); return; }
    const provider: ProviderConfig = { adapter: form.adapter.trim(), baseUrl: form.baseUrl.trim() };
    if (form.authMode === "forward") provider.authMode = "forward";
    else if (form.apiKey.trim()) provider.apiKey = form.apiKey.trim();
    if (form.defaultModel.trim()) provider.defaultModel = form.defaultModel.trim();

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, provider }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Failed (${res.status})`);
        return;
      }
      onAdded(name);
    } catch {
      setError("Network error — is the proxy running?");
    } finally {
      setSaving(false);
    }
  };

  // Real OAuth login: open the provider's auth page in a new tab, poll until the proxy stores the token.
  const loginOAuth = async (providerId: string) => {
    setOauthBusy(true);
    setOauthMsg("");
    try {
      const res = await fetch(`${apiBase}/api/oauth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = await res.json();
      if (!aliveRef.current) return;
      if (!res.ok) {
        setOauthMsg(data.error === "unknown oauth provider"
          ? "OAuth login for this provider arrives in the next update — use an API key for now."
          : (data.error || "Login failed to start"));
        return;
      }
      // A non-empty url = browser/device flow (the server also opens it). An EMPTY url with a 200 =
      // a local-token import (e.g. Anthropic's Claude Code keychain, Grok CLI) that needs no browser
      // — just poll status until the credential lands. Don't treat empty url as a failure.
      if (data.url) { window.open(data.url, "_blank"); setOauthMsg("Waiting for browser login…"); }
      else { setOauthMsg(data.instructions || "Logging in…"); }
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 2000));
        if (!aliveRef.current) return; // modal closed → stop polling, don't fire onAdded
        const s = await fetch(`${apiBase}/api/oauth/status?provider=${providerId}`).then(r => r.json()).catch(() => null);
        if (!aliveRef.current) return;
        if (s?.loggedIn) { onAdded(providerId); return; }
        if (s?.error) { setOauthMsg(`Login error: ${s.error}`); return; }
      }
      setOauthMsg("Login timed out — try again.");
    } catch {
      if (aliveRef.current) setOauthMsg("Network error — is the proxy running?");
    } finally {
      if (aliveRef.current) setOauthBusy(false);
    }
  };

  const dup = form ? existingNames.includes(form.name.trim()) && form.name.trim() !== "" : false;

  return (
    <div role="dialog" aria-modal="true" aria-label="Add provider" className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{preset ? `Add: ${preset.label}` : "Add provider"}</h3>
          <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}><IconX /></button>
        </div>

        {!preset ? (
          <>
            <input
              ref={searchRef}
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search providers…"
            />
            <div style={{ marginTop: 12, maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered.map(p => (
                <button key={p.id} className="list-row" onClick={() => choosePreset(p)}>
                  <div>
                    <div className="title">{p.label}</div>
                    <div className="sub"><code className="chip">{p.adapter}</code>{p.note ? ` · ${p.note}` : ""}</div>
                  </div>
                  {p.auth === "oauth"
                    ? <span className="badge badge-accent">OAuth</span>
                    : p.auth === "forward"
                      ? <span className="badge badge-green">Codex login</span>
                      : <span className="badge badge-muted">API key</span>}
                </button>
              ))}
              {filtered.length === 0 && <div className="muted" style={{ fontSize: 13, padding: 8 }}>No match.</div>}
            </div>
          </>
        ) : form && (
          preset.auth === "oauth" && form.authMode === "oauth" ? (
            // ── Real OAuth login pane ──
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="muted" style={{ fontSize: 13 }}>{preset.note ?? "Log in with your account — no API key needed."}</div>
              {oauthSupported.includes(preset.oauthProvider ?? "") ? (
                <button className="btn btn-primary" onClick={() => loginOAuth(preset.oauthProvider!)} disabled={oauthBusy}
                  style={{ width: "100%", padding: "12px 16px", fontSize: 14 }}>
                  <IconLock />{oauthBusy ? "Waiting for browser…" : `Log in with ${preset.label}`}
                </button>
              ) : (
                <div style={{ fontSize: 13, color: "var(--amber)", background: "var(--amber-soft)", border: "1px solid var(--amber)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                  OAuth login for {preset.label} arrives in the next update. Use an API key for now.
                </div>
              )}
              {oauthMsg && <div style={{ fontSize: 12, color: /error|update|timed/.test(oauthMsg) ? "var(--amber)" : "var(--accent-hover)" }}>{oauthMsg}</div>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                <button className="link-btn" onClick={() => { setForm({ ...form, authMode: "key" }); setOauthMsg(""); }}>Use an API key instead</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-ghost" onClick={back}>Back</button>
              </div>
            </div>
          ) : (
            // ── API key / Codex-forward form ──
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Field label="Provider name">
                <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. openrouter" />
              </Field>
              {dup && <div style={{ fontSize: 12, color: "var(--amber)" }}>A provider named “{form.name.trim()}” exists — it will be overwritten.</div>}
              <Field label="Adapter">
                <select className="input" value={form.adapter} onChange={e => setForm({ ...form, adapter: e.target.value })}>
                  {["openai-responses", "openai-chat", "anthropic", "google", "azure-openai"].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Base URL">
                <input className="input" value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://…" />
              </Field>
              {form.authMode === "forward" ? (
                <div style={{ fontSize: 12, color: "var(--green)", background: "var(--green-soft)", border: "1px solid var(--green)", borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>
                  No key needed — the proxy forwards your <code className="chip">codex login</code> credentials to this provider.
                </div>
              ) : (
                <>
                  {preset.dashboardUrl && (
                    <a href={preset.dashboardUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <IconKey style={{ width: 14, height: 14 }} />Get your {preset.label} API key<IconExternal style={{ width: 13, height: 13 }} />
                    </a>
                  )}
                  <Field label="API key">
                    <input className="input" type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-… (or $ENV_VAR)" />
                  </Field>
                </>
              )}
              <Field label="Default model (optional)">
                <input className="input" value={form.defaultModel} onChange={e => setForm({ ...form, defaultModel: e.target.value })} placeholder="e.g. gpt-5.5" />
              </Field>
              {error && <div role="alert" style={{ fontSize: 13, color: "var(--red)" }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
                <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? "Adding…" : "Add provider"}</button>
                {preset.auth === "oauth" && <button className="link-btn" onClick={() => { setForm({ ...form, authMode: "oauth" }); setError(""); }}>← Use OAuth login</button>}
                <div style={{ flex: 1 }} />
                <button className="btn btn-ghost" onClick={back}>Back</button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
