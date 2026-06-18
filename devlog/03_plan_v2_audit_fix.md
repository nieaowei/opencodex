# 03 — Phase 1 Plan v2 (Audit Fix)

> 작성: 2026-06-18 · Audit FAIL 6건 수정본

## Audit에서 지적된 핵심 이슈 및 수정

### BLOCKER 1: AdapterResponse ↔ encodeStream 브릿지 없음
**수정**: `src/bridge.ts` 신규 추가. 어댑터의 `AdapterEvent`를 jawcode 호환 `AssistantMessageEventStream`으로 변환.

### BLOCKER 2: parseRequest 반환 타입 축소 오류
**수정**: `OcxParsedRequest = { modelId, context, stream, options }` 도입. `OcxContext`는 context 필드만 해당.

### HIGH 3: encodeStream 추출 범위 오류 (720-900 → 실제 720-1190 + 헬퍼 496-672)
**수정**: 전체 범위 명시. `encodeStream`(720-1190) + `buildOutputItems`, `buildUsage`, `formatError`, `encodeResponse`(496-678) 포함.

### HIGH 4: parseRequest 헬퍼 95-265 누락
**수정**: `inputContentParts`, `buildTools`, `ensureAssistantPlaceholder`, `mapToolChoice` 등 전체 포함.

### HIGH 5: schema.ts가 openai SDK + zod/v4 의존
**수정**: package.json에 `zod`(^4.0), `openai`(devDep, 타입만 사용) 추가. 또는 openai 타입을 인라인.

### HIGH 6: OcxMessage에 toolResult/복합 content 미정의
**수정**: OcxMessage 타입을 jawcode Message와 1:1 호환 수준으로 확장.

---

## 수정된 파일 구조 (Phase 1)

```
opencodex/
├── package.json                          ← MODIFY (deps: zod, scripts)
├── tsconfig.json                         ← NEW
├── src/
│   ├── index.ts                          ← NEW (엔트리: cli.ts로 위임)
│   ├── cli.ts                            ← NEW (ocx start/stop/status)
│   ├── config.ts                         ← NEW (config.json 로드/저장)
│   ├── types.ts                          ← NEW (OcxParsedRequest, OcxContext, Message, Tool 등)
│   ├── server.ts                         ← NEW (Bun.serve + /v1/responses 라우팅)
│   ├── bridge.ts                         ← NEW (AdapterEvent → encodeStream 변환)
│   ├── responses/
│   │   ├── parser.ts                     ← NEW (parseRequest: 95-474행 추출)
│   │   ├── encoder.ts                    ← NEW (encodeStream/encodeResponse/formatError: 496-1190행)
│   │   └── schema.ts                     ← NEW (Zod 스키마: 전체 290행)
│   └── adapters/
│       ├── base.ts                       ← NEW (어댑터 인터페이스)
│       └── openai-chat.ts               ← NEW (Chat Completions 어댑터)
└── .gitignore                            ← 기존
```

**변경 사항**: `bridge.ts` 신규 추가 (총 13개 파일)

---

## 수정된 타입 설계

### `src/types.ts`

```typescript
// ─── 파싱 결과 (parseRequest 반환) ──────────────
export interface OcxParsedRequest {
  modelId: string;
  context: OcxContext;
  stream: boolean;
  options: OcxRequestOptions;
}

// ─── 내부 컨텍스트 ──────────────────────────────
export interface OcxContext {
  systemPrompt: string[];
  messages: OcxMessage[];
  tools: OcxTool[];
}

// ─── 메시지 (jawcode Message 호환) ──────────────
export type OcxMessage = 
  | OcxUserMessage
  | OcxAssistantMessage
  | OcxDeveloperMessage
  | OcxToolResultMessage;

export interface OcxUserMessage {
  role: "user";
  content: string | OcxContentPart[];
  timestamp: number;
}

export interface OcxAssistantMessage {
  role: "assistant";
  content: OcxAssistantContentPart[];
  model?: string;
  timestamp: number;
}

export interface OcxDeveloperMessage {
  role: "developer";
  content: string | OcxContentPart[];
  timestamp: number;
}

export interface OcxToolResultMessage {
  role: "tool";
  toolCallId: string;
  content: string;
  timestamp: number;
}

// ─── 콘텐츠 파트 ────────────────────────────────
export type OcxContentPart = OcxTextContent | OcxImageContent;
export type OcxAssistantContentPart = OcxTextContent | OcxThinkingContent | OcxToolCall;

export interface OcxTextContent { type: "text"; text: string; }
export interface OcxImageContent { type: "image"; url: string; }
export interface OcxThinkingContent { 
  type: "thinking"; 
  thinking: string; 
  signature?: string;
  itemId?: string;
}
export interface OcxToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ─── 도구 ───────────────────────────────────────
export interface OcxTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

// ─── 요청 옵션 ──────────────────────────────────
export interface OcxRequestOptions {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  reasoning?: string;
  serviceTier?: string;
  promptCacheKey?: string;
}

// ─── 어댑터 이벤트 (어댑터 → bridge) ────────────
export type AdapterEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; arguments: string }
  | { type: "tool_call_end" }
  | { type: "done"; usage?: OcxUsage }
  | { type: "error"; message: string };

export interface OcxUsage {
  inputTokens: number;
  outputTokens: number;
}
```

---

## 수정된 bridge.ts 설계

```typescript
// src/bridge.ts
// AdapterEvent 스트림 → encodeStream이 소비하는 ReadableStream<Uint8Array>으로 변환
//
// encodeStream은 jawcode의 AssistantMessageEventStream 인터페이스를 기대하지만,
// 우리는 이를 직접 구현하지 않고, AdapterEvent를 직접 Responses SSE로 변환합니다.
//
// 즉, jawcode의 encodeStream을 "참고"하되 AdapterEvent 기반으로 재작성합니다.
// 이것이 "추출 후 리팩토링"의 핵심: 
// jawcode의 SSE event taxonomy(이벤트 이름, 스냅샷 구조)는 유지하면서
// 입력 인터페이스를 AdapterEvent로 교체.

export function bridgeToResponsesSSE(
  events: AsyncIterable<AdapterEvent>,
  modelId: string,
  responseId: string,
): ReadableStream<Uint8Array> {
  // jawcode encodeStream의 SSE taxonomy를 그대로 사용:
  // response.created → response.output_item.added → 
  // response.output_text.delta (반복) → response.output_item.done →
  // response.completed
  //
  // 차이점: 입력이 AssistantMessageEventStream이 아니라 AdapterEvent
}
```

이 접근법의 장점:
- jawcode의 `AssistantMessageEventStream` 클래스를 통째로 이식할 필요 없음
- Codex가 기대하는 SSE 이벤트 규격(이름, 필드, 순서)만 정확히 맞추면 됨
- 어댑터 인터페이스가 단순해짐

---

## 수정된 어댑터 인터페이스

```typescript
// src/adapters/base.ts
export interface ProviderAdapter {
  name: string;

  buildRequest(parsed: OcxParsedRequest): {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };

  parseStream(response: Response): AsyncGenerator<AdapterEvent>;
}
```

**변경점**: `buildRequest`가 `OcxContext`가 아닌 `OcxParsedRequest` 전체를 받음 → `options`(temperature, toolChoice 등) 접근 가능.

---

## 수정된 server.ts 파이프라인

```
POST /v1/responses
  → parseRequest(body)           // Responses body → OcxParsedRequest
  → adapter.buildRequest(parsed) // OcxParsedRequest → Chat Completions 요청
  → fetch(provider)              // 프로바이더 호출
  → adapter.parseStream(res)     // Chat SSE → AdapterEvent 스트림
  → bridgeToResponsesSSE(events) // AdapterEvent → Responses SSE
  → Response (SSE stream)

비스트리밍 경로:
  → parseRequest(body)           // stream: false
  → adapter.buildRequest(parsed)
  → fetch(provider)              // stream: false로 요청
  → adapter.parseResponse(res)   // 단일 JSON 응답
  → buildResponseJSON(result)    // Responses API JSON envelope
  → Response (JSON)
```

---

## 수정된 jawcode 추출 매핑

| jawcode 소스 | 줄 범위 | opencodex 대상 | 추출 방식 |
|---|---|---|---|
| `openai-responses-server.ts` 헬퍼 | 95-265 | `responses/parser.ts` | 리팩토링 (inputContentParts, buildTools 등) |
| `openai-responses-server.ts` parseRequest | 266-474 | `responses/parser.ts` | 리팩토링 (타입→Ocx*, logger→console) |
| `openai-responses-server.ts` 인코더 헬퍼 | 496-678 | `responses/encoder.ts` | 참고 (buildOutputItems, formatError, encodeResponse) |
| `openai-responses-server.ts` encodeStream | 720-1190 | `bridge.ts` | **참고 후 재작성** (SSE taxonomy만 유지, 입력 인터페이스 교체) |
| `openai-responses-server-schema.ts` | 1-290 | `responses/schema.ts` | 추출 (openai 타입 인라인화, zod 유지) |
| `auth-gateway/types.ts` 옵션 | 20-95 | `types.ts` OcxRequestOptions | 경량화 (P1 필요 필드만) |

---

## 수정된 package.json 의존성

```json
{
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

`openai` SDK 타입: schema.ts에서 참조하는 3-4개 타입을 인라인 정의로 교체 (전체 SDK 의존 불필요).

---

## ocx stop 메커니즘

```
ocx start → PID를 ~/.opencodex/ocx.pid에 기록
ocx stop → PID 파일 읽기 → SIGTERM 전송 → Bun.serve.stop() graceful shutdown
ocx status → PID 파일 + process.kill(pid, 0) 체크
```

---

## Phase 1 E2E 테스트 절차

1. `ocx start` → 서버 :10100 기동 확인
2. `curl http://localhost:10100/healthz` → `{"status":"ok"}` 확인
3. Codex config.toml에 opencodex 프로바이더 추가
4. `codex "hello world를 출력하는 Python 코드"` → opencode-go 경유 응답 확인
5. `ocx stop` → graceful shutdown 확인
