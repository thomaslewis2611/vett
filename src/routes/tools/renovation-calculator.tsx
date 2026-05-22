import { createFileRoute, Link, useRouter, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useMemo, type CSSProperties } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { buildPageMeta, buildCanonicalLink, jsonLdScript, SITE_URL, DEFAULT_OG_IMAGE } from "@/lib/seo";
import { focusAndPulseInput } from "@/lib/focus-input";

// ── Design tokens ─────────────────────────────────────────────────────────────
const HEADING_FONT = "'Playfair Display', Georgia, serif";
const BODY_FONT = "'Inter', -apple-system, sans-serif";
const HEADING = HEADING_FONT;
const BODY = BODY_FONT;
// COLORS: matches design spec exactly. muted = lighter label grey (#888780).
const COLORS = {
  bg: "#F1EFE8", card: "#FFFDF9", dark: "#1A1108",
  green: "#2D6A4F", greenLight: "#40916C", darkGreen: "#1a2820",
  text2: "#5F5E5A", muted: "#888780", border: "rgba(26,17,8,0.10)",
};
// C: extended tokens for FAQItem/prose markup (C.muted darker for prose body text)
const C = {
  ...COLORS, greenTint: "#EAF3DE",
  muted: "#5F5E5A",    // darker for prose body text
  veryMuted: "#888780",
};

// ── Cost model ─────────────────────────────────────────────────────────────────
const PROP_MULT: Record<string, number> = {
  Flat: 0.85, Terrace: 0.95, "Semi-detached": 1.0, Detached: 1.15,
};
const REGION_MULT: Record<string, number> = {
  London: 1.32, "South East": 1.22, "Rest of England": 1.0, "Scotland & Wales": 0.88,
};
const PROPERTIES = Object.keys(PROP_MULT);
const REGIONS = Object.keys(REGION_MULT);

type QtyConfig = {
  key: string; label: string; type: "qty"; unit: string; unitPlural: string;
  min: number; max: number;
  recommend: (property: string) => number;
  weight: (qty: number, ctx: { property: string }) => number;
};
type OptionsConfig = {
  key: string; label: string; type?: undefined;
  options: string[]; default: string; weight: Record<string, number>;
};
type ItemConfig = QtyConfig | OptionsConfig;
type WorkItem = { key: string; label: string; low: number; base: number; high: number; configs: ItemConfig[]; note: string; };
type ItemCfg = Record<string, string | number>;

const ITEMS: WorkItem[] = [
  {
    key: "kitchen", label: "Kitchen renovation", low: 8500, base: 14500, high: 22000,
    configs: [
      { key: "size", label: "Size", options: ["Small", "Medium", "Large"], default: "Medium",
        weight: { Small: 0.7, Medium: 1.0, Large: 1.5 } },
      { key: "layout", label: "Layout", options: ["Same", "Move plumbing", "Full reconfigure"], default: "Same",
        weight: { "Same": 1.0, "Move plumbing": 1.15, "Full reconfigure": 1.4 } },
    ],
    note: "Keeping the kitchen layout where it is saves 25–30% on labour. Move plumbing only if the existing layout genuinely doesn't work — not because you fancy a change.",
  },
  {
    key: "bathroom", label: "Bathroom renovation", low: 6000, base: 9800, high: 14000,
    configs: [
      { key: "count", label: "Bathrooms", type: "qty", unit: "bathroom", unitPlural: "bathrooms",
        min: 1, max: 8, recommend: () => 1, weight: (q) => 1 + 0.8 * (q - 1) },
      { key: "plumbing", label: "Plumbing", options: ["Keep", "Replumb"], default: "Replumb",
        weight: { "Keep": 0.8, "Replumb": 1.0 } },
    ],
    note: "If the existing soil pipe stack works for your layout, leave it. Moving a soil pipe through joists adds days of work and structural sign-off.",
  },
  {
    key: "loft", label: "Loft conversion", low: 38000, base: 52000, high: 78000,
    configs: [
      { key: "type", label: "Type", options: ["Rooflight", "Dormer", "Mansard", "Hip-to-gable"], default: "Dormer",
        weight: { "Rooflight": 0.7, "Dormer": 1.0, "Mansard": 1.4, "Hip-to-gable": 1.2 } },
      { key: "ensuite", label: "En-suite", options: ["No", "Yes"], default: "No",
        weight: { "No": 1.0, "Yes": 1.18 } },
    ],
    note: "Dormers add the most usable head-height per pound. Mansards look better in conservation areas but cost ~40% more.",
  },
  {
    key: "side", label: "Side return extension", low: 32000, base: 48000, high: 72000,
    configs: [
      { key: "width", label: "Width", options: ["Narrow", "Standard", "Wide"], default: "Standard",
        weight: { "Narrow": 0.75, "Standard": 1.0, "Wide": 1.35 } },
    ],
    note: "Standard side returns assume an existing rear room you're widening. Wide returns usually mean planning permission, not just permitted development.",
  },
  {
    key: "rear", label: "Rear extension", low: 36000, base: 54000, high: 82000,
    configs: [
      { key: "size", label: "Size", options: ["Small", "Medium", "Large"], default: "Medium",
        weight: { "Small": 0.7, "Medium": 1.0, "Large": 1.5 } },
      { key: "storeys", label: "Storeys", options: ["Single", "Double"], default: "Single",
        weight: { "Single": 1.0, "Double": 1.7 } },
    ],
    note: "Double-storey extensions cost roughly 1.7× a single — same foundations, double the upstairs.",
  },
  {
    key: "rewire", label: "Full rewire", low: 4500, base: 6800, high: 9500,
    configs: [
      { key: "beds", label: "Bedrooms", type: "qty", unit: "bedroom", unitPlural: "bedrooms",
        min: 1, max: 10,
        recommend: (prop) => ({ Flat: 2, Terrace: 3, "Semi-detached": 3, Detached: 4 }[prop] ?? 3),
        weight: (q) => q / 3 },
    ],
    note: "Plan rewires alongside other works — chasing into freshly-decorated walls is the silliest line on any renovation invoice.",
  },
  {
    key: "boiler", label: "New boiler / heating", low: 2400, base: 3500, high: 5200,
    configs: [
      { key: "type", label: "Type", options: ["Combi", "System", "Heat pump"], default: "Combi",
        weight: { "Combi": 1.0, "System": 1.2, "Heat pump": 3.5 } },
      { key: "rads", label: "Extra radiators", type: "qty", unit: "extra rad", unitPlural: "extra rads",
        min: 0, max: 20, recommend: () => 0, weight: (q) => 1 + 0.08 * q },
    ],
    note: "Heat pumps run 3–4× a like-for-like combi swap on capital cost. Worth it long-term — but model the BUS grant against your timeline.",
  },
  {
    key: "windows", label: "New windows", low: 7500, base: 11000, high: 16500,
    configs: [
      { key: "qty", label: "Number of windows", type: "qty", unit: "window", unitPlural: "windows",
        min: 1, max: 60,
        recommend: (prop) => ({ Flat: 6, Terrace: 10, "Semi-detached": 14, Detached: 20 }[prop] ?? 12),
        weight: (q, { property }) => q / ({ Flat: 6, Terrace: 10, "Semi-detached": 14, Detached: 20 }[property] ?? 12) },
      { key: "material", label: "Material", options: ["uPVC", "Timber", "Alu-clad"], default: "uPVC",
        weight: { "uPVC": 1.0, "Timber": 1.8, "Alu-clad": 2.2 } },
    ],
    note: "Conservation areas often require timber sashes. Get that in writing from the planning officer before pricing aluminium.",
  },
  {
    key: "refurb", label: "Full refurbishment", low: 84000, base: 112000, high: 168000,
    configs: [
      { key: "spec", label: "Spec", options: ["Low", "Mid", "High"], default: "Mid",
        weight: { "Low": 0.75, "Mid": 1.0, "High": 1.5 } },
    ],
    note: "Don't pick \"High\" because it sounds nicer. Most buyers can't price the difference between mid-spec joinery and high-spec joinery — your money is better spent on plan, not finish.",
  },
];

function calcItem(item: WorkItem, cfg: ItemCfg | undefined, property: string, propMult: number, regionMult: number) {
  let m = 1;
  for (const c of item.configs) {
    if (c.type === "qty") {
      const val = (cfg?.[c.key] as number | undefined) ?? c.recommend(property);
      m *= c.weight(val, { property });
    } else {
      const val = (cfg?.[c.key] as string | undefined) ?? c.default;
      m *= c.weight[val] ?? 1;
    }
  }
  return {
    low:  Math.round(item.low  * m * propMult * regionMult / 100) * 100,
    est:  Math.round(item.base * m * propMult * regionMult / 100) * 100,
    high: Math.round(item.high * m * propMult * regionMult / 100) * 100,
  };
}

const fmt = (n: number) => "£" + n.toLocaleString("en-GB");

function cfgSummary(item: WorkItem, cfg: ItemCfg | undefined, property: string) {
  return item.configs
    .map((c) => {
      if (c.type === "qty") {
        const v = (cfg?.[c.key] as number | undefined) ?? c.recommend(property);
        return `${v} ${v === 1 ? c.unit : c.unitPlural}`;
      }
      return (cfg?.[c.key] as string | undefined) ?? c.default;
    })
    .join(" · ");
}

// ── URL serialization ─────────────────────────────────────────────────────────
const PROP_TO_KEY: Record<string, string> = {
  "Flat": "flat", "Terrace": "terrace", "Semi-detached": "semi", "Detached": "detached",
};
const KEY_TO_PROP: Record<string, string> = {
  flat: "Flat", terrace: "Terrace", semi: "Semi-detached", detached: "Detached",
};
const REGION_TO_KEY: Record<string, string> = {
  "London": "london", "South East": "southeast", "Rest of England": "england", "Scotland & Wales": "scotwales",
};
const KEY_TO_REGION: Record<string, string> = {
  london: "London", southeast: "South East", england: "Rest of England", scotwales: "Scotland & Wales",
};

function serializeState(
  property: string, region: string,
  selected: Record<string, boolean>, configs: Record<string, ItemCfg>,
): string {
  const p = new URLSearchParams();
  p.set("prop", PROP_TO_KEY[property] ?? "semi");
  p.set("region", REGION_TO_KEY[region] ?? "england");
  const sel = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  if (sel.length > 0) p.set("items", sel.join(","));
  for (const itemKey of sel) {
    const item = ITEMS.find(i => i.key === itemKey);
    if (!item) continue;
    const cfg = configs[itemKey];
    if (!cfg) continue;
    for (const c of item.configs) {
      const val = cfg[c.key];
      if (val !== undefined) p.set(`${itemKey}_${c.key}`, String(val));
    }
  }
  return p.toString();
}

function deserializeState(params: URLSearchParams): {
  property: string; region: string;
  selected: Record<string, boolean>; configs: Record<string, ItemCfg>;
} | null {
  const propKey = params.get("prop");
  const regionKey = params.get("region");
  if (!propKey && !regionKey && !params.get("items")) return null;
  const property = (propKey && KEY_TO_PROP[propKey]) || "Semi-detached";
  const region = (regionKey && KEY_TO_REGION[regionKey]) || "Rest of England";
  const selected: Record<string, boolean> = { kitchen: true, bathroom: true };
  const itemsParam = params.get("items");
  if (itemsParam) {
    selected.kitchen = false;
    selected.bathroom = false;
    const validKeys = new Set(ITEMS.map(i => i.key));
    for (const k of itemsParam.split(",")) {
      if (validKeys.has(k)) selected[k] = true;
    }
  }
  const configs: Record<string, ItemCfg> = {};
  const selectedKeys = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  for (const itemKey of selectedKeys) {
    const item = ITEMS.find(i => i.key === itemKey);
    if (!item) continue;
    const cfg: ItemCfg = {};
    for (const c of item.configs) {
      const raw = params.get(`${itemKey}_${c.key}`);
      if (raw !== null) {
        if (c.type === "qty") {
          const num = parseInt(raw, 10);
          if (!isNaN(num)) cfg[c.key] = num;
        } else {
          if (c.options.includes(raw)) cfg[c.key] = raw;
        }
      }
    }
    if (Object.keys(cfg).length > 0) configs[itemKey] = cfg;
  }
  return { property, region, selected, configs };
}

// ── Atoms ─────────────────────────────────────────────────────────────────────
function Eyebrow({ children, color = COLORS.green }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" as const, color }}>
      {children}
    </div>
  );
}

function Italic({ children, color = COLORS.green }: { children: React.ReactNode; color?: string }) {
  return <span style={{ fontStyle: "italic", color }}>{children}</span>;
}

function Chip({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rc-chip${active ? " rc-chip-active" : ""}`}
      style={{
        background: active ? COLORS.green : "transparent",
        color: active ? COLORS.bg : COLORS.text2,
        border: `0.5px solid ${active ? COLORS.green : COLORS.border}`,
        fontSize: 13, fontWeight: 500,
        padding: "9px 16px", borderRadius: 100, cursor: "pointer",
        whiteSpace: "nowrap" as const, transition: "all 160ms", fontFamily: BODY_FONT,
      }}
    >{children}</button>
  );
}

function CheckBox({ on, size = 18 }: { on?: boolean; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 5, flexShrink: 0,
      background: on ? COLORS.green : "transparent",
      border: on ? `0.5px solid ${COLORS.green}` : `1px solid rgba(26,17,8,0.18)`,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: COLORS.bg, fontSize: 11, fontWeight: 600, transition: "all 160ms",
    }}>{on ? "✓" : ""}</span>
  );
}

function H2Rule({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 16 }}>
      <div style={{ width: 3, background: COLORS.green, borderRadius: 2, flexShrink: 0 }} />
      <h2 style={{
        margin: 0, padding: "2px 0", fontFamily: HEADING_FONT, fontSize: 28,
        fontWeight: 400, color: COLORS.dark, letterSpacing: "-0.5px", lineHeight: 1.15,
      }}>{children}</h2>
    </div>
  );
}

// ── Qty Stepper ────────────────────────────────────────────────────────────────
function StepBtn({ children, onClick, disabled, label }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rc-step-btn"
      style={{
        width: 30, height: 30, borderRadius: 999,
        background: disabled ? "transparent" : COLORS.card,
        border: `0.5px solid ${disabled ? "transparent" : COLORS.border}`,
        color: disabled ? "rgba(26,17,8,0.35)" : COLORS.dark,
        fontSize: 18, fontWeight: 400,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transition: "all 160ms", padding: 0, lineHeight: 1,
      }}
    >{children}</button>
  );
}

function QtyStepper({ value, min, max, recommend, onChange, onReset, recommendLabel }: {
  value: number; min: number; max: number; recommend: number;
  onChange: (v: number) => void; onReset: () => void; recommendLabel?: string;
}) {
  const atRecommend = value === recommend;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column" as const, gap: 6, alignItems: "flex-start" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 2,
        background: COLORS.bg, border: `0.5px solid ${COLORS.border}`,
        borderRadius: 100, padding: 4,
      }}>
        <StepBtn label="Decrease" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</StepBtn>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (isNaN(v)) return;
            onChange(Math.min(max, Math.max(min, v)));
          }}
          style={{
            width: 50, textAlign: "center", background: "transparent",
            border: 0, fontFamily: HEADING_FONT, fontSize: 22, fontWeight: 400,
            color: COLORS.dark, letterSpacing: "-0.5px", outline: "none",
            padding: "0 4px",
          } as CSSProperties}
        />
        <StepBtn label="Increase" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</StepBtn>
      </div>
      <div style={{
        fontFamily: HEADING_FONT, fontStyle: "italic", fontSize: 12,
        color: atRecommend ? COLORS.green : COLORS.muted, lineHeight: 1.4,
      }}>
        {recommendLabel ?? `Typical: ${recommend}`}
        {!atRecommend && (
          <>
            {" · "}
            <button
              onClick={onReset}
              type="button"
              className="rc-reset-btn"
              style={{
                background: "transparent", border: 0, padding: 0, cursor: "pointer",
                fontFamily: HEADING_FONT, fontStyle: "italic", fontSize: 12, color: COLORS.green,
                textDecoration: "underline", textUnderlineOffset: 3,
              }}
            >reset</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── QCard ─────────────────────────────────────────────────────────────────────
type QState = "answered" | "active" | "locked";

function QCard({ step, title, subtitle, state, summary, onEdit, children }: {
  step: number; title: string; subtitle?: string; state: QState;
  summary?: string; onEdit?: () => void; children?: React.ReactNode;
}) {
  const answered = state === "answered";
  const active = state === "active";
  const locked = state === "locked";

  return (
    <div
      className="rc-qcard"
      style={{
        background: active ? COLORS.card : "transparent",
        border: `0.5px solid ${active ? COLORS.green : COLORS.border}`,
        borderRadius: 14, padding: active ? "22px 26px" : "18px 24px",
        opacity: locked ? 0.55 : 1, transition: "all 200ms",
      }}
    >
      <div style={{
        display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" as const,
        marginBottom: (active && children) ? 18 : 0,
      }}>
        <span style={{
          fontFamily: HEADING_FONT, fontSize: 13, fontStyle: "italic",
          color: locked ? COLORS.muted : COLORS.green, fontWeight: 400, flexShrink: 0,
        }}>{String(step).padStart(2, "0")}</span>
        <span style={{
          fontFamily: HEADING_FONT, fontSize: active ? 24 : 20, color: COLORS.dark,
          letterSpacing: "-0.3px", fontWeight: 400,
        }}>{title}</span>
        {subtitle && active && (
          <span style={{ fontSize: 12, color: COLORS.muted, fontStyle: "italic" }}>· {subtitle}</span>
        )}
        {answered && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: COLORS.text2 }}>{summary}</span>
            <button
              onClick={onEdit}
              className="rc-edit-btn"
              style={{
                background: "transparent", border: 0, padding: "4px 8px",
                fontSize: 12, color: COLORS.green, fontWeight: 500,
                textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer",
              }}
            >Edit</button>
          </span>
        )}
        {locked && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: COLORS.muted, fontStyle: "italic" }}>
            answer above to unlock
          </span>
        )}
      </div>
      {active && children}
    </div>
  );
}

// ── ItemConfigPanel ───────────────────────────────────────────────────────────
function ItemConfigPanel({ item, cfg, property, onChange, note, contributionStr }: {
  item: WorkItem; cfg: ItemCfg | undefined; property: string;
  onChange: (cfg: ItemCfg) => void; note: string; contributionStr: string;
}) {
  return (
    <div style={{
      marginTop: 14, background: COLORS.bg, borderRadius: 12,
      padding: "16px 20px", border: `0.5px solid ${COLORS.border}`,
    }}>
      <div className="rc-config-split" style={{ display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" as const }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" as const, flex: 1, minWidth: 260 }}>
          {item.configs.map((c) => {
            if (c.type === "qty") {
              const recValue = c.recommend(property);
              const cur = (cfg?.[c.key] as number | undefined) ?? recValue;
              const propAware = c.recommend.length > 0;
              return (
                <div key={c.key}>
                  <Eyebrow color={COLORS.muted}>{c.label}</Eyebrow>
                  <div style={{ marginTop: 8 }}>
                    <QtyStepper
                      value={cur}
                      min={c.min}
                      max={c.max}
                      recommend={recValue}
                      recommendLabel={propAware ? `Typical for ${property}: ${recValue}` : `Typical: ${recValue}`}
                      onChange={(v) => onChange({ ...(cfg ?? {}), [c.key]: v })}
                      onReset={() => {
                        const next = { ...(cfg ?? {}) };
                        delete next[c.key];
                        onChange(next);
                      }}
                    />
                  </div>
                </div>
              );
            }
            return (
              <div key={c.key}>
                <Eyebrow color={COLORS.muted}>{c.label}</Eyebrow>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                  {c.options.map(opt => (
                    <Chip
                      key={opt}
                      active={((cfg?.[c.key] as string | undefined) ?? c.default) === opt}
                      onClick={() => onChange({ ...(cfg ?? {}), [c.key]: opt })}
                    >{opt}</Chip>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div
          className="rc-config-note"
          style={{
            minWidth: 180, maxWidth: 300,
            paddingLeft: 24, borderLeft: `0.5px solid ${COLORS.border}`,
            fontFamily: HEADING_FONT, fontStyle: "italic", fontSize: 13,
            color: COLORS.text2, lineHeight: 1.55,
          }}
        >{note}</div>
      </div>
      <div style={{
        marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${COLORS.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
      }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>Contributes</span>
        <span style={{
          fontFamily: HEADING_FONT, fontSize: 22, color: COLORS.dark, letterSpacing: "-0.3px",
        }}>{contributionStr}</span>
      </div>
    </div>
  );
}

// ── Sticky Tally Bar (wired: Save copies URL, Email posts to existing route) ──
function StickyTallyBar({ total, low, high, selectedCount, emailItems, property, region, getShareUrl, visible }: {
  total: number; low: number; high: number; selectedCount: number;
  emailItems: Array<{ label: string; mid: number; low: number; high: number }>;
  property: string; region: string; getShareUrl: () => string; visible: boolean;
}) {
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
        body: JSON.stringify({ email, items: emailItems, total, region, propertyType: property }),
      });
      setEmailStatus(res.ok ? "sent" : "error");
    } catch { setEmailStatus("error"); }
  };

  return (
    <div
      className="rc-tally"
      style={{
        position: "fixed" as const, top: 0, left: 0, right: 0, zIndex: 80,
        background: COLORS.dark, color: COLORS.bg,
        padding: "14px 56px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 24, boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
        transform: visible ? "translateY(0)" : "translateY(-100%)",
        transition: "transform 220ms ease-in-out",
      }}
    >
      <div>
        <div style={{
          fontSize: 10, fontWeight: 500, letterSpacing: "0.1em",
          textTransform: "uppercase" as const, color: "rgba(241,239,232,0.55)",
        }}>Running estimate</div>
        <div style={{ marginTop: 2, display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{
            fontFamily: HEADING_FONT, fontSize: 32, fontWeight: 400,
            color: COLORS.bg, letterSpacing: "-0.5px", lineHeight: 1, transition: "all 200ms",
          }}>{fmt(total)}</span>
          <span style={{ fontSize: 12, color: "rgba(241,239,232,0.6)" }}>
            {fmt(low)} – {fmt(high)} · {selectedCount} {selectedCount === 1 ? "item" : "items"}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleSave} className="rc-tally-btn" style={{
            background: "transparent", color: COLORS.bg,
            border: "0.5px solid rgba(241,239,232,0.3)",
            fontSize: 12, fontWeight: 500,
            borderRadius: 100, padding: "8px 14px", cursor: "pointer", whiteSpace: "nowrap" as const,
            fontFamily: BODY_FONT,
          }}>{copied ? "Link copied!" : "↗ Share"}</button>
          <button onClick={() => { setShowEmail(v => !v); setEmailStatus("idle"); }} className="rc-tally-btn" style={{
            background: COLORS.greenLight, color: COLORS.dark, border: 0,
            fontSize: 12, fontWeight: 500,
            borderRadius: 100, padding: "8px 16px", cursor: "pointer", whiteSpace: "nowrap" as const,
            fontFamily: BODY_FONT,
          }}>✉ Email quote</button>
        </div>
        {showEmail && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {emailStatus === "sent" ? (
              <span style={{ fontSize: 13, color: "#7AC97A" }}>Sent! Check your inbox.</span>
            ) : emailStatus === "error" ? (
              <span style={{ fontSize: 13, color: "#E05A45" }}>Something went wrong — try again.</span>
            ) : (
              <>
                <input
                  type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
                  placeholder="your@email.com"
                  className="rc-email-input"
                  style={{
                    padding: "8px 12px", fontSize: 13,
                    background: "rgba(255,253,249,0.08)", border: "0.5px solid rgba(255,253,249,0.2)",
                    borderRadius: 8, color: "#FFFDF9", outline: "none", fontFamily: BODY_FONT,
                    width: 200,
                  }}
                />
                <button
                  type="button" onClick={handleSend}
                  disabled={emailStatus === "sending" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                  className="rc-tally-send"
                  style={{
                    fontSize: 12, fontWeight: 500, color: "#FFFDF9",
                    background: COLORS.green, border: "none",
                    borderRadius: 100, padding: "8px 16px",
                    cursor: emailStatus === "sending" ? "wait" : "pointer",
                    opacity: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 0.45 : 1,
                    fontFamily: BODY_FONT, flexShrink: 0,
                  }}
                >{emailStatus === "sending" ? "Sending…" : "Send"}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── FAQ ────────────────────────────────────────────────────────────────────────
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
          <path d="M3 5.5L8 10.5L13 5.5" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div style={{ maxHeight: open ? 400 : 0, overflow: "hidden", transition: "max-height 0.22s ease" }}>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: "0 0 18px" }}>{a}</p>
      </div>
    </div>
  );
}

// ── SEO schemas ────────────────────────────────────────────────────────────────
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
  mainEntity: FAQ_ITEMS.map(item => ({
    "@type": "Question", name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

// ── Route ─────────────────────────────────────────────────────────────────────
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

// ── Main component ─────────────────────────────────────────────────────────────
function RenovationCalculator() {
  const router = useRouter();
  const navigate = useNavigate();

  const [property, setProperty] = useState("Semi-detached");
  const [region, setRegion] = useState("Rest of England");
  const [selected, setSelected] = useState<Record<string, boolean>>({ kitchen: true, bathroom: true });
  const [configs, setConfigs] = useState<Record<string, ItemCfg>>({});
  const [answered, setAnswered] = useState<Record<number, boolean>>({});
  const [active, setActive] = useState(1);
  const [tallyVisible, setTallyVisible] = useState(false);
  const heroEndRef = useRef<HTMLDivElement>(null);

  // Show/hide tally bar based on hero scrolling out of view
  useEffect(() => {
    if (typeof window === "undefined" || !heroEndRef.current) return;
    const sentinel = heroEndRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show bar once sentinel has scrolled above the viewport top
        setTallyVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Restore from URL on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = deserializeState(params);
    if (fromUrl) {
      setProperty(fromUrl.property);
      setRegion(fromUrl.region);
      setSelected(fromUrl.selected);
      setConfigs(fromUrl.configs);
      const selCount = Object.values(fromUrl.selected).filter(Boolean).length;
      const totalSteps = 2 + selCount;
      const ans: Record<number, boolean> = {};
      for (let i = 1; i <= totalSteps; i++) ans[i] = true;
      setAnswered(ans);
      setActive(totalSteps + 1);
    }
  }, []);

  // Sync URL on state change (no scroll-jump via _ignoreSubscribers)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = serializeState(property, region, selected, configs);
    const hist = (router as any).history;
    hist._ignoreSubscribers = true;
    window.history.replaceState(null, "", `${window.location.pathname}?${qs}`);
    hist._ignoreSubscribers = false;
  }, [property, region, selected, configs, router]);

  const propMult = PROP_MULT[property];
  const regionMult = REGION_MULT[region];

  const computed = useMemo(() => {
    const items = ITEMS.map(item => ({
      item, ...calcItem(item, configs[item.key], property, propMult, regionMult),
    }));
    const activeItems = items.filter(o => selected[o.item.key]);
    const total = activeItems.reduce((s, o) => s + o.est, 0);
    const low   = activeItems.reduce((s, o) => s + o.low, 0);
    const high  = activeItems.reduce((s, o) => s + o.high, 0);
    return { items, total, low, high };
  }, [property, region, selected, configs, propMult, regionMult]);

  const selectedItems = ITEMS.filter(it => selected[it.key]);
  const selectedCount = selectedItems.length;
  const answeredCount = Object.values(answered).filter(Boolean).length;

  function toggleItem(key: string) {
    setSelected(s => ({ ...s, [key]: !s[key] }));
  }
  function setItemCfg(key: string, cfg: ItemCfg) {
    setConfigs(c => ({ ...c, [key]: cfg }));
  }

  // Item A: Vett listing CTA → focus homepage input
  const handleVettListing = () => {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem("vettFocusInput", "1");
    navigate({ to: "/" });
  };

  // Item C: share URL for Save button
  const getShareUrl = () => typeof window !== "undefined" ? window.location.href : "";

  const emailItems = computed.items
    .filter(o => selected[o.item.key])
    .map(o => ({ label: o.item.label, mid: o.est, low: o.low, high: o.high }));

  const q1State: QState = active === 1 ? "active" : (answered[1] ? "answered" : "locked");
  const q2State: QState = active === 2 ? "active" : (answered[2] ? "answered" : "locked");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.dark, fontFamily: BODY_FONT }}>
      {/* Item D — hover CSS + number input spinners + mobile padding */}
      <style>{`
        .rc-chip { transition: all 160ms; cursor: pointer; }
        .rc-chip:not(.rc-chip-active):hover { background: #EAF3DE !important; border-color: #2D6A4F !important; }
        .rc-chip.rc-chip-active:hover { background: #236b45 !important; }
        .rc-qcard { transition: border-color 200ms, opacity 200ms; }
        .rc-qcard:not([style*="opacity: 0"]):hover { border-color: #2D6A4F !important; }
        .rc-work-card { transition: all 160ms; cursor: pointer; }
        .rc-work-card:not(.rc-work-active):hover { border-color: #2D6A4F !important; }
        .rc-step-btn { transition: all 160ms; cursor: pointer; }
        .rc-step-btn:not(:disabled):hover { background: #EAF3DE !important; border-color: #2D6A4F !important; }
        .rc-continue-btn { transition: opacity 160ms; cursor: pointer; }
        .rc-continue-btn:hover { opacity: 0.82 !important; }
        .rc-back-btn { transition: color 160ms; cursor: pointer; }
        .rc-back-btn:hover { color: #1A1108 !important; }
        .rc-edit-btn { transition: opacity 160ms; cursor: pointer; }
        .rc-edit-btn:hover { opacity: 0.65 !important; }
        .rc-reset-btn { transition: opacity 160ms; cursor: pointer; }
        .rc-reset-btn:hover { opacity: 0.65 !important; }
        .rc-tally-btn { transition: all 160ms; cursor: pointer; }
        .rc-tally-btn:hover { background: rgba(255,253,249,0.15) !important; border-color: rgba(255,253,249,0.45) !important; }
        .rc-tally-send { transition: opacity 160ms; cursor: pointer; }
        .rc-tally-send:hover:not(:disabled) { opacity: 0.82 !important; }
        .rc-tiein-primary { transition: opacity 160ms; cursor: pointer; }
        .rc-tiein-primary:hover { opacity: 0.88 !important; }
        .rc-tiein-secondary { transition: all 160ms; cursor: pointer; }
        .rc-tiein-secondary:hover { border-color: rgba(255,253,249,0.5) !important; color: rgba(255,253,249,0.95) !important; }
        .rc-email-input:focus { border-color: #2D6A4F !important; outline: none; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; appearance: textfield; }
        @media (max-width: 640px) {
          .rc-hero  { padding: 32px 20px 16px !important; }
          .rc-cards { padding: 8px 16px 32px !important; }
          .rc-tally { padding: 12px 16px !important; }
          .rc-prose { padding: 8px 20px 80px !important; }
          .rc-config-split { flex-direction: column !important; }
          .rc-config-note { border-left: none !important; padding-left: 0 !important;
            border-top: 0.5px solid rgba(26,17,8,0.10) !important; padding-top: 12px !important; }
          .rc-tiein-wrap { flex-direction: column !important; }
        }
      `}</style>

      <StickyTallyBar
        total={computed.total} low={computed.low} high={computed.high}
        selectedCount={selectedCount} emailItems={emailItems}
        property={property} region={region} getShareUrl={getShareUrl}
        visible={tallyVisible}
      />

      <SiteHeader />

      <main>
        {/* Hero */}
        <div className="rc-hero" style={{ padding: "44px 56px 24px", maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          <div style={{
            fontSize: 11, fontWeight: 500, letterSpacing: "0.1em",
            textTransform: "uppercase", color: COLORS.green,
          }}>Free tool · Renovation calculator</div>
          {/* Sentinel: bar appears as h1 title top reaches the viewport top */}
          <div ref={heroEndRef} style={{ height: 0 }} />
          <h1 style={{
            margin: "12px 0 10px", fontFamily: HEADING_FONT,
            fontSize: "clamp(32px, 5vw, 44px)", fontWeight: 400,
            color: COLORS.dark, letterSpacing: "-1px", lineHeight: 1.05,
          }}>
            Let's <Italic>cost it</Italic> properly.
          </h1>
          <p style={{
            margin: 0, fontFamily: HEADING_FONT, fontStyle: "italic", fontSize: 17,
            color: COLORS.text2, lineHeight: 1.5,
          }}>
            Build your renovation, line by line — we'll guide the price.
          </p>
        </div>

        {/* Q-cards */}
        <div className="rc-cards" style={{
          padding: "8px 56px 32px", maxWidth: 820, margin: "0 auto",
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          {/* Q1 — Property + Region */}
          <QCard
            step={1} title="The property"
            subtitle="Type drives base cost; region is the single biggest multiplier."
            state={q1State}
            summary={`${property} · ${region}`}
            onEdit={() => setActive(1)}
          >
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              <div>
                <Eyebrow>Type</Eyebrow>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {PROPERTIES.map(p => (
                    <Chip key={p} active={p === property} onClick={() => setProperty(p)}>{p}</Chip>
                  ))}
                </div>
              </div>
              <div>
                <Eyebrow>Region</Eyebrow>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {REGIONS.map(r => (
                    <Chip key={r} active={r === region} onClick={() => setRegion(r)}>{r}</Chip>
                  ))}
                </div>
                <div style={{
                  marginTop: 8, fontFamily: HEADING_FONT, fontStyle: "italic", fontSize: 12,
                  color: COLORS.text2, lineHeight: 1.5, maxWidth: 360,
                }}>
                  London adds ~30%. Scotland &amp; Wales typically come in 10–15% below the national average.
                </div>
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <button
                className="rc-continue-btn"
                onClick={() => { setAnswered(a => ({ ...a, 1: true })); setActive(2); }}
                style={{
                  background: COLORS.dark, color: COLORS.bg, border: 0,
                  fontSize: 13, fontWeight: 500, borderRadius: 100,
                  padding: "9px 20px", cursor: "pointer", fontFamily: BODY_FONT,
                }}
              >Continue →</button>
            </div>
          </QCard>

          {/* Q2 — Work selection */}
          <QCard
            step={2} title="What are you doing?"
            subtitle="Toggle every piece of work — we'll ask about each in turn."
            state={q2State}
            summary={`${selectedCount} ${selectedCount === 1 ? "item" : "items"} selected`}
            onEdit={() => setActive(2)}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {computed.items.map(({ item, est, low }) => {
                const isOn = !!selected[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`rc-work-card${isOn ? " rc-work-active" : ""}`}
                    onClick={() => toggleItem(item.key)}
                    style={{
                      background: isOn ? COLORS.card : "transparent",
                      border: `0.5px solid ${isOn ? COLORS.green : COLORS.border}`,
                      borderRadius: 10, padding: "10px 14px",
                      display: "flex", alignItems: "center", gap: 10,
                      cursor: "pointer", textAlign: "left", width: "100%",
                    }}
                  >
                    <CheckBox on={isOn} size={16} />
                    <span style={{
                      flex: 1, fontSize: 13,
                      fontWeight: isOn ? 500 : 400, color: COLORS.dark,
                    }}>{item.label}</span>
                    <span style={{
                      fontFamily: isOn ? HEADING_FONT : undefined,
                      fontSize: isOn ? 14 : 11,
                      color: isOn ? COLORS.dark : COLORS.muted,
                    }}>{isOn ? fmt(est) : `from ${fmt(low)}`}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                className="rc-back-btn"
                onClick={() => setActive(1)}
                style={{
                  background: "transparent", color: COLORS.text2, border: 0,
                  fontSize: 13, cursor: "pointer", padding: "9px 0", fontFamily: BODY_FONT,
                }}
              >← Back</button>
              <button
                className="rc-continue-btn"
                onClick={() => {
                  setAnswered(a => {
                    const next: Record<number, boolean> = { ...a, 2: true };
                    // Clear item-step answers so re-selection prompts re-answering
                    for (const k of Object.keys(next)) {
                      if (Number(k) >= 3) delete next[Number(k)];
                    }
                    return next;
                  });
                  setActive(3);
                }}
                style={{
                  background: COLORS.dark, color: COLORS.bg, border: 0,
                  fontSize: 13, fontWeight: 500, borderRadius: 100,
                  padding: "9px 20px", cursor: "pointer", fontFamily: BODY_FONT,
                }}
              >Continue · {selectedCount} to refine →</button>
            </div>
          </QCard>

          {/* Q3+ — one card per selected item */}
          {selectedItems.map((item, idx) => {
            const step = 3 + idx;
            const itemState: QState = active === step ? "active" : (answered[step] ? "answered" : "locked");
            const result = calcItem(item, configs[item.key], property, propMult, regionMult);
            return (
              <QCard
                key={item.key}
                step={step}
                title={`The ${item.label.toLowerCase().replace(" renovation", "")}`}
                subtitle="Spec drives the figure."
                state={itemState}
                summary={`${cfgSummary(item, configs[item.key], property)} · ${fmt(result.est)}`}
                onEdit={() => setActive(step)}
              >
                <ItemConfigPanel
                  item={item}
                  cfg={configs[item.key]}
                  property={property}
                  onChange={(cfg) => setItemCfg(item.key, cfg)}
                  note={item.note}
                  contributionStr={fmt(result.est)}
                />
                <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    className="rc-back-btn"
                    onClick={() => setActive(step - 1)}
                    style={{
                      background: "transparent", color: COLORS.text2, border: 0,
                      fontSize: 13, cursor: "pointer", padding: "9px 0", fontFamily: BODY_FONT,
                    }}
                  >← Back</button>
                  <button
                    className="rc-continue-btn"
                    onClick={() => { setAnswered(a => ({ ...a, [step]: true })); setActive(step + 1); }}
                    style={{
                      background: COLORS.dark, color: COLORS.bg, border: 0,
                      fontSize: 13, fontWeight: 500, borderRadius: 100,
                      padding: "9px 20px", cursor: "pointer", fontFamily: BODY_FONT,
                    }}
                  >Continue →</button>
                </div>
              </QCard>
            );
          })}

          {/* Tie-in card: surfaces once all steps answered */}
          {answeredCount >= 2 + selectedCount && selectedCount > 0 && (
            <div
              className="rc-tiein-wrap"
              style={{
                marginTop: 16, padding: "24px 28px",
                background: COLORS.darkGreen, color: COLORS.bg, borderRadius: 14,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 16, flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{
                  fontFamily: HEADING_FONT, fontStyle: "italic", fontSize: 20,
                  color: COLORS.bg, letterSpacing: "-0.2px", lineHeight: 1.2,
                }}>Looking at a specific listing?</div>
                <div style={{
                  fontSize: 13, color: "rgba(241,239,232,0.65)",
                  marginTop: 6, maxWidth: 520, lineHeight: 1.55,
                }}>
                  We'll cost the renovation against the real property — listing photos, EPC, plot — and flag the things the agent isn't telling you.
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
                <button
                  type="button"
                  className="rc-tiein-primary"
                  onClick={handleVettListing}
                  style={{
                    background: COLORS.greenLight, color: COLORS.dark, border: 0,
                    fontSize: 13, fontWeight: 500, borderRadius: 100,
                    padding: "12px 22px", cursor: "pointer", whiteSpace: "nowrap",
                    textAlign: "center", fontFamily: BODY_FONT,
                  }}
                >Vett a listing — £4.99 →</button>
                <a
                  href="/tools/local-businesses?category=contractors"
                  className="rc-tiein-secondary"
                  style={{
                    display: "block", textAlign: "center",
                    background: "transparent",
                    border: "0.5px solid rgba(255,253,249,0.25)",
                    borderRadius: 100, padding: "12px 22px",
                    fontSize: 13, fontWeight: 400,
                    color: "rgba(241,239,232,0.75)", textDecoration: "none",
                    whiteSpace: "nowrap", fontFamily: BODY_FONT,
                  }}
                >Find tradespeople near you →</a>
              </div>
            </div>
          )}
        </div>

        {/* SEO prose + FAQ + internal links + disclaimer */}
        <div className="rc-prose" style={{ padding: "8px 56px 80px", maxWidth: 760, margin: "0 auto" }}>

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

          {/* FAQ */}
          <div style={{ marginTop: 56 }}>
            <h2 style={{ fontFamily: HEADING, fontSize: 26, fontWeight: 400, color: C.dark, letterSpacing: "-0.3px", margin: "0 0 4px" }}>
              Frequently asked questions
            </h2>
            <div style={{ marginTop: 8 }}>
              {FAQ_ITEMS.map(item => <FAQItem key={item.q} q={item.q} a={item.a} />)}
            </div>
          </div>

          {/* Internal links */}
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

          {/* Disclaimer */}
          <div style={{ marginTop: 56, borderTop: `0.5px solid ${C.border}`, paddingTop: 28 }}>
            <p style={{ fontSize: 13, color: C.veryMuted, lineHeight: 1.7, textAlign: "center", maxWidth: 600, margin: "0 auto" }}>
              Estimates are indicative only and based on 2026 UK market data. Costs include VAT at 20%. Always get at least 3 itemised quotes before committing to any contractor. Regional multipliers applied: London ×1.32, South East ×1.22, Scotland &amp; Wales ×0.88. vett renovation estimates are AI-assisted and for budgeting purposes only — they are not quotes and should not be relied upon as such.
            </p>
          </div>

        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
