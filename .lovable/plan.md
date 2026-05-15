## Tier restructure

Move flood risk, schools, crime, broadband, transport and full sold-price history from Buyer Pass into the Single Report tier. Add two new PropertyData-backed sections. Buyer Pass becomes purely additive (chat, growth detail, demographics, compare, dashboard, email).

## Results page (`src/routes/results.tsx`)

**Gating helper.** Internally use three states derived from `access.level`:
- `tierFree` (`none` / `expired`)
- `tierSingle` (`single`)
- `tierPass` (`pass`)

Replace the `isBuyerPass` prop on `FloodRiskSection`, `NearbySchoolsSection`, `CrimeSection`, `BroadbandSection`, `TransportSection` with `unlocked: boolean` (true for single + pass) plus an `onUpgrade` that points to **Single Report checkout** for free users (not Buyer Pass). The locked teaser copy changes to "Unlock with a Single Report — £4.99".

**Render rules.**
- Render flood / schools / crime / broadband / transport sections for ALL users. Free → locked teaser. Single + Pass → full data.
- Buyer Pass extras fetch (`fetchBuyerPassExtras`) keeps working for pass users; add a parallel single-tier path so Single Report users also see this data — already populated by the analyse-listing edge function from PropertyData, so no new fetch is needed; just lift the gate.
- AI chat stays Pass-only. Update its locked teaser copy to "Unlock with Buyer Pass — £24.99".

**Two new sections (visible to Single + Pass; teaser for Free).**

a. `PriceHistorySection` — reads `a.propertyData?.soldPrices`. Renders a table: date, price, type, address. Single + Pass see up to 10 rows. Free see last 3 rows then a blurred overlay "Unlock with a Single Report — £4.99". Footer: "Source: Land Registry via PropertyData".

b. `CapitalGrowthSection` — reads `a.propertyData?.growth`.
- Free + Single → headline only ("+12.3% over 5 years").
- Pass → full 1yr / 3yr / 5yr breakdown plus area commentary.
- Single sees an inline "Upgrade to Buyer Pass for full 1/3/5yr breakdown →" hint.

**Inline placement order** (after EPC / Area context, before paywall for free):

```text
Score → Metrics → Seller motivation (paid) → EPC → Area → Planning ref →
Auction → Red flags → Viewing checklist →
[Free paywall here] →
True cost → Negotiation → Renovation →
Flood → Schools → Crime → Broadband → Transport →
Price history → Capital growth →
AI chat (pass) / AI locked teaser (single) →
Inline Buyer Pass upgrade (single only)
```

**Inline Buyer Pass upgrade card** (`InlineBuyerPassUpgrade`) — rewrite features to Pass-exclusive only:
- Unlimited analyses for 90 days
- AI chat on every property
- Capital growth (1yr/3yr/5yr breakdown)
- Area demographics
- Compare properties side by side
- All reports saved to dashboard
- Report emailed to you

**Inline pricing cards** (`PlanCard` block ~line 1765) — update both feature lists per spec.

## Pricing page (`src/routes/pricing.tsx`)

Replace both `Plan` `features` arrays with the spec lists (Single Report 13 items; Buyer Pass 7 "plus" items). Update upsell/SEO copy to mention Single Report includes flood, schools, crime, broadband, transport, sold price history.

## Data sources

All gated data already exists:
- Flood, schools, crime, broadband → already populated by analyse-listing edge function from PropertyData (mapped onto `a.floodRisk`, `a.nearbySchools`, `a.crime`, `a.broadband`).
- `a.propertyData.soldPrices` / `.growth` → already stored on the analysis JSON.
- Transport → existing field on the analysis.

No new server functions, no migration, no payment changes.

## Out of scope (explicitly unchanged)

- Stripe price IDs, checkout, webhook
- `access.functions.ts` access check logic
- Auth flows
- Buyer Pass entitlements server-side
- AI chat behaviour

## Test pass after changes

1. Open a results URL as anonymous → confirm flood/schools/crime/broadband/transport show locked teasers with "Unlock with a Single Report — £4.99", price history shows 3 blurred rows.
2. Single Report URL token → confirm those five sections render full data, price history shows 10 rows, capital growth shows headline only with Pass upsell hint, AI chat shows Pass teaser with "£24.99".
3. Buyer Pass logged-in → confirm capital growth shows full 1/3/5yr breakdown and AI chat is live.
4. `/pricing` and inline pricing cards on free results page reflect new feature lists.