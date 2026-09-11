# Mobile Unification — Test Plan (phases 1–3)

Scope: mobile viewports only (390–440px). Desktop (1280px) is regression-only.
Branch: `feat/mobile-unify-phase1`. Local stack: web **3002**, bridge 8794, worker 8795, peer 60758.

## Ground rules (all phases)

- `bun test` — 0 fail (pre-existing react-missing failures must not exist; run `bun install` in worktree first).
- `bun run build` — clean (typecheck + prod).
- E2E keep-green strings (do not rename/remove without updating `e2e/`):
  - `Search the network` (`e2e/transfers.spec.ts:254`)
  - `Downloads` heading + `/Monitoring \d+ connections/` (`:268-269`)
  - `Network Throughput` / `Real-time Bandwidth` (`:274-275`)
  - `empty-downloads` + `Search Files`, `empty-uploads` (`:305-306,326-328`; note `Queue remains inspectable` assert is already stale)
  - `Latest messages`, `max-h-[5%]`, menu labels `Browse Shares / View User Profile / Send Message` (`e2e/chat.spec.ts`)
  - `Search` heading-first (`e2e/contextmenu-keyboard.spec.ts:87`)
- Unit keep-green: `lib/mobile-help.test.ts` (Phase 2 may extend, not break).
- Playwright @440×796 every page below, at rest + scrolled: header gap ≤4px, sticky bars stick at 60px, no horizontal overflow (`document.scrollingElement.scrollWidth <= innerWidth`).

## Phase 1 — foundation (this branch)

Covers: overflow-x-clip on page-scroll mains (buddies, files, up/down, stats, settings, diagnostics);
EmptyState (page-level) + CompactEmpty (inline) + migrate 6 page empties (strings/testids preserved);
SectionLabel token on span/p (fix h-as-label order); card token + modal dark parity;
dark parity (browse/profile sticky, tab pills ×3, FilterBar/SearchBar inputs, transfer darks,
controls.tsx:96 input, shell alphas); min-h-11 extended audit (tab pills via padding, diag toolbar,
history pills, wishlist add, buddies icons, bulk bars, diag/worker selects, BrowseView:529,
PluginsSection inputs); inputs text-base md:text-sm; aria-hidden icons, role=status page empties;
TopBar subtitle spec + title match; settings H1 hidden on mobile; chat/private drifts to chat values;
stale demo pt-56 selector removed.

### Touch standard (two-tier, decided during implementation)

- Tier 1 controls (44px `min-h-11`): buttons, text inputs, selects, textareas, rows, tab pills.
- Tier 2 chips (36px `min-h-9`): tab-pill close buttons (`h-8 w-8`), sort/group/expand selects,
  history pills, level pills, diag toolbar buttons, bulk-bar Clear, inline text actions exempt
  (hit area via padding, no layout height).
- Text inputs/selects/textareas: `text-base md:text-sm` (iOS focus-zoom guard).

| Page | Rest | Scrolled | Notes |
|---|---|---|---|
| /search empty | card 4px under header, scope pill, wishlist collapsed, bubbles | sticky sticks @60 | history pills if any |
| /search tabs | tabs row, count bar, selects | filter open state | — |
| /browse empty | flush bar, compact empty card, recents | — | — |
| /browse user | tabs + tree | inner scroll, bar stays | needs bridge data or demo |
| /profile empty | lookup row, avatar button, tabs persist bubble | — | — |
| /profile user | pill collapsed, profile header | sticks @60 | — |
| /buddies | list, headings, icon buttons ≥44px | — | clip overflow |
| /downloads | sections, cards, empty `empty-downloads` | toolbar scrolls (Phase 2) | speeds visible |
| /uploads | sections, empty `empty-uploads` | — | — |
| /files | explorer panel, breadcrumbs | — | — |
| /statistics | panels, tiles | — | — |
| /diagnostics | cards, toolbar buttons ≥44px, log box | — | level pills wrap |
| /chat | picker rows, message list p-4, footer | messages scroll internally | — |
| /private-chat | same as chat, pill empty | — | — |
| /settings | sections, controls, no double H1 | desktop nav unaffected | H1 hidden mobile |
| /onboarding | wizard card (unchanged shell) | — | inputs ≥44px |

### Desktop 1280px regression

/search /browse /profile /chat /settings: full text visible, no collapsed pills, stickies top-0,
desktop navs intact, no console errors.

## Phase 2 — behavior (IMPLEMENTED 2026-09-11, same branch)

Chat/private picker collapse (lookup pill when room active, expand/collapse, Join/Start closes);
dead Private flag + duplicate Select-a-room removed; dl/up toolbars sticky top-60 mobile
(md:static desktop, verified sticks @60 with scrollable content); mobile download-stats strip
removed (DownloadStats renders on mobile, testid unreferenced); BulkBarShell shared
(count + Clear + actions slot, dark kept) rewiring tag/BulkBar + search bulk, behavior identical.

Chat/private picker collapse (profile lookup-pill pattern); dl/up sticky toolbars + stats-strip
dedup; BulkBar dedup (keep dark variant); extend `mobile-help.test.ts`; re-check
`e2e/chat.spec.ts` Latest-messages pill coverage + `max-h-[5%]` assert; re-check transfers
`/Monitoring/` asserts.

## Phase 3 — overlay system (separate branch)

Bottom-offset stacking spec (BottomNav sheet 68 / bulk 64 / toast 76 / MiniPlayer 76 + `,0px`
fallback bug / demo pill 76 / footer +68): single scale, collision matrix. One toast system
(keep center pill? decide). Sheet/modal z (70 vs 50 vs 100) + padding standard; kill dl/up inline
menus (use ContextMenu, keep dark); progress-bar standard (TransferCard h-1.5 + glow as base);
badge offsets (one scale); demo-banner visual language (amber vs tertiary); menu-label renames
update `e2e/chat.spec.ts:215-217,261` + contextmenu specs; progressbar count assert
(`transfers.spec.ts:286`) updated deliberately.
