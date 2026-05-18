## Goal

Roll out the new homepage design language (Playfair Display + Inter, cream `#F1EFE8` / paper `#FFFDF9`, forest green `#2D6A4F`, dark `#1A1108`, 0.5px borders, 16px cards, 100px pill buttons) across every other page and shared component. Visual-only — no routing, checkout, analysis, or data-fetching changes.

## Approach

1. **Load fonts globally** in `src/routes/__root.tsx` (Playfair Display 400/500 + italic 400, Inter 300/400/500 via Google Fonts `<link>`), and add CSS custom properties `--font-display: "Playfair Display"` and `--font-sans: "Inter"` in `src/styles.css` so existing `h1/h2/h3` automatically pick up the serif and body text picks up Inter. Update the `@theme` block accordingly.
2. **Shared chrome** (`src/components/site-chrome.tsx`): tighten `SiteHeader` styling (already close — verify spacing, Inter weights, pill button), keep `SiteFooter` aligned to homepage spec (cream top disclaimer band, dark footer with logo dot + wordmark, links right). Disclaimer bar component stays a no-op.
3. **Reusable visual primitives**: introduce small helpers (only if needed) for eyebrow label, paper card, pill button — but prefer inline styles consistent with `routes/index.tsx` so we don't fight the existing shadcn tokens.
4. **Page-by-page rewrites** (visual only, preserving every hook, server-fn call, and handler):
   - `src/routes/pricing.tsx` — dark `#1A1108` section, two-card layout mirroring homepage pricing block.
   - `src/routes/results.tsx` — property header card, forest-green conic score, Playfair section headings, paper cards w/ 0.5px borders; rebuild loading screen (cream bg, serif heading, Inter 300 subtext); rebuild paywall gate to match dark pricing block; update error/empty states.
   - `src/routes/dashboard.tsx` — "My Reports" Playfair 38px heading, paper cards w/ 0.5px borders, forest score badges, serif empty state.
   - `src/routes/my-reports.tsx` + `src/routes/my-report.tsx` — same card/heading treatment as dashboard.
   - `src/routes/faq.tsx` — Playfair heading + clean accordion using paper cards.
   - `src/routes/about.tsx` — editorial rewrite (serif heading, Inter 300 body, generous whitespace).
   - `src/routes/privacy.tsx` + `src/routes/terms.tsx` — Playfair heading, Inter 300 body, single `#FFFDF9` card wrapper.
   - `src/routes/payment-success.tsx` — serif heading inside paper card, pill CTA.
   - `src/routes/buyer-login.tsx` — centred paper card, serif heading, Inter 300 helper text.
   - `src/routes/compare.tsx` — minimal pass to align headings/cards (not in spec but shares aesthetic).
5. **Components**:
   - `src/components/upsell-pass-modal.tsx` — Playfair heading, paper card style, forest pill CTA.
   - `src/router.tsx` `GlobalErrorPage` — match new error card aesthetic.
6. **Mobile**: keep existing responsive utilities; verify single-column stacking under 768px where new grids are introduced.

## Constraints and non-goals

- Do not modify: `client.ts`, `client.server.ts`, `types.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `.env`, `supabase/config.toml`, `src/routeTree.gen.ts`.
- Do not touch business logic in any server function, checkout flow, or analysis pipeline.
- Severity colours (red flags / amber warnings) stay unchanged.
- Keep `src/routes/index.tsx` exactly as it is (already the source of truth).

## Technical details

- Fonts loaded once via `__root.tsx` `head().links` so SSR emits `<link rel="preconnect">` + stylesheet.
- In `src/styles.css`: set `--font-display: 'Playfair Display', Georgia, serif;` and `--font-sans: 'Inter', system-ui, sans-serif;`. Update the `h1..h6` rule to `font-family: var(--font-display); font-weight: 400;`. Adjust `body` to `font-weight: 300;` for editorial feel where appropriate (or keep 400 and apply 300 per-page).
- Eyebrow utility (inline): `style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#2D6A4F' }}`.
- Paper card: `background: '#FFFDF9'; border: '0.5px solid rgba(26,17,8,0.1); borderRadius: 16`.
- Inner metric card: `background: '#F1EFE8'; borderRadius: 10`.
- Primary pill: `background: '#2D6A4F'; color: '#FFFDF9'; borderRadius: 100; padding: '12px 22px'; fontFamily: Inter; fontWeight: 500; fontSize: 14`.
- Secondary pill: transparent, `border: '0.5px solid #1A1108'`, `color: '#1A1108'`, same radius/padding.
- Dark pricing band: full-bleed section with `background: '#1A1108'`, paper cards inside, forest green featured tier (`#2D6A4F`).
- Results loading screen rebuilt as cream full-height container with Playfair heading "Building your vett report" + Inter 300 subtext + existing progress text retained.

## Verification

- After edits, sweep each route to confirm: serif headings render, no shadcn defaults leaking generic Inter-only typography, pricing/paywall consistent, mobile breakpoint stacks correctly.
- Run build to surface any TS/JSX issues.
