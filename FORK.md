# pi10m: upstream resync review

This fork accompanies [sliceofpi](https://github.com/CrazyDubya/sliceofpi) and preserves research into 10M-token context economics.

## This branch

This is a **review candidate**, not an installed upgrade or a claim that every historical fork feature has been ported.

- Upstream source baseline: `earendil-works/pi` commit `9e41f176d0d5406e10f8abe924e90e0a66922329`, whose coding-agent package declares `1.5.1`.
- This is a frozen source commit selected for existing source-specific review. It is **not** the `v1.5.1` release tag, and is not described as current upstream HEAD.
- The merge has the previous fork main (`b49050d3603d152699b508d24c4e3adc13dc9ba2`) and the upstream baseline as parents. Both histories remain reachable. The candidate chooses upstream's tree for code, dependencies, workflows and configuration, with only this file and the two historical guides retained as fork documentation.
- `guides/ARCHITECTURE.md` and `guides/LEVERS.md` are preserved byte-for-byte from the previous fork main. Their file/line references describe an older Pi version and must not be read as current API documentation.
- `context-economy` and every other existing branch remain untouched. No branch deletion, main rewrite, force push, merge to main, package publication or installation is part of this review.

## Carry-forward decision

Keep upstream behavior and dependency locks as the baseline. Do not replay obsolete whole-lock changes or port old runtime features just because they exist in history.

| Historical work | Treatment in this candidate |
| --- | --- |
| Context-economy guides and commit history | Preserved as research history, not current implementation claims |
| Client capability bindings, harness-v2, developer-message role, shared schemas and session loadouts | Remain in history for a separate consumer-driven design review; not overlaid on modern upstream APIs |
| Theme, repaint, cursor, autocomplete, padding and Windows bootstrap changes | Not carried into the candidate runtime |
| Vendored HTTP/Bedrock proxies | Not carried; upstream dependencies and behavior retained |
| pi.dev OAuth, session sharing and activity sync additions from the fork | Not carried or enabled by this candidate; no account login or data transfer performed |
| Async read-path resolver and later-stage cancellation guards | Kept out until a real injected remote-read consumer needs them; separate targeted evidence does not establish full release compatibility |
| Truncated tool-call argument handling | Source review found the upstream guard already present; no duplicate port |

## Evidence boundary

Earlier targeted work exercised selected upstream lifecycle behavior and a separate optional read-hook/guard candidate. Those narrow checks are not a full build or test of this complete resync tree. The optional hook is not included here. No new dependency installation, benchmark, model inference, full test suite or release qualification was run for this branch.

The review commit uses `[skip ci]` to avoid automatically replaying build/test workflows. Required checks may remain pending. Before adoption, review this large source transition, qualify the exact selected tree for the intended runtime, and review upstream automation, publishing destinations and dependencies. Existing installed Pi is not changed by opening this PR.

Upstream's README and license remain [README.md](README.md) and [LICENSE](LICENSE).
