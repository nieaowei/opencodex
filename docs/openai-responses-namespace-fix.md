# openai-responses namespace function_call 修复方案

## 问题

某些第三方 Responses API 能识别 `{type: "namespace"}` 工具，但返回的 `function_call` 没有独立的 `namespace` 字段，而是把 namespace 和 tool name 扁平化成单个字符串：

```json
{
  "type": "function_call",
  "call_id": "call_xxx",
  "name": "multi_agent_v1__spawn_tool",
  "arguments": "{}",
  "status": "in_progress"
}
```

Codex 期望收到的是：

```json
{
  "type": "function_call",
  "call_id": "call_xxx",
  "name": "spawn_tool",
  "namespace": "multi_agent_v1",
  "arguments": "{}",
  "status": "in_progress"
}
```

如果不展开，Codex 会把整个 `multi_agent_v1__spawn_tool` 当作普通 function 工具名，找不到对应工具，导致调用失败。

## 为什么之前的透传路径改不动

`src/adapters/openai-responses.ts` 原来是一个 `passthrough: true` 的适配器，`src/server/responses.ts` 对它走原生 SSE 透传：

1. 用 `fetch` 拿到上游 Response。
2. 直接把它作为 `Response.body` 返回给客户端。
3. 为了记录 terminal outcome / quota，会用 `tee()` 分一条旁路做后台解析。

在这个路径上做任何 `ReadableStream` 转换（包括只改 function_call 名字）都会导致客户端一条 SSE 事件都收不到。已验证过三种改法：

- 在 `tee()` 之前转换整个上游 body。
- 在 `tee()` 之后分别转换两条分支。
- 只转换 client branch，旁路保持原样。

全部导致同样的症状：响应卡住，客户端看不到任何 SSE 事件。因此不能在这个原生透传路径上做转换。

## 方案：把 openai-responses 改成真正的适配器

不再让 `openai-responses` 走原生透传，而是让它像 `openai-chat`、`anthropic` 一样：

1. `buildRequest` 保持不变，继续负责请求体清洗（Spark 兼容、hosted tool 冲突、reasoning 输入清洗等）。
2. 新增 `parseStream(response)`：读取上游 Responses SSE，把事件映射成内部的 `AdapterEvent`。
3. 新增 `parseResponse(response)`：读取上游非流式 JSON 响应，同样映射成 `AdapterEvent`。
4. `src/server/responses.ts` 的非透传通用路径会接管：调用 `adapter.fetchResponse` / 默认 `fetch`，然后用 `bridgeToResponsesSSE` / `buildResponseJSON` 重新编码成 Responses SSE/JSON 返回给 Codex。

### namespace 展开在哪里发生

不需要在 adapter 里手动拆 `namespace__toolname`。

proxy 在收到请求时已经通过 `buildToolBridgeMaps(parsed)` 建立了 `toolNsMap`：

```ts
if (t.namespace) {
  toolNsMap.set(namespacedToolName(t.namespace, t.name), { namespace: t.namespace, name: t.name });
}
```

`namespacedToolName` 生成 `namespace__name`。因此当 adapter emit `tool_call_start { name: "multi_agent_v1__spawn_tool" }` 时，bridge 会查表并生成：

```ts
{
  type: "function_call",
  name: "spawn_tool",
  namespace: "multi_agent_v1",
  ...
}
```

如果上游本来就返回了 `{name, namespace}`（比如原生 OpenAI 平台），`toolNsMap` 查不到，bridge 会原样透传，不会破坏已有行为。

## 实现细节

### `parseResponsesStream`

解析上游 Responses SSE，支持以下事件：

| 上游事件 | 内部 AdapterEvent |
|---|---|
| `response.output_item.added` (message) | 打开文本消息 |
| `response.output_text.delta` | `text_delta` |
| `response.output_item.added` (function_call) | `tool_call_start` |
| `response.function_call_arguments.delta` | `tool_call_delta` |
| `response.output_item.done` (function_call) | `tool_call_end` |
| `response.output_item.added` (reasoning) | 打开 reasoning 块 |
| `response.reasoning_summary_text.delta` / `response.reasoning_text.delta` | `reasoning_raw_delta` |
| `response.output_item.added` (web_search_call) | `web_search_call_begin` |
| `response.output_item.done` (web_search_call) | `web_search_call_end` |
| `response.completed` | `done` |
| `response.incomplete` | `done` (带 stopReason) |
| `response.failed` | `error` |
| `response.usage` | 缓存 usage，附在 `done` 上 |

### `parseResponsesJson`

非流式响应直接读取 JSON 的 `output` 数组，把每个 item 转成一组 AdapterEvent，最后 emit `done`。

### `usageFromOpenAIResponses`

把 Responses API 的 usage 形状：

```json
{
  "input_tokens": 100,
  "output_tokens": 50,
  "total_tokens": 150,
  "input_tokens_details": { "cached_tokens": 10, "cache_write_tokens": 5 },
  "output_tokens_details": { "reasoning_tokens": 20 }
}
```

转成内部 `OcxUsage`。

### `azure.ts` 同步修改

`azure-openai` 适配器内部复用了 `createResponsesPassthroughAdapter` 作为 base。由于返回类型从 `ProviderAdapter & { passthrough: true }` 改成了 `ProviderAdapter`，`azure.ts` 的返回类型也同步改为 `ProviderAdapter`。

## 为什么选这个方案

用户明确排除了：

- 增加 provider config 开关。
- 在原生透传路径上做 ReadableStream 转换（已验证会挂）。

在剩下的可选方向里，让 adapter 深度处理响应是最稳的：

- 复用已有的 `bridgeToResponsesSSE`，它已经把 `AdapterEvent` 正确编码成 Codex 能理解的 Responses SSE。
- namespace 展开复用已有的 `toolNsMap` 机制，不需要额外解析字符串。
- 不改变请求构建逻辑，保留所有原有清洗（Spark、hosted tools、reasoning 等）。
- 非流式和流式都统一处理。

## 已知影响

1. **响应不再是原生透传**。SSE 由 bridge 重新生成，事件格式与上游几乎一致，但 `id`、`created_at` 等会重新生成。
2. **OpenAI 侧载逻辑行为变化**：`shouldResolveOpenAiWebSearchSidecar` 在 `isPassthrough === false` 时可能启用侧载。`openai-responses`  provider 本身如果配置了 web_search，上游会原生产生 `web_search_call` item，adapter 已处理这种 item。
3. **Continuation cache**：非透传路径通过 `bridgeToResponsesSSE` 的 `onCompletedResponse` 回调调用 `rememberResponseState`，与 anthropic/openai-chat 路径一致。
4. **远程 compaction**：非透传路径下，`parsed._compactionRequest === true` 会进入 routed compaction 分支，这是通用 adapter 的标准行为。

## 测试建议

1. 启动 proxy，配置一个返回扁平 namespace function_call 的第三方 Responses endpoint。
2. 让 Codex 调用一个 namespace 工具（如 `multi_agent_v1/spawn_tool`）。
3. 在 Codex 侧确认：
   - 响应正常下发，不再卡住。
   - `function_call` item 的 `name` 是 `spawn_tool`，并且带 `namespace` 字段。
   - 工具后续调用能正确匹配。
4. 同时回归测试原生 OpenAI / ChatGPT 账号池路径，确保没破坏：
   - 普通文本回复。
   - 普通 function 调用。
   - web_search_call。
   - reasoning 输出。

## 文件变更

- `src/adapters/openai-responses.ts`
  - 移除 `passthrough: true`
  - 新增 `usageFromOpenAIResponses`
  - 新增 `parseResponsesStream`
  - 新增 `parseResponsesJson`
  - 更新 adapter 返回的 `parseStream` / `parseResponse`
- `src/adapters/azure.ts`
  - 返回类型从 `ProviderAdapter & { passthrough: true }` 改为 `ProviderAdapter`
