# Levers — every knob, classified

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). Three tiers of reach:

1. **Config** — `settings.json` / `models.json`, no code.
2. **Extension** — reachable from the extension API, no fork.
3. **Fork** — requires editing this repo (that's what the `context-economy`
   branch is for).

The ⭐ column marks levers that matter specifically for a 10M-window,
no-prompt-caching model (cost = turns × resident tokens).

## Tier 1 — Config

| Lever | Where | Default | ⭐ 10M note |
|---|---|---|---|
| `contextWindow`, `maxTokens` per model | models.json (`model-config.ts:156-170`) | catalog / 128k fallback | ⭐ set 10_000_000 / 60_000 |
| `cost.input/output` (+ `tiers[]` by input size) | models.json (`model-config.ts:147-154`) | — | ⭐ 0.15 / 1.0 |
| `compat.*` (18 flags: strict mode, developer role, usage-in-streaming, maxTokens field name, thinking format, cacheControlFormat, …) | models.json (`model-config.ts:72-110`) | auto-detected by baseUrl | ⭐ unknown baseUrl → "standard OpenAI" bucket, no cache fields sent |
| `samplingParams` (arbitrary record, merged into body last) | models.json | — | back-door for provider-specific body fields |
| `headers` per provider/model | models.json | — | |
| `compaction.enabled / reserveTokens / keepRecentTokens` | settings.json (`settings-manager.ts:779-791`) | true / 16384 / 20000 | ⭐ reserveTokens is the ONLY trigger knob and it double-duties as summary budget — see fork tier |
| `retry.enabled / maxRetries / baseDelayMs` | settings.json (`:818-822`) | true / 3 / 2000 | ⭐ each retry re-bills full context |
| `retry.provider.timeoutMs / maxRetries / maxRetryDelayMs` | settings.json (`:839-843`) | — / — / 60000 | ⭐ raise timeoutMs ≥ 600000 for multi-M prefill |
| `httpIdleTimeoutMs` | settings.json (`http-dispatcher.ts:19-34`) | 300000 (5 min) | ⭐ parser accepts any number though the picker stops at 5 min; set ≥ 600000 |
| `PI_CACHE_RETENTION` env / `cacheRetention` stream option | `openai-completions.ts:190-198` | "short" | irrelevant on Pokee (no cache fields sent anyway) |
| steering/follow-up mode (`all` / `one-at-a-time`) | settings.json | one-at-a-time | |
| `branchSummary.reserveTokens / skipPrompt` | settings.json (`:796`) | 16384 | budget = contextWindow − reserve → huge at 10M |
| extensions/skills/prompts/themes/packages paths | settings.json (`:82-118`) | `.pi/` dirs | |

## Tier 2 — Extension API

| Lever | Hook | ⭐ 10M note |
|---|---|---|
| Rewrite outbound messages per LLM call (ephemeral view) | `context` event (`runner.ts:984`) | ⭐ sliceofpi L1 lives here. Exceptions swallowed → fails OPEN (see fork tier) |
| Rewrite raw provider JSON body | `before_provider_request` (`sdk.ts:330`) | ⭐ reaches temperature, max_tokens, tool defs, model name in body — the escape hatch for anything settings won't expose |
| Add/delete HTTP headers | `before_provider_headers` (in-place, `null` deletes) | Idempotency-Key, session affinity |
| Observe status + headers pre-body | `after_provider_response` | ⭐ 402/429/413 translation (sliceofpi does this) |
| Replace/cancel compaction entirely (own summary, own model, own cut) | `session_before_compact` | ⭐ but only fires after Pi already *decided* to compact; can't force compaction of a "too small" session, and `fromHook` breaks file-list inheritance |
| Trigger compaction programmatically | `ctx.compact()` | ⭐ turn-boundary auto-compaction on your own trigger = a cost-aware trigger without forking `shouldCompact` |
| Override system prompt per prompt; inject messages | `before_agent_start` | ⭐ shrink the system prompt itself |
| Gate/patch tool calls; rewrite tool results | `tool_call` / `tool_result` | ⭐ truncate fat outputs before they enter the transcript |
| Custom tools (+promptSnippet), slash commands, shortcuts, flags | `registerTool` / `registerCommand` / … | first registration wins; built-ins overridable |
| Whole custom provider incl. own `streamSimple` + own fetch | `registerProvider` (`types.ts:1373-1435`) | ⭐ the no-fork path to a native Pokee gateway adapter (SSE requests, size pre-flight, background mode) |
| Session-wide model/thinking switch | `setModel` / `setThinkingLevel` | not per-call |
| Widgets/status/footer, `sendMessage(deliverAs: steer/followUp/nextTurn)` | UI context | RPC proxies only select/confirm/input/editor/notify/setStatus/setWidget/setTitle |
| Persist custom state in session (in-context or not) | `appendEntry` / custom_message | restart-safe state, branch-aware |
| Resource injection (skills/prompts/themes) | `resources_discover` | |
| Subagents | example only: spawn `pi` subprocesses (`examples/extensions/subagent/`, 1015 ln) | ⭐ the pattern for sliceofpi's future subagent mgmt |

## Tier 3 — Fork (the `context-economy` shortlist)

| Lever | Where | Why it matters at 10M |
|---|---|---|
| **Split `reserveTokens`'s two jobs** (trigger headroom vs summary maxTokens `0.8×reserve` vs branch budget `window−reserve`) | `compaction.ts:637`, `branch-summarization.ts:312` | ⭐⭐ the single biggest config landmine: you cannot set an economic trigger without breaking summaries |
| **Cost-aware `shouldCompact`** (marginal $/turn, growth rate) | `compaction.ts:235-238`, called from private `_checkCompaction` (`agent-session.ts:1962`) | ⭐⭐ pure-headroom rule never fires at 10M; no hook consulted on the *decision* |
| **Fail-closed `context` handler errors** | `runner.ts:1000-1010` | ⭐⭐ ~5-line change: a crashed cost-control extension currently sends the full context at full price |
| **Re-billing metric to replace cache-stats** (resident × price × turns; "Re-billed" line) | `cache-stats.ts`, `footer.ts:129-146`, `interactive-mode.ts:6035-6049` | ⭐⭐ current module structurally reports 0 on no-cache providers — measures the opposite of what matters |
| **Pre-flight request cost/size check** (estimate body bytes + $ before send; refuse/warn at 45MiB) | request build in `openai-completions.ts:236-253` | ⭐ no size awareness exists at all |
| **Streamed / SSE request bodies** | SDK `create()` call; or bypass via custom `fetch` | ⭐ Pokee requires SSE >16MiB; body is one buffered JSON.stringify today |
| Per-call model override (cheap model for summaries/advice) | `sdk.ts:294` (Agent built once), no per-request auth/baseUrl switch | summarizer is always the session model at full price |
| New overflow/413 patterns for novel gateways | `overflow.ts:36-64` (file invites this) | unrecognized 413 → no compaction, no retry, raw error |
| Summarizer input truncation `TOOL_RESULT_MAX_CHARS=2000`; output budgets 0.8/0.5×reserve | `utils.ts:89`, `compaction.ts:637,937` | |
| `calculateContextTokens` counts output+cacheWrite as "context" | `compaction.ts:146` | overcounts resident tokens if you build billing on it |
| Missing compat schema fields (`supportsFinishReason`, `supportsThinkingTokenBudget`, `zaiToolStream`) | `model-config.ts:72-110` vs `types.ts:536-604` | gateway ending streams without finish_reason → hard error, and the flag can't be set from models.json |
| Retry/timeout policy as extension API; budget caps on retry & summarization spend | `sdk.ts:302-330` | retries and summaries multiply spend with no ceiling |
| `_overflowRecoveryAttempted` one-shot; hardcoded footer 70/90% colors; default tool set; file-tracking tool-name allowlist (`read/write/edit`) | various | small irritants |
| New extension events / RPC commands (both closed unions) | `types.ts:1032`, `rpc-types.ts:20` | e.g. a `before_compaction_decision` event, an RPC `get_cost_forecast` |
| In-process subagents | none exists | process-spawn is the only pattern today |

## Priorities for the context-economy branch

Ranked by value ÷ effort:

1. **Fail-closed `context` errors** — tiny, pure safety.
2. **Split `reserveTokens`** (`compaction.summaryMaxTokens` setting) — unlocks
   config-level economic triggers for everyone upstream, PR-able.
3. **Cost-aware trigger** — add a `compaction.maxResidentTokens` (absolute)
   consulted in `shouldCompact`; upstream-friendly shape.
4. **Re-billing metric** — new module beside cache-stats + footer line;
   the "context is expensive" thesis made visible in stock Pi.
5. **Pre-flight size/cost check + overflow patterns** — makes 45MiB cliffs
   and 402s first-class instead of raw errors.
6. **SSE request bodies / native Pokee adapter** — biggest lift; prototype as
   an extension `registerProvider` with a custom fetch first, fork only if
   the SDK fights back.

Note what does **not** need the fork: sliceofpi already covers per-call
trimming, recall, deterministic compaction, tier advice, and error
translation entirely at Tier 2 — and `before_provider_request` +
`registerProvider` cover more of the roadmap (outbound-prompt manipulation,
native gateway handling) than we assumed when the fork was created.
