# Cap'n Web client binding spike

A separate version of the client-capability spike using [Cap'n Web](https://github.com/cloudflare/capnweb) for symmetric, object-capability RPC.

It demonstrates a server extension invoking a typed client binding without knowing whether the originating client is a TUI or browser. The TUI renders notifications in yellow. The browser displays them centrally and dramatically spins them away.

## Architecture

```text
browser/TUI exports ClientBindingApi       server exports ServerApi
┌──────────────────────────────┐          ┌───────────────────────────┐
│ event(event)                 │◀─────────│ prompt(text)              │
│ notify({ message })          │─────────▶│ command(name, input)      │
└──────────────────────────────┘ Cap'n Web└───────────────────────────┘
             ▲                                  │
             │                                  ▼
             └──── originating-client stub ─ notify extension
                                                ├─ notify command
                                                ├─ notify LLM tool
                                                └─ exact-Paris hook
```

Every WebSocket connection is a symmetric Cap'n Web session:

- The server exports a connection-scoped `ServerApi` as its main RPC interface.
- The client exports `ClientBindingApi` as its main RPC interface.
- The client calls `connect()` with binding IDs and versions.
- The server retains that connection's remote client stub.
- A prompt arrives through the connection-scoped server object, so the originating client is known without trusting a caller-supplied client ID on every call.
- Commands, tools, and hooks call `context.clientBindings.notify()`. Cap'n Web handles reverse invocation, request correlation, promise resolution, and remote errors.

Pi still owns semantic concerns that Cap'n Web does not provide: binding names and versions, originating-client selection, runtime validation, timeouts, and extension-to-tool exposure. TypeBox validates RPC values because Cap'n Web's TypeScript interfaces do not perform runtime validation.

Unlike the HTTP/SSE spike, prompts, events, commands, and client binding calls all use one WebSocket. Plain HTTP only serves the static browser files.

This remains a local spike. Authentication, persistent sessions, reconnect replay, controller leases, and production authorization are intentionally omitted. Cap'n Web is also currently described by its maintainers as experimental.

## Install

The experimental dependencies are isolated from the coding-agent package:

```bash
npm install --prefix packages/coding-agent/examples/capability-capnweb-spike --ignore-scripts
```

## Run

From the repository root:

```bash
OPENAI_API_KEY=... npm run server --prefix packages/coding-agent/examples/capability-capnweb-spike
```

The default model is `openai/gpt-5.4-nano`. Select another registered OpenAI or Anthropic model with:

```bash
PI_CAPNWEB_SPIKE_MODEL=anthropic/claude-haiku-4-5 ANTHROPIC_API_KEY=... \
  npm run server --prefix packages/coding-agent/examples/capability-capnweb-spike
```

The server starts without provider credentials, which is enough to exercise direct binding calls. LLM prompts require the selected provider's environment credential.

Open [http://127.0.0.1:8788](http://127.0.0.1:8788) for the browser client.

In another terminal, run the TUI:

```bash
npm run tui --prefix packages/coding-agent/examples/capability-capnweb-spike
```

Try the direct binding path:

```text
/notify TUI binding confirmed.
```

Or prompt the model:

```text
Notify me that Cap'n Web works, then briefly explain what happened.
```

When multiple clients are connected, notifications target only the client that submitted the prompt.

For a deterministic extension-initiated call without an LLM tool call, ask:

```text
What is the capital of France?
```

The system prompt makes the assistant answer exactly `Paris`. The extension observes that completed response and calls the originating client's `notify()` binding with `❤️`.

## Files

- `protocol.ts`: shared TypeScript RPC interfaces, binding metadata, and TypeBox schemas
- `binding-registry.ts`: connected-client routing, negotiation, validation, timeout, and stub invocation
- `extension.ts`: binding-facing command, LLM tool, and exact-`Paris` response hook
- `server.ts`: `AgentHarness`, HTTP static server, and connection-scoped Cap'n Web APIs
- `ws-transport.ts`: typed adapter between Node's `ws` server and `RpcSession`
- `tui.ts`: Cap'n Web TUI client
- `web/`: static Cap'n Web browser client
- `package.json`: isolated, exact-version Cap'n Web and WebSocket dependencies
