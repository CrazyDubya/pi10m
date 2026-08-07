# pi10m — a fork of Pi for 10M-token context economics

This is a fork of [earendil-works/pi](https://github.com/earendil-works/pi)
maintained as a companion to
[sliceofpi](https://github.com/CrazyDubya/sliceofpi), a Pi extension that
manages context cost on true 10M-token-context models (Pokee-Isaac 28B:
flat per-token pricing, no prompt caching — every turn re-buys the resident
context).

The fork serves two purposes, one per branch:

- **`main`** — a clean mirror of upstream, used as a reading reference for
  building sliceofpi (compaction engine, extension event dispatch, provider
  layer). No experimental commits land here; it is refreshed with
  `git fetch upstream && git merge upstream/main`. The only local addition
  is this file.
- **`context-economy`** — a long-term experimental branch exploring
  "context is expensive" below the extension surface: things an extension
  cannot reach, such as native SSE/background-mode support for the Pokee
  gateway in the provider layer, per-request cost accounting inside the
  request builder, and cost-aware compaction. Anything proven here is a
  candidate for an upstream PR or a back-port into sliceofpi where the
  extension API can carry it.

Upstream's own README is [README.md](README.md). Upstream license applies
to all upstream code; see [LICENSE](LICENSE).
