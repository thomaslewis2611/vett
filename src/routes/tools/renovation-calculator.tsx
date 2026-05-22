import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { buildPageMeta, buildCanonicalLink, jsonLdScript, SITE_URL, DEFAULT_OG_IMAGE, canonicalUrl } from "@/lib/seo";

// ── Design tokens ─────────────────────────────────────────────────────────────
const HEADING = "'Playfair Display', Georgia, serif";
const BODY = "'Inter', -apple-system, sans-serif";
const C = {
  bg: "#F1EFE8",
  card: "#FFFDF9",
  dark: "#1A1108",
  green: "#2D6A4F",
  greenTint: "#EAF3DE",
  muted: "#5F5E5A",
  veryMuted: "#888780",
  border: "rgba(26,17,8,0.12)",
};

// ── Types ─────────────────────────────────────────────────────────────────────
type PropType = "flat" | "terrace" | "semi" | "detached";
type Region = "london" | "southeast" | "england" | "scotwales";
type CategoryId =
  | "kitchen"
  | "bathroom"
  | "loft"
  | "side"
  | "rear"
  | "rewire"
  | "boiler"
  | "windows"
  | "refurb";

interface CalcState {
  prop: PropType;
  region: Region;
  activeItems: Set<CategoryId>;
  kitchen_size: "small" | "medium" | "large";
  kitchen_layout: boolean;
  bathroom_count: "1" | "2" | "3";
  bathroom_plumbing: boolean;
  loft_type: "velux" | "dormer" | "mansard";
  loft_ensuite: boolean;
  side_width: "narrow" | "standard" | "wide";
  side_openplan: boolean;
  rear_size: "small" | "medium" | "large";
  rear_storeys: "single" | "double";
  rewire_beds: "1" | "2" | "3" | "4" | "5";
  boiler_type: "combi" | "system" | "heatpump";
  boiler_rads: boolean;
  windows_count: number;
  windows_material: "upvc" | "aluminium" | "timber";
  refurb_spec: "budget" | "mid" | "high";
  refurb_sqft: number;
}

interface ItemCost {
  id: CategoryId;
  label: string;
  mid: number;
  low: number;
  high: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "kitchen", label: "Kitchen renovation" },
  { id: "bathroom", label: "Bathroom renovation" },
  { id: "loft", label: "Loft conversion" },
  { id: "side", label: "Side return extension" },
  { id: "rear", label: "Rear extension" },
  { id: "rewire", label: "Full rewire" },
  { id: "boiler", label: "New boiler / heating" },
  { id: "windows", label: "New windows" },
  { id: "refurb", label: "Full refurbishment" },
];

const REGION_MULTIPLIER: Record<Region, number> = {
  london: 1.35,
  southeast: 1.22,
  england: 1.0,
  scotwales: 0.88,
};

const REGION_LABELS: Record<Region, string> = {
  london: "London",
  southeast: "South East",
  england: "Rest of England",
  scotwales: "Scotland & Wales",
};

const PROP_LABELS: Record<PropType, string> = {
  flat: "Flat",
  terrace: "Terrace",
  semi: "Semi-detached",
  detached: "Detached",
};

const WINDOW_DEFAULTS: Record<PropType, number> = { flat: 4, terrace: 8, semi: 11, detached: 14 };
const REFURB_SQM_DEFAULTS: Record<PropType, number> = { flat: 55, terrace: 80, semi: 100, detached: 140 };

// ── Default state ─────────────────────────────────────────────────────────────
function defaultState(): CalcState {
  return {
    prop: "semi",
    region: "england",
    activeItems: new Set(),
    kitchen_size: "medium",
    kitchen_layout: false,
    bathroom_count: "1",
    bathroom_plumbing: true,
    loft_type: "dormer",
    loft_ensuite: false,
    side_width: "standard",
    side_openplan: false,
    rear_size: "medium",
    rear_storeys: "single",
    rewire_beds: "3",
    boiler_type: "combi",
    boiler_rads: false,
    windows_count: 0,
    windows_material: "upvc",
    refurb_spec: "mid",
    refurb_sqft: 0,
  };
}

// ── URL serialisation ─────────────────────────────────────────────────────────
function paramsToState(params: URLSearchParams): CalcState {
  const s = defaultState();
  const p = params.get("prop");
  if (p && ["flat", "terrace", "semi", "detached"].includes(p)) s.prop = p as PropType;
  const r = params.get("region");
  if (r && ["london", "southeast", "england", "scotwales"].includes(r)) s.region = r as Region;
  const items = params.get("items");
  if (items) {
    const valid = CATEGORIES.map((c) => c.id);
    const ids = items.split(",").filter((id) => valid.includes(id as CategoryId));
    s.activeItems = new Set(ids as CategoryId[]);
  }
  const ks = params.get("kitchen_size");
  if (ks && ["small", "medium", "large"].includes(ks)) s.kitchen_size = ks as "small" | "medium" | "large";
  if (params.has("kitchen_layout")) s.kitchen_layout = params.get("kitchen_layout") === "1";
  const bc = params.get("bathroom_count");
  if (bc && ["1", "2", "3"].includes(bc)) s.bathroom_count = bc as "1" | "2" | "3";
  if (params.has("bathroom_plumbing")) s.bathroom_plumbing = params.get("bathroom_plumbing") === "1";
  const lt = params.get("loft_type");
  if (lt && ["velux", "dormer", "mansard"].includes(lt)) s.loft_type = lt as "velux" | "dormer" | "mansard";
  if (params.has("loft_ensuite")) s.loft_ensuite = params.get("loft_ensuite") === "1";
  const sw = params.get("side_width");
  if (sw && ["narrow", "standard", "wide"].includes(sw)) s.side_width = sw as "narrow" | "standard" | "wide";
  if (params.has("side_openplan")) s.side_openplan = params.get("side_openplan") === "1";
  const rs = params.get("rear_size");
  if (rs && ["small", "medium", "large"].includes(rs)) s.rear_size = rs as "small" | "medium" | "large";
  const rst = params.get("rear_storeys");
  if (rst && ["single", "double"].includes(rst)) s.rear_storeys = rst as "single" | "double";
  const rb = params.get("rewire_beds");
  if (rb && ["1", "2", "3", "4", "5"].includes(rb)) s.rewire_beds = rb as "1" | "2" | "3" | "4" | "5";
  const bt = params.get("boiler_type");
  if (bt && ["combi", "system", "heatpump"].includes(bt)) s.boiler_type = bt as "combi" | "system" | "heatpump";
  if (params.has("boiler_rads")) s.boiler_rads = params.get("boiler_rads") === "1";
  const wc = parseInt(params.get("windows_count") ?? "0");
  if (!isNaN(wc) && wc >= 0) s.windows_count = wc;
  const wm = params.get("windows_material");
  if (wm && ["upvc", "aluminium", "timber"].includes(wm)) s.windows_material = wm as "upvc" | "aluminium" | "timber";
  const rspec = params.get("refurb_spec");
  if (rspec && ["budget", "mid", "high"].includes(rspec)) s.refurb_spec = rspec as "budget" | "mid" | "high";
  const rsqft = parseInt(params.get("refurb_sqft") ?? "0");
  if (!isNaN(rsqft) && rsqft >= 0) s.refurb_sqft = rsqft;
  return s;
}

function stateToParams(s: CalcState): string {
  const p = new URLSearchParams();
  p.set("prop", s.prop);
  p.set("region", s.region);
  if (s.activeItems.size > 0) p.set("items", [...s.activeItems].join(","));
  p.set("kitchen_size", s.kitchen_size);
  p.set("kitchen_layout", s.kitchen_layout ? "1" : "0");
  p.set("bathroom_count", s.bathroom_count);
  p.set("bathroom_plumbing", s.bathroom_plumbing ? "1" : "0");
  p.set("loft_type", s.loft_type);
  p.set("loft_ensuite", s.loft_ensuite ? "1" : "0");
  p.set("side_width", s.side_width);
  p.set("side_openplan", s.side_openplan ? "1" : "0");
  p.set("rear_size", s.rear_size);
  p.set("rear_storeys", s.rear_storeys);
  p.set("rewire_beds", s.rewire_beds);
  p.set("boiler_type", s.boiler_type);
  p.set("boiler_rads", s.boiler_rads ? "1" : "0");
  if (s.windows_count > 0) p.set("windows_count", String(s.windows_count));
  p.set("windows_material", s.windows_material);
  p.set("refurb_spec", s.refurb_spec);
  if (s.refurb_sqft > 0) p.set("refurb_sqft", String(s.refurb_sqft));
  return p.toString();
}

// ── Cost calculation ──────────────────────────────────────────────────────────
function calcItemCost(id: CategoryId, s: CalcState): ItemCost {
  const rm = REGION_MULTIPLIER[s.region];
  let mid = 0;
  switch (id) {
    case "kitchen": {
      const base = { small: 10000, medium: 18000, large: 28000 }[s.kitchen_size];
      mid = base * (s.kitchen_layout ? 1.3 : 1.0);
      break;
    }
    case "bathroom": {
      const countM = { "1": 1.0, "2": 1.85, "3": 2.6 }[s.bathroom_count];
      mid = 8000 * countM * (s.bathroom_plumbing ? 1.0 : 1.3);
      break;
    }
    case "loft": {
      const base = { velux: 32000, dormer: 50000, mansard: 68000 }[s.loft_type];
      mid = base + (s.loft_ensuite ? 6000 : 0);
      break;
    }
    case "side": {
      const base = { narrow: 28000, standard: 40000, wide: 55000 }[s.side_width];
      mid = base + (s.side_openplan ? 5000 : 0);
      break;
    }
    case "rear": {
      const base = { small: 22000, medium: 38000, large: 58000 }[s.rear_size];
      mid = base * (s.rear_storeys === "double" ? 1.6 : 1.0);
      break;
    }
    case "rewire": {
      mid = { "1": 4000, "2": 5000, "3": 6000, "4": 7500, "5": 9000 }[s.rewire_beds];
      break;
    }
    case "boiler": {
      const base = { combi: 3500, system: 4500, heatpump: 12000 }[s.boiler_type];
      mid = base + (s.boiler_rads ? 3000 : 0);
      break;
    }
    case "windows": {
      const count = s.windows_count > 0 ? s.windows_count : WINDOW_DEFAULTS[s.prop];
      const matM = { upvc: 1.0, aluminium: 1.3, timber: 1.55 }[s.windows_material];
      mid = count * 700 * matM;
      break;
    }
    case "refurb": {
      const sqm = s.refurb_sqft > 0 ? s.refurb_sqft : REFURB_SQM_DEFAULTS[s.prop];
      const rate = { budget: 500, mid: 850, high: 1200 }[s.refurb_spec];
      mid = sqm * rate;
      break;
    }
  }
  mid = mid * rm;
  return {
    id,
    label: CATEGORIES.find((c) => c.id === id)!.label,
    mid: Math.round(mid / 100) * 100,
    low: Math.round((mid * 0.75) / 100) * 100,
    high: Math.round((mid * 1.35) / 100) * 100,
  };
}

function formatGbp(n: number): string {
  if (n >= 100000) {
    const rounded = Math.round(n / 1000) * 1000;
    return `£${rounded.toLocaleString("en-GB")}`;
  }
  return `£${Math.round(n / 100) * 100 === n ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB")}`;
}

// ── Shared UI components ──────────────────────────────────────────────────────
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        gap: 3,
        background: C.bg,
        borderRadius: 10,
        padding: 3,
        border: `0.5px solid ${C.border}`,
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          style={{
            fontSize: 12,
            fontWeight: value === opt.value ? 500 : 400,
            color: value === opt.value ? C.dark : C.muted,
            background: value === opt.value ? C.card : "transparent",
            border: value === opt.value ? `0.5px solid ${C.border}` : "0.5px solid transparent",
            borderRadius: 7,
            padding: "5px 12px",
            cursor: "pointer",
            transition: "all 0.1s",
            whiteSpace: "nowrap",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        background: "none",
        border: "none",
        padding: 0,
        textAlign: "left",
      }}
    >
      <div
        style={{
          width: 34,
          height: 18,
          borderRadius: 999,
          background: checked ? C.green : "rgba(26,17,8,0.18)",
          position: "relative",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#fff",
            transition: "left 0.15s",
          }}
        />
      </div>
      <span style={{ fontSize: 13, color: C.muted }}>{label}</span>
    </button>
  );
}

function AdjusterRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
  );
}

function AdjusterLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: C.veryMuted, fontWeight: 500 }}>{children}</span>;
}

function SpecNote({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12, color: C.veryMuted, margin: "8px 0 0", lineHeight: 1.5 }}>{children}</p>
  );
}

// ── Adjuster panels ───────────────────────────────────────────────────────────
function KitchenAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>Kitchen size</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]}
          value={s.kitchen_size}
          onChange={(v) => set({ kitchen_size: v })}
        />
      </AdjusterRow>
      <Toggle
        checked={s.kitchen_layout}
        onChange={(v) => set({ kitchen_layout: v })}
        label="Layout change (moving plumbing / walls)"
      />
      <SpecNote>Layout changes — moving plumbing, walls, or electrics — add around 30%.</SpecNote>
    </div>
  );
}

function BathroomAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>Number of bathrooms</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3+" }]}
          value={s.bathroom_count}
          onChange={(v) => set({ bathroom_count: v })}
        />
      </AdjusterRow>
      <Toggle
        checked={s.bathroom_plumbing}
        onChange={(v) => set({ bathroom_plumbing: v })}
        label="Keeping plumbing in same position"
      />
      <SpecNote>Keeping plumbing in place saves around 30% on total cost.</SpecNote>
    </div>
  );
}

function LoftAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>Conversion type</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "velux", label: "Velux" }, { value: "dormer", label: "Dormer" }, { value: "mansard", label: "Mansard" }]}
          value={s.loft_type}
          onChange={(v) => set({ loft_type: v })}
        />
      </AdjusterRow>
      <Toggle
        checked={s.loft_ensuite}
        onChange={(v) => set({ loft_ensuite: v })}
        label="Include en-suite bathroom"
      />
      <SpecNote>Mansard conversions typically require planning permission. En-suite adds £4k–£8k.</SpecNote>
    </div>
  );
}

function SideAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>Width</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "narrow", label: "Narrow" }, { value: "standard", label: "Standard" }, { value: "wide", label: "Wide" }]}
          value={s.side_width}
          onChange={(v) => set({ side_width: v })}
        />
      </AdjusterRow>
      <Toggle
        checked={s.side_openplan}
        onChange={(v) => set({ side_openplan: v })}
        label="Open-plan kitchen integration"
      />
    </div>
  );
}

function RearAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>Extension size</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]}
          value={s.rear_size}
          onChange={(v) => set({ rear_size: v })}
        />
      </AdjusterRow>
      <AdjusterRow>
        <AdjusterLabel>Storeys</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "single", label: "Single storey" }, { value: "double", label: "Double storey" }]}
          value={s.rear_storeys}
          onChange={(v) => set({ rear_storeys: v })}
        />
      </AdjusterRow>
    </div>
  );
}

function RewireAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>Bedrooms</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }, { value: "5", label: "5+" }]}
          value={s.rewire_beds}
          onChange={(v) => set({ rewire_beds: v })}
        />
      </AdjusterRow>
      <SpecNote>A 3-bed house typically needs 8–10 circuits.</SpecNote>
    </div>
  );
}

function BoilerAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>System type</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "combi", label: "Combi" }, { value: "system", label: "System" }, { value: "heatpump", label: "Heat pump" }]}
          value={s.boiler_type}
          onChange={(v) => set({ boiler_type: v })}
        />
      </AdjusterRow>
      <Toggle
        checked={s.boiler_rads}
        onChange={(v) => set({ boiler_rads: v })}
        label="Replace radiators"
      />
    </div>
  );
}

function WindowsAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  const defaultCount = WINDOW_DEFAULTS[s.prop];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>Number of windows</AdjusterLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={1}
            max={50}
            value={s.windows_count > 0 ? s.windows_count : defaultCount}
            onChange={(e) => {
              const n = parseInt(e.target.value);
              set({ windows_count: isNaN(n) ? 0 : Math.max(1, Math.min(50, n)) });
            }}
            style={{
              width: 70,
              padding: "6px 10px",
              fontSize: 13,
              color: C.dark,
              background: C.bg,
              border: `0.5px solid ${C.border}`,
              borderRadius: 8,
              outline: "none",
            }}
          />
          <span style={{ fontSize: 12, color: C.veryMuted }}>default {defaultCount} for {PROP_LABELS[s.prop].toLowerCase()}</span>
        </div>
      </AdjusterRow>
      <AdjusterRow>
        <AdjusterLabel>Frame material</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "upvc", label: "uPVC" }, { value: "aluminium", label: "Aluminium" }, { value: "timber", label: "Timber" }]}
          value={s.windows_material}
          onChange={(v) => set({ windows_material: v })}
        />
      </AdjusterRow>
    </div>
  );
}

function RefurbAdjusters({ s, set }: { s: CalcState; set: (u: Partial<CalcState>) => void }) {
  const defaultSqm = REFURB_SQM_DEFAULTS[s.prop];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdjusterRow>
        <AdjusterLabel>Specification level</AdjusterLabel>
        <SegmentedControl
          options={[{ value: "budget", label: "Budget" }, { value: "mid", label: "Mid" }, { value: "high", label: "High" }]}
          value={s.refurb_spec}
          onChange={(v) => set({ refurb_spec: v })}
        />
      </AdjusterRow>
      <AdjusterRow>
        <AdjusterLabel>Floor area (m²)</AdjusterLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={10}
            max={1000}
            value={s.refurb_sqft > 0 ? s.refurb_sqft : defaultSqm}
            onChange={(e) => {
              const n = parseInt(e.target.value);
              set({ refurb_sqft: isNaN(n) ? 0 : Math.max(10, Math.min(1000, n)) });
            }}
            style={{
              width: 80,
              padding: "6px 10px",
              fontSize: 13,
              color: C.dark,
              background: C.bg,
              border: `0.5px solid ${C.border}`,
              borderRadius: 8,
              outline: "none",
            }}
          />
          <span style={{ fontSize: 12, color: C.veryMuted }}>default {defaultSqm}m² for {PROP_LABELS[s.prop].toLowerCase()}</span>
        </div>
      </AdjusterRow>
    </div>
  );
}

function renderAdjusters(id: CategoryId, s: CalcState, set: (u: Partial<CalcState>) => void) {
  switch (id) {
    case "kitchen": return <KitchenAdjusters s={s} set={set} />;
    case "bathroom": return <BathroomAdjusters s={s} set={set} />;
    case "loft": return <LoftAdjusters s={s} set={set} />;
    case "side": return <SideAdjusters s={s} set={set} />;
    case "rear": return <RearAdjusters s={s} set={set} />;
    case "rewire": return <RewireAdjusters s={s} set={set} />;
    case "boiler": return <BoilerAdjusters s={s} set={set} />;
    case "windows": return <WindowsAdjusters s={s} set={set} />;
    case "refurb": return <RefurbAdjusters s={s} set={set} />;
  }
}

// ── Category card ─────────────────────────────────────────────────────────────
function CategoryCard({
  id,
  label,
  active,
  cost,
  s,
  onToggle,
  onUpdate,
}: {
  id: CategoryId;
  label: string;
  active: boolean;
  cost: ItemCost | null;
  s: CalcState;
  onToggle: () => void;
  onUpdate: (u: Partial<CalcState>) => void;
}) {
  return (
    <div
      style={{
        background: active ? "#F0F7F0" : C.card,
        border: `0.5px solid ${C.border}`,
        borderRadius: 16,
        overflow: "hidden",
        borderLeft: active ? `3px solid ${C.green}` : `0.5px solid ${C.border}`,
        transition: "background 0.15s",
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "16px 20px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              border: `1.5px solid ${active ? C.green : C.border}`,
              background: active ? C.green : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 0.12s",
            }}
          >
            {active && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 4L3.5 6.5L9 1" stroke="#FFFDF9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span style={{ fontSize: 14, fontWeight: 500, color: active ? C.green : C.dark }}>{label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {active && cost && (
            <span style={{ fontSize: 13, fontWeight: 600, color: C.green }}>
              {formatGbp(cost.mid)}
            </span>
          )}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            style={{ transform: active ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" }}
          >
            <path d="M2 4.5L7 9.5L12 4.5" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {/* Adjusters panel */}
      <div
        style={{
          maxHeight: active ? 600 : 0,
          overflow: "hidden",
          transition: "max-height 0.25s ease",
        }}
      >
        <div
          style={{
            padding: "0 20px 20px",
            borderTop: `0.5px solid ${C.border}`,
            paddingTop: 16,
          }}
        >
          {renderAdjusters(id, s, onUpdate)}
        </div>
      </div>
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({
  costs,
  state,
  onShare,
}: {
  costs: ItemCost[];
  state: CalcState;
  onShare: () => void;
}) {
  const total = costs.reduce((sum, c) => sum + c.mid, 0);
  const totalLow = costs.reduce((sum, c) => sum + c.low, 0);
  const totalHigh = costs.reduce((sum, c) => sum + c.high, 0);

  const [copied, setCopied] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleShare = () => {
    onShare();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = async () => {
    if (!email.includes("@")) return;
    setEmailStatus("sending");
    try {
      const res = await fetch("/api/renovation-estimate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          items: costs,
          total,
          region: REGION_LABELS[state.region],
          propertyType: PROP_LABELS[state.prop],
        }),
      });
      setEmailStatus(res.ok ? "sent" : "error");
    } catch {
      setEmailStatus("error");
    }
  };

  return (
    <div
      style={{
        background: C.dark,
        borderRadius: 16,
        padding: 28,
        color: C.bg,
      }}
    >
      {/* Total */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: "rgba(241,239,232,0.55)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Total mid estimate
        </div>
        <div style={{ fontFamily: HEADING, fontSize: "clamp(36px, 5vw, 52px)", fontWeight: 400, lineHeight: 1, letterSpacing: "-1px" }}>
          {formatGbp(total)}
        </div>
        <div style={{ fontSize: 13, color: "rgba(241,239,232,0.55)", marginTop: 6 }}>
          Range: {formatGbp(totalLow)} – {formatGbp(totalHigh)}
        </div>
      </div>

      {/* Breakdown */}
      <div style={{ borderTop: "0.5px solid rgba(241,239,232,0.12)", paddingTop: 16, marginBottom: 20 }}>
        {costs.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: "rgba(241,239,232,0.7)" }}>{c.label}</span>
            <span style={{ color: C.bg, fontWeight: 500 }}>{formatGbp(c.mid)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "0.5px solid rgba(241,239,232,0.12)", fontSize: 14, fontWeight: 600 }}>
          <span style={{ color: C.bg }}>Total</span>
          <span style={{ color: C.bg }}>{formatGbp(total)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          type="button"
          onClick={handleShare}
          style={{
            background: "rgba(241,239,232,0.1)",
            border: "0.5px solid rgba(241,239,232,0.25)",
            borderRadius: 100,
            padding: "11px 20px",
            fontSize: 13,
            fontWeight: 500,
            color: C.bg,
            cursor: "pointer",
            transition: "background 0.12s",
          }}
        >
          {copied ? "Copied!" : "Share my estimate"}
        </button>

        <button
          type="button"
          onClick={() => setShowEmail((v) => !v)}
          style={{
            background: "rgba(241,239,232,0.1)",
            border: "0.5px solid rgba(241,239,232,0.25)",
            borderRadius: 100,
            padding: "11px 20px",
            fontSize: 13,
            fontWeight: 500,
            color: C.bg,
            cursor: "pointer",
          }}
        >
          Email me my estimate
        </button>

        {showEmail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={{
                padding: "10px 14px",
                fontSize: 13,
                background: "rgba(241,239,232,0.08)",
                border: "0.5px solid rgba(241,239,232,0.2)",
                borderRadius: 10,
                color: C.bg,
                outline: "none",
              }}
            />
            {emailStatus === "sent" ? (
              <span style={{ fontSize: 13, color: "#5DB85A" }}>Sent! Check your inbox.</span>
            ) : emailStatus === "error" ? (
              <span style={{ fontSize: 13, color: "#E05A45" }}>Something went wrong — please try again.</span>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={emailStatus === "sending" || !email.includes("@")}
                style={{
                  background: C.green,
                  border: "none",
                  borderRadius: 100,
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#FFFDF9",
                  cursor: emailStatus === "sending" ? "wait" : "pointer",
                  opacity: !email.includes("@") ? 0.5 : 1,
                }}
              >
                {emailStatus === "sending" ? "Sending…" : "Send"}
              </button>
            )}
          </div>
        )}

        <a
          href="https://vetthome.com"
          style={{
            display: "block",
            textAlign: "center",
            background: C.green,
            border: "none",
            borderRadius: 100,
            padding: "11px 20px",
            fontSize: 13,
            fontWeight: 500,
            color: "#FFFDF9",
            textDecoration: "none",
          }}
        >
          Get a vett report →
        </a>
      </div>
    </div>
  );
}

// ── FAQ accordion ─────────────────────────────────────────────────────────────
const FAQ_ITEMS = [
  {
    q: "How much does a kitchen renovation cost in the UK in 2026?",
    a: "A kitchen renovation in the UK typically costs between £8,000 and £35,000 in 2026, depending on the size and whether the layout is being changed. A small kitchen with no layout change costs around £8,000–£12,000. A medium kitchen with new layout can reach £18,000–£25,000. London and South East projects add 20–35% to these figures.",
  },
  {
    q: "How much does a loft conversion cost in 2026?",
    a: "Loft conversion costs range from £28,000 for a basic Velux conversion up to £75,000 or more for a dormer, and £68,000–£90,000 for a Mansard conversion. Adding an en-suite adds approximately £4,000–£8,000. London projects typically cost 35% more than the national average.",
  },
  {
    q: "Does renovation cost vary by region in the UK?",
    a: "Yes, significantly. London carries a 30–35% premium over national averages due to higher labour rates and access costs. The South East adds 20–25%. Scotland and Wales are typically 10–15% below the national average. Regional labour rates are the primary driver, since material costs are broadly similar across the UK.",
  },
  {
    q: "How much does a full house rewire cost?",
    a: "A full rewire for a 3-bedroom house costs between £4,000 and £8,000 in 2026. Costs scale with the number of bedrooms and circuits: a 1-bed flat starts around £3,500, while a 5-bedroom detached house can reach £10,000 or more. Labour makes up roughly 60% of the total cost.",
  },
  {
    q: "Should I get multiple quotes for renovation work?",
    a: "Yes — always get at least 3 itemised quotes before committing to any contractor. Renovation quotes can vary by 30–50% for the same scope of work. Ask each contractor to quote against the same specification, and be wary of quotes significantly below the market rate, which often exclude VAT, professional fees, or a contingency allowance.",
  },
  {
    q: "How accurate are renovation cost calculators?",
    a: "Renovation calculators provide indicative mid-range estimates based on current market data. Actual costs depend on your property's condition, local contractor availability, specification choices, and any unforeseen structural issues. Use calculator estimates for early budgeting, then refine with 3 quotes from local tradespeople. Always add a 10–15% contingency to your budget.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderBottom: `0.5px solid ${C.border}`,
        background: open ? "#F0F7F0" : "transparent",
        borderRadius: open ? 8 : 0,
        padding: open ? "0 12px" : "0",
        margin: open ? "4px 0" : "0",
        transition: "background 0.15s, padding 0.15s, margin 0.15s",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          width: "100%",
          padding: "18px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          gap: 16,
        }}
      >
        <h3 style={{ fontFamily: BODY, fontSize: 15, fontWeight: 500, color: C.dark, margin: 0, lineHeight: 1.4 }}>
          {q}
        </h3>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{ flexShrink: 0, marginTop: 2, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" }}
        >
          <path d="M3 5.5L8 10.5L13 5.5" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Use visibility + max-height so Google indexes the text */}
      <div
        style={{
          maxHeight: open ? 400 : 0,
          overflow: "hidden",
          transition: "max-height 0.22s ease",
          visibility: open ? "visible" : "visible",
        }}
      >
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: "0 0 18px" }}>{a}</p>
      </div>
    </div>
  );
}

// ── SEO schemas ───────────────────────────────────────────────────────────────
const softwareAppSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Renovation Cost Calculator",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Free UK renovation cost calculator with regional pricing for kitchens, bathrooms, loft conversions, extensions and more.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
  url: `${SITE_URL}/tools/renovation-calculator`,
  publisher: { "@type": "Organization", name: "vett", url: SITE_URL },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

// ── Route ─────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/tools/renovation-calculator")({
  head: () => ({
    meta: buildPageMeta({
      title: "Renovation Cost Calculator UK 2026 — vett",
      description:
        "Estimate UK renovation costs for kitchens, bathrooms, loft conversions and more. Instant regional pricing with personalised adjusters. Free tool by vett.",
      canonicalPath: "/tools/renovation-calculator",
      ogImage: DEFAULT_OG_IMAGE,
    }),
    links: [buildCanonicalLink("/tools/renovation-calculator")],
    scripts: [jsonLdScript(softwareAppSchema), jsonLdScript(faqSchema)],
  }),
  component: RenovationCalculator,
});

// ── Main component ────────────────────────────────────────────────────────────
function RenovationCalculator() {
  const router = useRouter();
  const [state, setState] = useState<CalcState>(defaultState);

  // Restore from URL params on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.toString()) {
      setState(paramsToState(params));
    }
  }, []);

  // Update URL on state change. We bypass TanStack Router's patched replaceState
  // by temporarily setting _ignoreSubscribers — the same technique TanStack uses
  // internally in its flush() function — so the router never sees this as a
  // navigation event and never resets scroll position.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = stateToParams(state);
    const url = `${window.location.pathname}?${qs}`;
    const hist = (router as any).history;
    hist._ignoreSubscribers = true;
    window.history.replaceState(null, "", url);
    hist._ignoreSubscribers = false;
  }, [state, router]);

  const update = (u: Partial<CalcState>) => setState((prev) => ({ ...prev, ...u }));

  const toggleItem = (id: CategoryId) => {
    setState((prev) => {
      const next = new Set(prev.activeItems);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, activeItems: next };
    });
  };

  const handlePropChange = (prop: PropType) => {
    setState((prev) => ({
      ...prev,
      prop,
      windows_count: 0,
      refurb_sqft: 0,
    }));
  };

  const handleShare = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
  };

  const activeCosts = CATEGORIES
    .filter((c) => state.activeItems.has(c.id))
    .map((c) => calcItemCost(c.id, state));

  const selectorBtn = (active: boolean) => ({
    fontSize: 13,
    fontWeight: active ? 500 : 400,
    color: active ? C.dark : C.muted,
    background: active ? C.card : "transparent",
    border: active ? `0.5px solid ${C.border}` : "0.5px solid transparent",
    borderRadius: 100,
    padding: "8px 18px",
    cursor: "pointer",
    transition: "all 0.1s",
    whiteSpace: "nowrap" as const,
  });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: BODY, color: C.dark }}>
      <SiteHeader />

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px 80px" }}>
        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <span
            style={{
              display: "inline-block",
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: C.green,
              background: C.greenTint,
              borderRadius: 100,
              padding: "4px 12px",
              marginBottom: 16,
            }}
          >
            Free tool · vett
          </span>
          <h1
            style={{
              fontFamily: HEADING,
              fontSize: "clamp(30px, 4vw, 40px)",
              fontWeight: 400,
              color: C.dark,
              letterSpacing: "-0.5px",
              lineHeight: 1.15,
              margin: "0 0 12px",
            }}
          >
            Renovation cost calculator
          </h1>
          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, margin: 0 }}>
            Estimate UK renovation costs with regional pricing. Select the work you're planning, adjust to your spec, and get an instant indicative budget.
          </p>
        </div>

        {/* Property type selector */}
        <div style={{ marginBottom: 12, background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 4px rgba(26,17,8,0.05)" }}>
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, marginBottom: 10 }}>
            Property type
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: C.bg, borderRadius: 10, padding: 4 }}>
            {(["flat", "terrace", "semi", "detached"] as PropType[]).map((p) => (
              <button key={p} type="button" onClick={() => handlePropChange(p)} style={selectorBtn(state.prop === p)}>
                {PROP_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Region selector */}
        <div style={{ marginBottom: 28, background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 4px rgba(26,17,8,0.05)" }}>
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, marginBottom: 10 }}>
            Region
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: C.bg, borderRadius: 10, padding: 4 }}>
            {(Object.entries(REGION_LABELS) as [Region, string][]).map(([r, label]) => (
              <button key={r} type="button" onClick={() => update({ region: r })} style={selectorBtn(state.region === r)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Category cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, marginBottom: 6 }}>
            Select renovation work
          </div>
          {CATEGORIES.map((cat) => {
            const active = state.activeItems.has(cat.id);
            const cost = active ? calcItemCost(cat.id, state) : null;
            return (
              <CategoryCard
                key={cat.id}
                id={cat.id}
                label={cat.label}
                active={active}
                cost={cost}
                s={state}
                onToggle={() => toggleItem(cat.id)}
                onUpdate={update}
              />
            );
          })}
        </div>

        {/* Summary card */}
        {activeCosts.length > 0 && (
          <SummaryCard costs={activeCosts} state={state} onShare={handleShare} />
        )}

        {/* SEO prose content */}
        <div style={{ marginTop: 64 }}>
          <h2 style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 400, color: C.dark, letterSpacing: "-0.3px", margin: "0 0 16px", borderLeft: `3px solid ${C.green}`, paddingLeft: 12 }}>
            How much does renovation cost in the UK in 2026?
          </h2>
          <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
            <p style={{ margin: "0 0 16px" }}>
              Renovation costs in the UK vary significantly depending on the type of work, the size of your property, and where you live. In 2026, labour costs have risen around 12–15% above 2024 levels following sustained demand and skilled trades shortages, while material costs have largely stabilised back to 2022 levels.
            </p>
            <p style={{ margin: "0 0 16px" }}>
              The single biggest factor in any renovation budget is regional location. London projects typically cost 30–35% more than the national average, driven by higher day rates for tradespeople, restricted site access, and parking and scaffold permit costs. The South East adds around 20–25%, while Scotland and Wales are typically 10–15% below the national average.
            </p>
            <p style={{ margin: "0 0 16px" }}>
              For most room-level renovations, labour accounts for 40–60% of the total cost. This is why keeping plumbing in its existing position during a bathroom renovation, or retaining the kitchen layout rather than reconfiguring it, can reduce costs by 25–30% without affecting the quality of the finished result.
            </p>
            <p style={{ margin: "0 0 32px" }}>
              When budgeting, always add a 10–15% contingency for unforeseen structural issues — particularly in pre-1980s properties where hidden damp, outdated wiring, or non-standard construction can add cost once walls are opened up.
            </p>
          </div>

          <h2 style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 400, color: C.dark, letterSpacing: "-0.3px", margin: "0 0 16px", borderLeft: `3px solid ${C.green}`, paddingLeft: 12 }}>
            How to get an accurate renovation quote
          </h2>
          <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
            <p style={{ margin: "0 0 16px" }}>
              Use this calculator to establish your indicative budget before approaching contractors. Once you have a figure, follow these steps to get an accurate quote:
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Get at least 3 itemised quotes from different contractors. Ask each to quote against the same written specification so you're comparing like for like. Be wary of quotes that are significantly below market rate — these often exclude VAT, professional fees such as architect or structural engineer costs, or a contingency allowance.
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Ask contractors for references on similar projects completed in the last 12 months. For projects over £10,000, check that your contractor carries public liability insurance and, for electrical or gas work, holds the relevant certifications (NICEIC for electricians, Gas Safe for gas engineers).
            </p>
            <p style={{ margin: "0 0 0" }}>
              For larger projects such as extensions or loft conversions, you may also need to budget for planning permission fees (typically £206 for a householder application in England), building regulations approval, and a structural engineer's report.
            </p>
          </div>
        </div>

        {/* FAQ section */}
        <div style={{ marginTop: 56 }}>
          <h2 style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 400, color: C.dark, letterSpacing: "-0.3px", margin: "0 0 4px" }}>
            Frequently asked questions
          </h2>
          <div style={{ marginTop: 8 }}>
            {FAQ_ITEMS.map((item) => (
              <FAQItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>

        {/* Internal links */}
        <div style={{ marginTop: 48 }}>
          <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, marginBottom: 16 }}>
            Related
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Link
              to="/blog/the-complete-uk-home-buyers-guide-to-analysing-a-property-listing"
              style={{ fontSize: 14, color: C.green, textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              The complete UK home buyer's guide to analysing a property listing
            </Link>
            <Link
              to="/"
              style={{ fontSize: 14, color: C.green, textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Analyse a Rightmove listing with AI
            </Link>
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ marginTop: 56, borderTop: `0.5px solid ${C.border}`, paddingTop: 28 }}>
          <p
            style={{
              fontSize: 13,
              color: C.veryMuted,
              lineHeight: 1.7,
              textAlign: "center",
              maxWidth: 600,
              margin: "0 auto",
            }}
          >
            Estimates are indicative only and based on 2026 UK market data. Costs include VAT at 20%. Always get at least 3 itemised quotes before committing to any contractor. Regional multipliers applied: London ×1.35, South East ×1.22, Scotland &amp; Wales ×0.88. vett renovation estimates are AI-assisted and for budgeting purposes only — they are not quotes and should not be relied upon as such.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
