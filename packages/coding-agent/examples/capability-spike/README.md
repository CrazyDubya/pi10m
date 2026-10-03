# Client capability spike

A deliberately small server/client spike built on the new `AgentHarness` API. It demonstrates that a server extension can invoke one semantic client action without knowing whether the originating client is a TUI or a browser.

## Architecture

```text
notify extension ─┬─ notify tool ───────┐
                  ├─ notify command ────┤
                  └─ response hook ─────┼─ pi.notify@1 ── originating client
                                        │
AgentHarness ─── shared in-memory session
```

The clients dynamically advertise `pi.notify@1` after connecting. Registrations are scoped to the SSE connection and disappear on disconnect. The model-facing tool, direct command, and assistant-response event hook call the same extension function and capability registry.

The transport is intentionally plain HTTP plus server-sent events:

- SSE carries session events and server-to-client action requests.
- HTTP requests carry prompts, capability registration, and action results.
- The server also serves the static web client, so a Cloudflare Worker is unnecessary for this local spike.

This only prototypes the capability boundary. Authentication, persistent sessions, client-controller leases, reconnect replay, and a production protocol are intentionally omitted.

## Run

From the repository root:

```bash
OPENAI_API_KEY=... npx tsx packages/coding-agent/examples/capability-spike/server.ts
```

The default model is `openai/gpt-5.4-nano`. Select another registered OpenAI or Anthropic model with:

```bash
PI_SPIKE_MODEL=anthropic/claude-haiku-4-5 ANTHROPIC_API_KEY=... \
  npx tsx packages/coding-agent/examples/capability-spike/server.ts
```

The server starts without provider credentials, which is enough to exercise direct capability calls. LLM prompts require the selected provider's environment credential.

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) for the web client.

In another terminal, run the TUI client:

```bash
npx tsx packages/coding-agent/examples/capability-spike/tui.ts
```

Try:

```text
/notify TUI capability confirmed.
```

Or prompt the model:

```text
Notify me that the capability RPC works, then briefly explain what happened.
```

When both clients are connected, a notification requested by a prompt is delivered only to the client that submitted that prompt.

For a deterministic extension-initiated action that does not use the tool wrapper, ask:

```text
What is the capital of France?
```

The server system prompt makes the assistant answer exactly `Paris`. The extension observes the completed assistant message and invokes `pi.notify@1` with `❤️` on the originating client.

## Files

- `server.ts`: HTTP/SSE server and `AgentHarness` session
- `extension.ts`: server extension with the command, model-facing tool, and assistant-response hook
- `capability-registry.ts`: connection-scoped action registration and invocation
- `protocol.ts`: typed `pi.notify@1` input/output contract and wire events
- `tui.ts`: readline client whose notify implementation prints yellow text
- `web/`: static browser client with the spinning notification animation
