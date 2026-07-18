# Assistant Scroll Invariants

This document captures chat auto-scroll behavior that must not regress for
`SidecarAssistant` and `SideBySideAssistant`.

## Hybrid Rule

- Short fresh cards stay bottom-oriented.
- Tall fresh cards are top-anchored.

## Tall Card Anchor Invariant

For tall card flows (for example, PDP card and PDP+NBA combinations), the first
tall fresh node must land at:

- `chatContainerTop + 16px`

This prevents the top of tall cards from hiding behind the assistant header.

## Implementation Constants

Both assistants use the same constants:

- `TALL_CARD_TOP_INSET_PX = 16`
- `TALL_CARD_VIEWPORT_RATIO = 0.92`
- `TALL_CARD_ANCHOR_RATIO = 0.6`
- `TALL_CARD_SETTLE_TIMEOUT_MS = 140`

## Stability On Mobile

To prevent iPhone/Safari late-layout drift, tall-card alignment uses:

- immediate `behavior: "auto"` scroll,
- multi-frame `requestAnimationFrame` re-alignment,
- timeout-based settle pass,
- image `load/error` re-alignment hooks.

## Platform Mode Isolation Contract

Platform switching is explicit and must be mode-isolated:

- `html[data-demo-viewport="desktop"]` means desktop-native behavior.
- `html[data-demo-viewport="mobile"]` means mobile-native behavior.
- The `data-demo-viewport` attribute is always present; desktop is not inferred
  by attribute absence.

Header/nav and overlay anchoring rules must follow the same contract:

- desktop-only behavior lives under desktop selectors,
- mobile-only behavior lives under mobile selectors,
- mobile fixes must never leak into desktop mode.
