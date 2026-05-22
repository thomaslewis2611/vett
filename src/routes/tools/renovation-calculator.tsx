import { createFileRoute, Link, useRouter, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { buildPageMeta, buildCanonicalLink, jsonLdScript, SITE_URL, DEFAULT_OG_IMAGE } from "@/lib/seo";
import { focusAndPulseInput } from "@/lib/focus-input";

// ─── Design tokens ────────────────────────────────────────────────────────────
const HEADING_FONT = "'Playfair Display', Georgia, serif";
const BODY_FONT = "'Inter', -apple-system, sans-serif";
// C alias keeps existing FAQItem/prose markup working unchanged
const C = {
  bg: "#F1EFE8",
  card: "#FFFDF9",
  dark: "#1A1108",
  green: "#2D6A4F",
  greenLight: "#40916C",
  darkGreen: "#1a2820",
  greenTint: "#EAF3DE",
  text2: "#5F5E5A",
  muted: "#5F5E5A",
  veryMuted: "#888780",
  border: "rgba(26,17,8,0.10)",
};
const HEADING = HEADING_FONT;
const BODY = BODY_FONT;

// ─── Types ────────────────────────────────────────────────────────────────────
type PropType = "flat" | "terrace" | "semi" | "detached";
type Region = "london" | "southeast" | "england" | "scotwales";
type CategoryId =
  | "kitchen" | "bathroom" | "loft" | "side" | "rear"
  | "rewire" | "boiler" | "windows" | "refurb";

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
  refurb_unit: "sqft" | "sqm";
}

interface ItemCost { id: CategoryId; label: string; mid: number; low: number; high: number; }

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES: { id: CategoryId; label: string; hint: string }[] = [
  { id: "kitchen",  label: "Kitchen renovation",        hint: "£8k–£35k" },
  { id: "bathroom", label: "Bathroom renovation",       hint: "£6k–£20k" },
  { id: "loft",     label: "Loft conversion",           hint: "£28k–£75k" },
  { id: "side",     label: "Side return extension",     hint: "£25k–£60k" },
  { id: "rear",     label: "Rear extension",            hint: "£18k–£90k" },
  { id: "rewire",   label: "Full rewire",               hint: "£3.5k–£10k" },
  { id: "boiler",   label: "New boiler / heating",      hint: "£2.5k–£15k" },
  { id: "windows",  label: "New windows",               hint: "£3k–£20k" },
  { id: "refurb",   label: "Full refurbishment",        hint: "£25k–£120k+" },
];

const REGION_MULTIPLIER: Record<Region, number> = {
  london: 1.35, southeast: 1.22, england: 1.0, scotwales: 0.88,
};
const REGION_LABELS: Record<Region, string> = {
  london: "London", southeast: "South East", england: "Rest of England", scotwales: "Scotland & Wales",
};
const PROP_LABELS: Record<PropType, string> = {
  flat: "Flat", terrace: "Terrace", semi: "Semi-detached", detached: "Detached",
};
const WINDOW_DEFAULTS: Record<PropType, number> = { flat: 4, terrace: 8, semi: 11, detached: 20 };
const REFURB_SQM_DEFAULTS: Record<PropType, number>  = { flat: 55, terrace: 80, semi: 100, detached: 140 };
const REFURB_SQFT_DEFAULTS: Record<PropType, number> = { flat: 592, terrace: 861, semi: 1076, detached: 1507 };
const SQM_PER_SQFT = 1 / 10.764;

// ─── Default state (kitchen + bathroom pre-selected) ──────────────────────────
function defaultState(): CalcState {
  return {
    prop: "semi", region: "england",
    activeItems: new Set<CategoryId>(["kitchen", "bathroom"]),
    kitchen_size: "medium", kitchen_layout: false,
    bathroom_count: "1", bathroom_plumbing: true,
    loft_type: "dormer", loft_ensuite: false,
    side_width: "standard", side_openplan: false,
    rear_size: "medium", rear_storeys: "single",
    rewire_beds: "3", boiler_type: "combi", boiler_rads: false,
    windows_count: 0, windows_material: "upvc",
    refurb_spec: "mid", refurb_sqft: 0, refurb_unit: "sqft",
  };
}

// ─── URL serialisation (unchanged — backward-compatible with old links) ───────
function paramsToState(params: URLSearchParams): CalcState {
  const s = defaultState();
  const p = params.get("prop");
  if (p && ["flat","terrace","semi","detached"].includes(p)) s.prop = p as PropType;
  const r = params.get("region");
  if (r && ["london","southeast","england","scotwales"].includes(r)) s.region = r as Region;
  const items = params.get("items");
  if (items) {
    const valid = CATEGORIES.map(c => c.id);
    const ids = items.split(",").filter(id => valid.includes(id as CategoryId));
    s.activeItems = new Set(ids as CategoryId[]);
  }
  const ks = params.get("kitchen_size");
  if (ks && ["small","medium","large"].includes(ks)) s.kitchen_size = ks as "small"|"medium"|"large";
  if (params.has("kitchen_layout")) s.kitchen_layout = params.get("kitchen_layout") === "1";
  const bc = params.get("bathroom_count");
  if (bc && ["1","2","3"].includes(bc)) s.bathroom_count = bc as "1"|"2"|"3";
  if (params.has("bathroom_plumbing")) s.bathroom_plumbing = params.get("bathroom_plumbing") === "1";
  const lt = params.get("loft_type");
  if (lt && ["velux","dormer","mansard"].includes(lt)) s.loft_type = lt as "velux"|"dormer"|"mansard";
  if (params.has("loft_ensuite")) s.loft_ensuite = params.get("loft_ensuite") === "1";
  const sw = params.get("side_width");
  if (sw && ["narrow","standard","wide"].includes(sw)) s.side_width = sw as "narrow"|"standard"|"wide";
  if (params.has("side_openplan")) s.side_openplan = params.get("side_openplan") === "1";
  const rs = params.get("rear_size");
  if (rs && ["small","medium","large"].includes(rs)) s.rear_size = rs as "small"|"medium"|"large";
  const rst = params.get("rear_storeys");
  if (rst && ["single","double"].includes(rst)) s.rear_storeys = rst as "single"|"double";
  const rb = params.get("rewire_beds");
  if (rb && ["1","2","3","4","5"].includes(rb)) s.rewire_beds = rb as "1"|"2"|"3"|"4"|"5";
  const bt = params.get("boiler_type");
  if (bt && ["combi","system","heatpump"].includes(bt)) s.boiler_type = bt as "combi"|"system"|"heatpump";
  if (params.has("boiler_rads")) s.boiler_rads = params.get("boiler_rads") === "1";
  const wc = parseInt(params.get("windows_count") ?? "0");
  if (!isNaN(wc) && wc >= 0) s.windows_count = wc;
  const wm = params.get("windows_material");
  if (wm && ["upvc","aluminium","timber"].includes(wm)) s.windows_material = wm as "upvc"|"aluminium"|"timber";
  const rspec = params.get("refurb_spec");
  if (rspec && ["budget","mid","high"].includes(rspec)) s.refurb_spec = rspec as "budget"|"mid"|"high";
  const rsqft = parseInt(params.get("refurb_sqft") ?? "0");
  if (!isNaN(rsqft) && rsqft >= 0) s.refurb_sqft = rsqft;
  const ru = params.get("refurb_unit");
  if (ru && ["sqft","sqm"].includes(ru)) s.refurb_unit = ru as "sqft"|"sqm";
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
  p.set("refurb_unit", s.refurb_unit);
  return p.toString();
}

// ─── Cost model ───────────────────────────────────────────────────────────────
function calcItemCost(id: CategoryId, s: CalcState): ItemCost {
  const rm = REGION_MULTIPLIER[s.region];
  let mid = 0;
  switch (id) {
    case "kitchen": {
      const base = { small: 10000, medium: 18000, large: 28000 }[s.kitchen_size];
      mid = base * (s.kitchen_layout ? 1.3 : 1.0); break;
    }
    case "bathroom": {
      const countM = { "1": 1.0, "2": 1.85, "3": 2.6 }[s.bathroom_count];
      mid = 8000 * countM * (s.bathroom_plumbing ? 1.0 : 1.3); break;
    }
    case "loft": {
      const base = { velux: 32000, dormer: 50000, mansard: 68000 }[s.loft_type];
      mid = base + (s.loft_ensuite ? 6000 : 0); break;
    }
    case "side": {
      const base = { narrow: 28000, standard: 40000, wide: 55000 }[s.side_width];
      mid = base + (s.side_openplan ? 5000 : 0); break;
    }
    case "rear": {
      const base = { small: 22000, medium: 38000, large: 58000 }[s.rear_size];
      mid = base * (s.rear_storeys === "double" ? 1.6 : 1.0); break;
    }
    case "rewire": {
      mid = { "1": 4000, "2": 5000, "3": 6000, "4": 7500, "5": 9000 }[s.rewire_beds]; break;
    }
    case "boiler": {
      const base = { combi: 3500, system: 4500, heatpump: 12000 }[s.boiler_type];
      mid = base + (s.boiler_rads ? 3000 : 0); break;
    }
    case "windows": {
      const count = s.windows_count > 0 ? s.windows_count : WINDOW_DEFAULTS[s.prop];
      const matM = { upvc: 1.0, aluminium: 1.3, timber: 1.55 }[s.windows_material];
      mid = count * 700 * matM; break;
    }
    case "refurb": {
      let sqm: number;
      if (s.refurb_unit === "sqft") {
        const sqft = s.refurb_sqft > 0 ? s.refurb_sqft : REFURB_SQFT_DEFAULTS[s.prop];
        sqm = sqft * SQM_PER_SQFT;
      } else {
        sqm = s.refurb_sqft > 0 ? s.refurb_sqft : REFURB_SQM_DEFAULTS[s.prop];
      }
      mid = sqm * { budget: 500, mid: 850, high: 1200 }[s.refurb_spec]; break;
    }
  }
  mid = mid * rm;
  return {
    id, label: CATEGORIES.find(c => c.id === id)!.label,
    mid:  Math.round(mid / 100) * 100,
    low:  Math.round((mid * 0.75) / 100) * 100,
    high: Math.round((mid * 1.35) / 100) * 100,
  };
}

function fmt(n: number): string {
  return "£" + n.toLocaleString("en-GB");
}

function cfgSummary(id: CategoryId, s: CalcState): string {
  switch (id) {
    case "kitchen":  return `${s.kitchen_size[0].toUpperCase() + s.kitchen_size.slice(1)}, ${s.kitchen_layout ? "layout change" : "same layout"}`;
    case "bathroom": return `${s.bathroom_count} bathroom${Number(s.bathroom_count) > 1 ? "s" : ""}, ${s.bathroom_plumbing ? "keep plumbing" : "replumb"}`;
    case "loft":     return `${s.loft_type[0].toUpperCase() + s.loft_type.slice(1)}${s.loft_ensuite ? " + ensuite" : ""}`;
    case "side":     return `${s.side_width} width${s.side_openplan ? ", open-plan" : ""}`;
    case "rear":     return `${s.rear_size} size, ${s.rear_storeys} storey`;
    case "rewire":   return `${s.rewire_beds}-bed`;
    case "boiler":   return `${s.boiler_type[0].toUpperCase() + s.boiler_type.slice(1)}${s.boiler_rads ? " + rads" : ""}`;
    case "windows":  return `${s.windows_count > 0 ? s.windows_count : WINDOW_DEFAULTS[s.prop]} windows, ${s.windows_material}`;
    case "refurb":   return `${s.refurb_spec} spec`;
  }
}

// ─── Atoms ────────────────────────────────────────────────────────────────────
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: C.veryMuted }}>
      {children}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`rc-chip${active ? " rc-chip-active" : ""}`}
      onClick={onClick}
      style={{
        fontSize: 13, fontWeight: active ? 500 : 400,
        color: active ? "#FFFDF9" : C.muted,
        background: active ? C.green : C.card,
        border: `0.5px solid ${active ? C.green : C.border}`,
        borderRadius: 100, padding: "8px 18px",
        cursor: "pointer", whiteSpace: "nowrap" as const, fontFamily: BODY_FONT,
      }}
    >
      {label}
    </button>
  );
}

function CheckBox({ id, label, hint, checked, onChange }: {
  id: CategoryId; label: string; hint: string; checked: boolean; onChange: () => void;
}) {
  return (
    <button
      type="button"
      className={`rc-work-card${checked ? " rc-active" : ""}`}
      onClick={onChange}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        background: checked ? C.greenTint : C.card,
        border: `0.5px solid ${checked ? C.green : C.border}`,
        borderRadius: 12, cursor: "pointer", textAlign: "left" as const,
        width: "100%", fontFamily: BODY_FONT,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        border: `1.5px solid ${checked ? C.green : C.border}`,
        background: checked ? C.green : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#FFFDF9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: checked ? C.green : C.dark }}>{label}</div>
        <div style={{ fontSize: 11, color: C.veryMuted, marginTop: 1 }}>{hint}</div>
      </div>
    </button>
  );
}

function H2Rule({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 999, background: C.dark, color: "#FFFDF9",
        fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>{n}</div>
      <h2 style={{ fontFamily: HEADING_FONT, fontSize: 19, fontWeight: 400, color: C.dark, margin: 0 }}>{children}</h2>
    </div>
  );
}

function StepBtn({ dir, onClick, disabled }: { dir: "+" | "−"; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rc-step-btn"
      style={{
        width: 28, height: 28, borderRadius: 7,
        border: `0.5px solid ${C.border}`, background: C.bg,
        fontSize: 16, color: disabled ? C.veryMuted : C.dark,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
    >{dir}</button>
  );
}

function QtyStepper({ value, min, max, onChange, suffix }: {
  value: number; min: number; max: number; onChange: (n: number) => void; suffix?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <StepBtn dir="−" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} />
      <span style={{ fontSize: 15, fontWeight: 500, color: C.dark, minWidth: 32, textAlign: "center" as const }}>
        {value}{suffix}
      </span>
      <StepBtn dir="+" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} />
    </div>
  );
}

function SegLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: C.veryMuted, fontWeight: 500 }}>{children}</span>;
}

function SegRow<T extends string>({ label, options, value, onChange }: {
  label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
      <SegLabel>{label}</SegLabel>
      <div style={{ display: "inline-flex", flexWrap: "wrap" as const, gap: 3, background: C.bg, borderRadius: 10, padding: 3, border: `0.5px solid ${C.border}` }}>
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`rc-seg-btn${value === opt.value ? " rc-active" : ""}`}
            onClick={() => onChange(opt.value)}
            style={{
              fontSize: 12, fontWeight: value === opt.value ? 500 : 400,
              color: value === opt.value ? "#F1EFE8" : C.muted,
              background: value === opt.value ? C.green : "transparent",
              border: value === opt.value ? `0.5px solid ${C.green}` : "0.5px solid transparent",
              borderRadius: 7, padding: "5px 12px", cursor: "pointer",
              whiteSpace: "nowrap" as const,
            }}
          >{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left" as const }}
    >
      <div style={{ width: 34, height: 18, borderRadius: 999, background: checked ? C.green : "rgba(26,17,8,0.18)", position: "relative" as const, transition: "background 0.15s", flexShrink: 0 }}>
        <div style={{ position: "absolute" as const, top: 2, left: checked ? 16 : 2, width: 14, height: 14, borderRadius: 999, background: "#fff", transition: "left 0.15s" }} />
      </div>
      <span style={{ fontSize: 13, color: C.muted }}>{label}</span>
    </button>
  );
}

function SpecNote({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: C.veryMuted, margin: "6px 0 0", lineHeight: 1.5 }}>{children}</p>;
}

// ─── Item config panels ───────────────────────────────────────────────────────
function ItemConfigPanel({ id, state, onUpdate }: { id: CategoryId; state: CalcState; onUpdate: (u: Partial<CalcState>) => void; }) {
  switch (id) {
    case "kitchen":
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <SegRow label="Kitchen size" options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} value={state.kitchen_size} onChange={v => onUpdate({ kitchen_size: v })} />
          <ToggleRow checked={state.kitchen_layout} onChange={v => onUpdate({ kitchen_layout: v })} label="Layout change (moving plumbing / walls)" />
          <SpecNote>Layout changes add around 30% to total cost.</SpecNote>
        </div>
      );
    case "bathroom":
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <SegRow label="Number of bathrooms" options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3+" }]} value={state.bathroom_count} onChange={v => onUpdate({ bathroom_count: v })} />
          <ToggleRow checked={state.bathroom_plumbing} onChange={v => onUpdate({ bathroom_plumbing: v })} label="Keeping plumbing in same position" />
          <SpecNote>Keeping plumbing in place saves around 30% on total cost.</SpecNote>
        </div>
      );
    case "loft":
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <SegRow label="Conversion type" options={[{ value: "velux", label: "Rooflight/Velux" }, { value: "dormer", label: "Dormer" }, { value: "mansard", label: "Mansard" }]} value={state.loft_type} onChange={v => onUpdate({ loft_type: v })} />
          <ToggleRow checked={state.loft_ensuite} onChange={v => onUpdate({ loft_ensuite: v })} label="Include en-suite bathroom" />
          <SpecNote>Mansard conversions typically require planning permission. En-suite adds £4k–£8k.</SpecNote>
        </div>
      );
    case "side":
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <SegRow label="Width" options={[{ value: "narrow", label: "Narrow" }, { value: "standard", label: "Standard" }, { value: "wide", label: "Wide" }]} value={state.side_width} onChange={v => onUpdate({ side_width: v })} />
          <ToggleRow checked={state.side_openplan} onChange={v => onUpdate({ side_openplan: v })} label="Open-plan kitchen integration" />
        </div>
      );
    case "rear":
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <SegRow label="Extension size" options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} value={state.rear_size} onChange={v => onUpdate({ rear_size: v })} />
          <SegRow label="Storeys" options={[{ value: "single", label: "Single storey" }, { value: "double", label: "Double storey" }]} value={state.rear_storeys} onChange={v => onUpdate({ rear_storeys: v })} />
        </div>
      );
    case "rewire":
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <SegRow label="Bedrooms" options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }, { value: "5", label: "5+" }]} value={state.rewire_beds} onChange={v => onUpdate({ rewire_beds: v })} />
          <SpecNote>A 3-bed house typically needs 8–10 circuits.</SpecNote>
        </div>
      );
    case "boiler":
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <SegRow label="System type" options={[{ value: "combi", label: "Combi" }, { value: "system", label: "System" }, { value: "heatpump", label: "Heat pump" }]} value={state.boiler_type} onChange={v => onUpdate({ boiler_type: v })} />
          <ToggleRow checked={state.boiler_rads} onChange={v => onUpdate({ boiler_rads: v })} label="Replace radiators (+£3,000)" />
        </div>
      );
    case "windows": {
      const def = WINDOW_DEFAULTS[state.prop];
      const current = state.windows_count > 0 ? state.windows_count : def;
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
            <SegLabel>Number of windows</SegLabel>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <QtyStepper value={current} min={1} max={50} onChange={n => onUpdate({ windows_count: n })} />
              <span style={{ fontSize: 12, color: C.veryMuted }}>typical for {PROP_LABELS[state.prop].toLowerCase()}: {def}</span>
            </div>
          </div>
          <SegRow label="Frame material" options={[{ value: "upvc", label: "uPVC" }, { value: "aluminium", label: "Aluminium" }, { value: "timber", label: "Timber" }]} value={state.windows_material} onChange={v => onUpdate({ windows_material: v })} />
        </div>
      );
    }
    case "refurb": {
      const isSqft = state.refurb_unit === "sqft";
      const defVal = isSqft ? REFURB_SQFT_DEFAULTS[state.prop] : REFURB_SQM_DEFAULTS[state.prop];
      const cur = state.refurb_sqft > 0 ? state.refurb_sqft : defVal;
      const unitLabel = isSqft ? "sq ft" : "m²";
      const handleUnitChange = (u: "sqft" | "sqm") => {
        if (u === state.refurb_unit) return;
        if (state.refurb_sqft === 0) { onUpdate({ refurb_unit: u }); return; }
        const conv = u === "sqm"
          ? Math.round(state.refurb_sqft * SQM_PER_SQFT)
          : Math.round(state.refurb_sqft / SQM_PER_SQFT);
        onUpdate({ refurb_unit: u, refurb_sqft: conv });
      };
      return (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
          <SegRow label="Specification level" options={[{ value: "budget", label: "Budget" }, { value: "mid", label: "Mid" }, { value: "high", label: "High" }]} value={state.refurb_spec} onChange={v => onUpdate({ refurb_spec: v })} />
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <SegLabel>Floor area ({unitLabel})</SegLabel>
              <SegRow label="" options={[{ value: "sqft", label: "sq ft" }, { value: "sqm", label: "m²" }]} value={state.refurb_unit} onChange={handleUnitChange} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                min={isSqft ? 100 : 10} max={isSqft ? 15000 : 1000}
                value={cur}
                onChange={e => {
                  const n = parseInt(e.target.value);
                  if (isNaN(n)) { onUpdate({ refurb_sqft: 0 }); return; }
                  const mn = isSqft ? 100 : 10; const mx = isSqft ? 15000 : 1000;
                  onUpdate({ refurb_sqft: Math.max(mn, Math.min(mx, n)) });
                }}
                style={{ width: 90, padding: "6px 10px", fontSize: 13, color: C.dark, background: C.bg, border: `0.5px solid ${C.border}`, borderRadius: 8, outline: "none" }}
              />
              <span style={{ fontSize: 12, color: C.veryMuted }}>default {defVal} {unitLabel} for {PROP_LABELS[state.prop].toLowerCase()}</span>
            </div>
          </div>
        </div>
      );
    }
  }
}

// ─── QCard ────────────────────────────────────────────────────────────────────
function QCard({ id, cost, state, onUpdate, onDeselect }: {
  id: CategoryId; cost: ItemCost; state: CalcState;
  onUpdate: (u: Partial<CalcState>) => void; onDeselect: () => void;
}) {
  const [open, setOpen] = useState(true);
  const cat = CATEGORIES.find(c => c.id === id)!;
  return (
    <div
      className="rc-qcard"
      style={{ background: C.card, border: `0.5px solid ${C.green}`, borderRadius: 16, overflow: "hidden" }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "15px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" as const, gap: 12 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 18, height: 18, borderRadius: 5, background: C.green, border: `1.5px solid ${C.green}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4L3.5 6.5L9 1" stroke="#FFFDF9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: C.green }}>{cat.label}</div>
            {!open && <div style={{ fontSize: 11, color: C.veryMuted, marginTop: 1 }}>{cfgSummary(id, state)}</div>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.green }}>{fmt(cost.mid)}</span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDeselect(); }}
            className="rc-remove-btn"
            style={{ fontSize: 11, color: C.veryMuted, background: "none", border: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 4, fontFamily: BODY_FONT }}
          >
            Remove
          </button>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            <path d="M2 4.5L7 9.5L12 4.5" stroke={C.veryMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
      <div style={{ maxHeight: open ? 700 : 0, overflow: "hidden", transition: "max-height 0.22s ease" }}>
        <div style={{ padding: "0 20px 20px", borderTop: `0.5px solid ${C.border}`, paddingTop: 16 }}>
          <ItemConfigPanel id={id} state={state} onUpdate={onUpdate} />
          <div style={{ fontSize: 12, color: C.veryMuted, marginTop: 12 }}>
            Range: {fmt(cost.low)} – {fmt(cost.high)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tie-in card ──────────────────────────────────────────────────────────────
function TieInCard({ onVettListing }: { onVettListing: () => void }) {
  return (
    <div style={{ background: C.darkGreen, borderRadius: 20, padding: "24px 24px 20px", marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "rgba(255,253,249,0.5)", marginBottom: 10 }}>
        Looking at a specific listing?
      </div>
      <p style={{ fontSize: 14, color: "rgba(255,253,249,0.75)", lineHeight: 1.65, margin: "0 0 18px" }}>
        Before you commit to a renovation budget, run the property through vett. Get red flags, fair value, true costs and negotiation strategy in under 2 minutes.
      </p>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
        <button
          type="button"
          onClick={onVettListing}
          className="rc-tiein-primary"
          style={{ display: "block", width: "100%", textAlign: "center" as const, background: C.greenLight, border: "none", borderRadius: 20, padding: "11px 16px", fontSize: 13, fontWeight: 500, color: "#FFFDF9", cursor: "pointer", fontFamily: BODY_FONT }}
        >
          Vett a listing — £4.99 →
        </button>
        <a
          href="/tools/local-businesses?category=contractors"
          className="rc-tiein-secondary"
          style={{ display: "block", textAlign: "center" as const, background: "transparent", border: "0.5px solid rgba(255,253,249,0.2)", borderRadius: 20, padding: "11px 16px", fontSize: 13, fontWeight: 400, color: "rgba(255,253,249,0.75)", textDecoration: "none" }}
        >
          Find tradespeople near you →
        </a>
      </div>
    </div>
  );
}

// ─── Sticky tally bar ─────────────────────────────────────────────────────────
function StickyTallyBar({ costs, state, getShareUrl }: {
  costs: ItemCost[]; state: CalcState; getShareUrl: () => string;
}) {
  const total    = costs.reduce((s, c) => s + c.mid, 0);
  const totalLow = costs.reduce((s, c) => s + c.low, 0);
  const totalHigh= costs.reduce((s, c) => s + c.high, 0);

  const [copied, setCopied] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleSave = async () => {
    try { await navigator.clipboard.writeText(getShareUrl()); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
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
    } catch { setEmailStatus("error"); }
  };

  return (
    <div style={{ position: "fixed" as const, bottom: 0, left: 0, right: 0, zIndex: 100, background: C.darkGreen, borderTop: "0.5px solid rgba(255,253,249,0.12)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {total > 0 ? (
              <>
                <div style={{ fontSize: 11, color: "rgba(255,253,249,0.45)", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>Estimate</div>
                <div style={{ fontFamily: HEADING_FONT, fontSize: 22, fontWeight: 400, color: "#FFFDF9", letterSpacing: "-0.5px", lineHeight: 1 }}>{fmt(total)}</div>
                <div style={{ fontSize: 11, color: "rgba(255,253,249,0.4)", marginTop: 2 }}>{fmt(totalLow)} – {fmt(totalHigh)}</div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: "rgba(255,253,249,0.4)" }}>Select work above</div>
            )}
          </div>
          {total > 0 && (
            <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
              <button type="button" onClick={handleSave} className="rc-tally-btn"
                style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,253,249,0.85)", background: "rgba(255,253,249,0.08)", border: "0.5px solid rgba(255,253,249,0.15)", borderRadius: 100, padding: "7px 14px", cursor: "pointer", fontFamily: BODY_FONT }}>
                {copied ? "Copied!" : "↗ Save"}
              </button>
              <button type="button" onClick={() => { setShowEmail(v => !v); setEmailStatus("idle"); }} className="rc-tally-btn"
                style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,253,249,0.85)", background: "rgba(255,253,249,0.08)", border: "0.5px solid rgba(255,253,249,0.15)", borderRadius: 100, padding: "7px 14px", cursor: "pointer", fontFamily: BODY_FONT }}>
                ✉ Email quote
              </button>
            </div>
          )}
        </div>

        {showEmail && total > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid rgba(255,253,249,0.10)" }}>
            {emailStatus === "sent" ? (
              <span style={{ fontSize: 13, color: "#7AC97A" }}>Sent! Check your inbox.</span>
            ) : emailStatus === "error" ? (
              <span style={{ fontSize: 13, color: "#E05A45" }}>Something went wrong — please try again.</span>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
                  placeholder="your@email.com"
                  className="rc-email-input"
                  style={{ flex: 1, padding: "8px 12px", fontSize: 13, background: "rgba(255,253,249,0.08)", border: "0.5px solid rgba(255,253,249,0.2)", borderRadius: 8, color: "#FFFDF9", outline: "none", fontFamily: BODY_FONT }}
                />
                <button
                  type="button" onClick={handleSend}
                  disabled={emailStatus === "sending" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                  style={{ fontSize: 12, fontWeight: 500, color: "#FFFDF9", background: C.green, border: "none", borderRadius: 100, padding: "8px 16px", cursor: emailStatus === "sending" ? "wait" : "pointer", opacity: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 0.45 : 1, fontFamily: BODY_FONT, flexShrink: 0 }}
                >
                  {emailStatus === "sending" ? "Sending…" : "Send"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
const FAQ_ITEMS = [
  { q: "How much does a kitchen renovation cost in the UK in 2026?", a: "A kitchen renovation in the UK typically costs between £8,000 and £35,000 in 2026, depending on the size and whether the layout is being changed. A small kitchen with no layout change costs around £8,000–£12,000. A medium kitchen with new layout can reach £18,000–£25,000. London and South East projects add 20–35% to these figures." },
  { q: "How much does a loft conversion cost in 2026?", a: "Loft conversion costs range from £28,000 for a basic Velux conversion up to £75,000 or more for a dormer, and £68,000–£90,000 for a Mansard conversion. Adding an en-suite adds approximately £4,000–£8,000. London projects typically cost 35% more than the national average." },
  { q: "Does renovation cost vary by region in the UK?", a: "Yes, significantly. London carries a 30–35% premium over national averages due to higher labour rates and access costs. The South East adds 20–25%. Scotland and Wales are typically 10–15% below the national average. Regional labour rates are the primary driver, since material costs are broadly similar across the UK." },
  { q: "How much does a full house rewire cost?", a: "A full rewire for a 3-bedroom house costs between £4,000 and £8,000 in 2026. Costs scale with the number of bedrooms and circuits: a 1-bed flat starts around £3,500, while a 5-bedroom detached house can reach £10,000 or more. Labour makes up roughly 60% of the total cost." },
  { q: "Should I get multiple quotes for renovation work?", a: "Yes — always get at least 3 itemised quotes before committing to any contractor. Renovation quotes can vary by 30–50% for the same scope of work. Ask each contractor to quote against the same specification, and be wary of quotes significantly below the market rate, which often exclude VAT, professional fees, or a contingency allowance." },
  { q: "How accurate are renovation cost calculators?", a: "Renovation calculators provide indicative mid-range estimates based on current market data. Actual costs depend on your property's condition, local contractor availability, specification choices, and any unforeseen structural issues. Use calculator estimates for early budgeting, then refine with 3 quotes from local tradespeople. Always add a 10–15% contingency to your budget." },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `0.5px solid ${C.border}` }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", padding: "18px 0", background: "none", border: "none", cursor: "pointer", textAlign: "left" as const, gap: 16 }}
      >
        <h3 style={{ fontFamily: BODY, fontSize: 15, fontWeight: 500, color: C.dark, margin: 0, lineHeight: 1.4 }}>{q}</h3>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 2, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M3 5.5L8 10.5L13 5.5" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div style={{ maxHeight: open ? 400 : 0, overflow: "hidden", transition: "max-height 0.22s ease" }}>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: "0 0 18px" }}>{a}</p>
      </div>
    </div>
  );
}

// ─── SEO schemas ──────────────────────────────────────────────────────────────
const softwareAppSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Renovation Cost Calculator",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description: "Free UK renovation cost calculator with regional pricing for kitchens, bathrooms, loft conversions, extensions and more.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
  url: `${SITE_URL}/tools/renovation-calculator`,
  publisher: { "@type": "Organization", name: "vett", url: SITE_URL },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map(item => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
};

// ─── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/tools/renovation-calculator")({
  head: () => ({
    meta: buildPageMeta({
      title: "Renovation Cost Calculator UK 2026 — vett",
      description: "Estimate UK renovation costs for kitchens, bathrooms, loft conversions and more. Instant regional pricing with personalised adjusters. Free tool by vett.",
      canonicalPath: "/tools/renovation-calculator",
      ogImage: DEFAULT_OG_IMAGE,
    }),
    links: [buildCanonicalLink("/tools/renovation-calculator")],
    scripts: [jsonLdScript(softwareAppSchema), jsonLdScript(faqSchema)],
  }),
  component: RenovationCalculator,
});

// ─── Main component ───────────────────────────────────────────────────────────
function RenovationCalculator() {
  const router   = useRouter();
  const navigate = useNavigate();
  const [state, setState] = useState<CalcState>(defaultState);

  // Part 4 — restore from URL on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.toString()) setState(paramsToState(params));
  }, []);

  // Part 4 — sync URL on every state change (no scroll-jump, no history flood)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs  = stateToParams(state);
    const url = `${window.location.pathname}?${qs}`;
    const hist = (router as any).history;
    hist._ignoreSubscribers = true;
    window.history.replaceState(null, "", url);
    hist._ignoreSubscribers = false;
  }, [state, router]);

  const update = (u: Partial<CalcState>) => setState(prev => ({ ...prev, ...u }));

  const toggleItem = (id: CategoryId) => {
    setState(prev => {
      const next = new Set(prev.activeItems);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, activeItems: next };
    });
  };

  const handlePropChange = (prop: PropType) => {
    setState(prev => ({ ...prev, prop, windows_count: 0, refurb_sqft: 0 }));
  };

  // Part 2 — tie-in card primary CTA
  const handleVettListing = () => {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem("vettFocusInput", "1");
    navigate({ to: "/" });
  };

  // Part 3 — Save URL
  const getShareUrl = () => typeof window !== "undefined" ? window.location.href : "";

  const activeCosts = CATEGORIES
    .filter(c => state.activeItems.has(c.id))
    .map(c => calcItemCost(c.id, state));

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: BODY, color: C.dark, paddingBottom: 100 }}>
      <style>{`
        /* Part 5 — Chip hover */
        .rc-chip { transition: background 0.15s, border-color 0.15s, color 0.15s; cursor: pointer; }
        .rc-chip:not(.rc-chip-active):hover { background: #EAF3DE !important; border-color: #2D6A4F !important; }
        .rc-chip.rc-chip-active:hover { background: #2D6A4F !important; }
        /* Work card hover */
        .rc-work-card { transition: border-color 0.15s, background 0.15s; cursor: pointer; }
        .rc-work-card:not(.rc-active):hover { border-color: #2D6A4F !important; }
        /* QCard hover */
        .rc-qcard { transition: border-color 0.15s; }
        .rc-qcard:hover { border-color: #1a7a58 !important; }
        /* Seg btn hover */
        .rc-seg-btn { transition: background 0.15s, color 0.15s; cursor: pointer; }
        .rc-seg-btn:not(.rc-active):hover { background: #EAF3DE !important; color: #1A1108 !important; }
        .rc-seg-btn.rc-active:hover { background: #2D6A4F !important; color: #F1EFE8 !important; }
        /* Step btn hover */
        .rc-step-btn { transition: background 0.15s, border-color 0.15s; cursor: pointer; }
        .rc-step-btn:not(:disabled):hover { background: #EAF3DE !important; border-color: #2D6A4F !important; }
        /* Remove btn hover */
        .rc-remove-btn { transition: color 0.15s; cursor: pointer; }
        .rc-remove-btn:hover { color: #C0392B !important; }
        /* Tally bar buttons */
        .rc-tally-btn { transition: background 0.15s, border-color 0.15s; cursor: pointer; }
        .rc-tally-btn:hover { background: rgba(255,253,249,0.15) !important; border-color: rgba(255,253,249,0.3) !important; }
        /* Tie-in card buttons */
        .rc-tiein-primary { transition: opacity 0.15s; cursor: pointer; }
        .rc-tiein-primary:hover { opacity: 0.88 !important; }
        .rc-tiein-secondary { transition: border-color 0.15s, color 0.15s; }
        .rc-tiein-secondary:hover { border-color: rgba(255,253,249,0.45) !important; color: rgba(255,253,249,0.95) !important; }
        /* Email input focus */
        .rc-email-input:focus { border-color: #2D6A4F !important; outline: none; }
        /* number input */
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { opacity: 1; }
        input[type=number]:focus { outline: none; border-color: #2D6A4F !important; }
      `}</style>
      <SiteHeader />

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px 80px" }}>

        {/* Hero */}
        <div style={{ marginBottom: 40 }}>
          <span style={{ display: "inline-block", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: C.green, background: C.greenTint, borderRadius: 100, padding: "4px 12px", marginBottom: 16 }}>
            Free tool · vett
          </span>
          <h1 style={{ fontFamily: HEADING_FONT, fontSize: "clamp(30px, 4vw, 40px)", fontWeight: 400, color: C.dark, letterSpacing: "-0.5px", lineHeight: 1.15, margin: "0 0 12px" }}>
            Renovation cost calculator
          </h1>
          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, margin: 0 }}>
            Estimate UK renovation costs with regional pricing. Select your works, adjust the spec, get an instant indicative budget.
          </p>
        </div>

        {/* ── Q1 — About your property ─────────────────────────────────── */}
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 16, padding: "20px 20px 22px", marginBottom: 12 }}>
          <H2Rule n={1}>About your property</H2Rule>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Eyebrow>Property type</Eyebrow>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {(["flat","terrace","semi","detached"] as PropType[]).map(p => (
                  <Chip key={p} label={PROP_LABELS[p]} active={state.prop === p} onClick={() => handlePropChange(p)} />
                ))}
              </div>
            </div>
            <div>
              <Eyebrow>Region</Eyebrow>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {(Object.entries(REGION_LABELS) as [Region, string][]).map(([r, label]) => (
                  <Chip key={r} label={label} active={state.region === r} onClick={() => update({ region: r })} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Q2 — Work selection ──────────────────────────────────────── */}
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 16, padding: "20px 20px 22px", marginBottom: 24 }}>
          <H2Rule n={2}>What work are you planning?</H2Rule>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {CATEGORIES.map(cat => (
              <CheckBox
                key={cat.id}
                id={cat.id}
                label={cat.label}
                hint={cat.hint}
                checked={state.activeItems.has(cat.id)}
                onChange={() => toggleItem(cat.id)}
              />
            ))}
          </div>
        </div>

        {/* ── Q3 — QCards for selected items ───────────────────────────── */}
        {activeCosts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            <div style={{ marginBottom: 4 }}>
              <H2Rule n={3}>Tell us more about each work</H2Rule>
            </div>
            {activeCosts.map(cost => (
              <QCard
                key={cost.id}
                id={cost.id}
                cost={cost}
                state={state}
                onUpdate={update}
                onDeselect={() => toggleItem(cost.id)}
              />
            ))}

            {/* Running total */}
            <div style={{ background: C.dark, borderRadius: 14, padding: "18px 20px", marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: "rgba(241,239,232,0.55)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>Total mid estimate</span>
                <span style={{ fontFamily: HEADING_FONT, fontSize: 28, fontWeight: 400, color: "#FFFDF9", letterSpacing: "-0.5px", lineHeight: 1 }}>
                  {fmt(activeCosts.reduce((s, c) => s + c.mid, 0))}
                </span>
              </div>
              {activeCosts.map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                  <span style={{ color: "rgba(241,239,232,0.6)" }}>{c.label}</span>
                  <span style={{ color: "#FFFDF9", fontWeight: 500 }}>{fmt(c.mid)}</span>
                </div>
              ))}
              <div style={{ fontSize: 12, color: "rgba(241,239,232,0.35)", marginTop: 8 }}>
                Low: {fmt(activeCosts.reduce((s,c) => s+c.low, 0))} · High: {fmt(activeCosts.reduce((s,c) => s+c.high, 0))}
              </div>
            </div>

            {/* Tie-in card */}
            <TieInCard onVettListing={handleVettListing} />
          </div>
        )}

        {/* ── SEO prose ────────────────────────────────────────────────── */}
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

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <div style={{ marginTop: 56 }}>
          <h2 style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 400, color: C.dark, letterSpacing: "-0.3px", margin: "0 0 4px" }}>
            Frequently asked questions
          </h2>
          <div style={{ marginTop: 8 }}>
            {FAQ_ITEMS.map(item => <FAQItem key={item.q} q={item.q} a={item.a} />)}
          </div>
        </div>

        {/* ── Internal links ────────────────────────────────────────────── */}
        <div style={{ marginTop: 48 }}>
          <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, marginBottom: 16 }}>Related</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Link to="/blog/the-complete-uk-home-buyers-guide-to-analysing-a-property-listing" style={{ fontSize: 14, color: C.green, textDecoration: "underline", textUnderlineOffset: 3 }}>
              The complete UK home buyer's guide to analysing a property listing
            </Link>
            <Link to="/" style={{ fontSize: 14, color: C.green, textDecoration: "underline", textUnderlineOffset: 3 }}>
              Analyse a Rightmove listing with AI
            </Link>
          </div>
        </div>

        {/* ── Disclaimer ────────────────────────────────────────────────── */}
        <div style={{ marginTop: 56, borderTop: `0.5px solid ${C.border}`, paddingTop: 28 }}>
          <p style={{ fontSize: 13, color: C.veryMuted, lineHeight: 1.7, textAlign: "center", maxWidth: 600, margin: "0 auto" }}>
            Estimates are indicative only and based on 2026 UK market data. Costs include VAT at 20%. Always get at least 3 itemised quotes before committing to any contractor. Regional multipliers applied: London ×1.35, South East ×1.22, Scotland &amp; Wales ×0.88. vett renovation estimates are AI-assisted and for budgeting purposes only — they are not quotes and should not be relied upon as such.
          </p>
        </div>

      </main>

      <SiteFooter />

      {/* Part 3 — Sticky tally bar */}
      <StickyTallyBar costs={activeCosts} state={state} getShareUrl={getShareUrl} />
    </div>
  );
}
