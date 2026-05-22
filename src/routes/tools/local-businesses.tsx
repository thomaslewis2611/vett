import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import {
  buildPageMeta,
  buildCanonicalLink,
  jsonLdScript,
  SITE_URL,
  DEFAULT_OG_IMAGE,
} from "@/lib/seo";

// ── Design tokens ──────────────────────────────────────────────────────────────
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

// ── Types ──────────────────────────────────────────────────────────────────────
interface BusinessResult {
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  website: string | null;
  phone: string | null;
  isOpen: boolean | null;
}

interface PlaceReview {
  author: string;
  authorPhoto: string | null;
  rating: number;
  text: string;
  timeAgo: string;
}

interface PlaceReviewsData {
  name: string;
  rating: number;
  reviewCount: number;
  googleMapsUrl: string;
  reviews: PlaceReview[];
}

type Status = "idle" | "loading" | "success" | "error";

// ── Constants ──────────────────────────────────────────────────────────────────
const POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}$/i;
const DEFAULT_RADIUS = 8000;
const RADIUS_STEP = 5000;
const MAX_RADIUS = 30000;

const CATEGORIES: { id: string; label: string }[] = [
  { id: "surveyors", label: "Surveyors" },
  { id: "solicitors", label: "Solicitors" },
  { id: "architects", label: "Architects" },
  { id: "mortgage-brokers", label: "Mortgage Brokers" },
  { id: "contractors", label: "Renovation Contractors" },
  { id: "estate-agents", label: "Estate Agents" },
  { id: "removal-companies", label: "Removal Companies" },
];

const VALID_CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

// ── SEO schema ─────────────────────────────────────────────────────────────────
const softwareAppSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Local Property Professionals Finder",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Find and compare top-rated property professionals near you including surveyors, solicitors, architects, mortgage brokers, renovation contractors, estate agents and removal companies.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
  url: `${SITE_URL}/tools/local-businesses`,
  publisher: { "@type": "Organization", name: "vett", url: SITE_URL },
};

// ── Route ──────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/tools/local-businesses")({
  head: () => ({
    meta: buildPageMeta({
      title:
        "Find Local Property Professionals UK — Surveyors, Solicitors & More | vett",
      description:
        "Find top-rated surveyors, solicitors, architects, mortgage brokers, renovation contractors, estate agents and removal companies near you. Rated and ranked by review score.",
      canonicalPath: "/tools/local-businesses",
      ogImage: DEFAULT_OG_IMAGE,
    }),
    links: [buildCanonicalLink("/tools/local-businesses")],
    scripts: [jsonLdScript(softwareAppSchema)],
  }),
  component: LocalBusinesses,
});

// ── Star display ───────────────────────────────────────────────────────────────
function StarDisplay({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ color: i <= full ? "#D4A017" : "rgba(212,160,23,0.3)" }}>
          {i <= full ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}

// ── Review card ────────────────────────────────────────────────────────────────
function ReviewCard({ review }: { review: PlaceReview }) {
  const [expanded, setExpanded] = useState(false);
  const long = review.text.length > 300;
  const displayText = !long || expanded ? review.text : review.text.slice(0, 300) + "…";

  return (
    <div style={{ paddingBottom: 16, borderBottom: `0.5px solid ${C.border}` }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: C.dark }}>
          {review.author}
        </span>
        <span style={{ fontSize: 12 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} style={{ color: i <= review.rating ? "#D4A017" : "rgba(212,160,23,0.3)" }}>
              {i <= review.rating ? "★" : "☆"}
            </span>
          ))}
        </span>
      </div>
      <div style={{ fontSize: 12, color: C.veryMuted, marginBottom: 8 }}>
        {review.timeAgo}
      </div>
      <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, margin: 0 }}>
        {displayText}
        {long && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              background: "none",
              border: "none",
              color: C.green,
              cursor: "pointer",
              fontSize: 14,
              padding: "0 0 0 4px",
              fontFamily: BODY,
            }}
          >
            read more
          </button>
        )}
      </p>
    </div>
  );
}

// ── Reviews modal ──────────────────────────────────────────────────────────────
function ReviewsModal({
  target,
  onClose,
}: {
  target: BusinessResult;
  onClose: () => void;
}) {
  const [reviewStatus, setReviewStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [data, setData] = useState<PlaceReviewsData | null>(null);

  useEffect(() => {
    setReviewStatus("loading");
    setData(null);
    fetch(
      `/api/place-reviews?name=${encodeURIComponent(target.name)}&address=${encodeURIComponent(target.address)}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PlaceReviewsData>;
      })
      .then((d) => {
        setData(d);
        setReviewStatus("success");
      })
      .catch(() => setReviewStatus("error"));
  }, [target.name, target.address]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const modal = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.5)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.card,
          borderRadius: 16,
          padding: 24,
          width: "100%",
          maxWidth: 540,
          maxHeight: "85vh",
          overflowY: "auto",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 22,
            color: C.veryMuted,
            lineHeight: 1,
            padding: 4,
            fontFamily: BODY,
          }}
        >
          ×
        </button>

        {reviewStatus === "loading" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "40px 0",
              gap: 14,
            }}
          >
            <div className="lb-spinner" />
            <span style={{ fontSize: 13, color: C.veryMuted }}>Loading reviews…</span>
          </div>
        )}

        {reviewStatus === "error" && (
          <div style={{ textAlign: "center", padding: "32px 16px" }}>
            <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>
              Couldn't load reviews. View them on{" "}
              <a
                href={`https://maps.google.com/search/${encodeURIComponent(target.name + " " + target.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: C.green }}
              >
                Google Maps →
              </a>
            </p>
          </div>
        )}

        {reviewStatus === "success" && data && (
          <>
            <h3
              style={{
                fontFamily: HEADING,
                fontSize: 20,
                fontWeight: 400,
                color: C.dark,
                margin: "0 0 10px",
                paddingRight: 36,
                lineHeight: 1.3,
              }}
            >
              {data.name}
            </h3>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <StarDisplay rating={data.rating} />
              <span style={{ fontSize: 14, fontWeight: 500, color: C.dark }}>
                {data.rating.toFixed(1)}
              </span>
              <span style={{ fontSize: 13, color: C.veryMuted }}>
                ({data.reviewCount.toLocaleString("en-GB")} reviews)
              </span>
            </div>
            <hr
              style={{
                border: "none",
                borderTop: `0.5px solid ${C.border}`,
                margin: "0 0 20px",
              }}
            />

            {data.reviews.length === 0 ? (
              <p
                style={{
                  fontSize: 14,
                  color: C.muted,
                  textAlign: "center",
                  padding: "16px 0",
                }}
              >
                No written reviews available.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {data.reviews.map((r, i) => (
                  <ReviewCard key={i} review={r} />
                ))}
              </div>
            )}

            {data.googleMapsUrl && (
              <a
                href={data.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "block",
                  marginTop: 20,
                  fontSize: 14,
                  color: C.green,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                View all reviews on Google →
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

// ── Skeleton card ──────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div
      style={{
        background: C.card,
        border: `0.5px solid ${C.border}`,
        borderRadius: 16,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div className="skeleton" style={{ height: 16, width: "55%", borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 16, width: "20%", borderRadius: 4 }} />
      </div>
      <div
        className="skeleton"
        style={{ height: 13, width: "80%", borderRadius: 4, marginBottom: 6 }}
      />
      <div
        className="skeleton"
        style={{ height: 13, width: "60%", borderRadius: 4, marginBottom: 16 }}
      />
      <div style={{ display: "flex", gap: 10 }}>
        <div className="skeleton" style={{ height: 32, width: 120, borderRadius: 999 }} />
        <div className="skeleton" style={{ height: 32, width: 80, borderRadius: 999 }} />
      </div>
    </div>
  );
}

// ── Business card ──────────────────────────────────────────────────────────────
function BusinessCard({
  result,
  rank,
  onReviewClick,
}: {
  result: BusinessResult;
  rank: number;
  onReviewClick: (r: BusinessResult) => void;
}) {
  const isTopRated = rank < 3;

  return (
    <div
      style={{
        background: C.card,
        border: `0.5px solid ${C.border}`,
        borderRadius: 16,
        padding: 20,
        position: "relative",
      }}
    >
      {isTopRated && (
        <span
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            fontSize: 11,
            fontWeight: 500,
            color: C.green,
            background: C.greenTint,
            borderRadius: 100,
            padding: "3px 10px",
            whiteSpace: "nowrap",
          }}
        >
          ⭐ Top rated
        </span>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 6,
          paddingRight: isTopRated ? 100 : 0,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 500, color: C.dark, lineHeight: 1.4 }}>
          {result.name}
        </span>
      </div>

      <div style={{ marginBottom: 8 }}>
        {result.rating !== null ? (
          <button
            type="button"
            onClick={() => onReviewClick(result)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 13,
              color: C.muted,
              fontFamily: BODY,
              textDecoration: "underline",
              textDecorationStyle: "dotted",
              textUnderlineOffset: 2,
              textDecorationColor: "rgba(95,94,90,0.4)",
            }}
          >
            <span style={{ color: "#D4A017" }}>★</span>{" "}
            <span style={{ fontWeight: 500, color: C.dark }}>
              {result.rating.toFixed(1)}
            </span>{" "}
            <span style={{ color: C.veryMuted }}>
              ({result.reviewCount.toLocaleString("en-GB")} reviews)
            </span>
          </button>
        ) : (
          <span style={{ fontSize: 13, color: C.veryMuted }}>No reviews yet</span>
        )}
      </div>

      {result.isOpen !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: result.isOpen ? "#2D6A4F" : "#888780",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 12,
              color: result.isOpen ? C.green : C.veryMuted,
              fontWeight: 500,
            }}
          >
            {result.isOpen ? "Open now" : "Closed"}
          </span>
        </div>
      )}

      <p
        className="address-clamp"
        style={{ fontSize: 13, color: C.muted, margin: "0 0 14px", lineHeight: 1.5 }}
      >
        {result.address}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {result.website && (
          <a
            href={result.website}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: C.green,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: C.greenTint,
              borderRadius: 100,
              padding: "7px 14px",
            }}
          >
            Visit website →
          </a>
        )}
        {result.phone && (
          <a
            href={`tel:${result.phone}`}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: C.dark,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: `0.5px solid ${C.border}`,
              borderRadius: 100,
              padding: "7px 14px",
              background: "transparent",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path
                d="M14.5 11.5l-2.5-1.5c-.4-.2-.9-.1-1.2.2L9.5 11.5C8 10.8 5.2 8 4.5 6.5l1.3-1.3c.3-.3.4-.8.2-1.2L4.5 1.5C4.2 1.1 3.7.9 3.3 1L1.5 1.5C1.2 1.6 1 1.9 1 2.2c.2 7 5.8 12.6 12.8 12.8.3 0 .6-.2.7-.5l.5-1.8c.1-.4-.1-.9-.5-1z"
                stroke={C.muted}
                strokeWidth="1.2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Call
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
function LocalBusinesses() {
  const router = useRouter();
  const [postcode, setPostcode] = useState("");
  const [category, setCategory] = useState("surveyors");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<BusinessResult[]>([]);
  const [searchedPostcode, setSearchedPostcode] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [seenNames, setSeenNames] = useState<string[]>([]);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshExhausted, setRefreshExhausted] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<BusinessResult | null>(null);
  const initDone = useRef(false);

  const updateUrl = useCallback(
    (pc: string, cat: string) => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams();
      if (pc) params.set("postcode", pc.replace(/\s+/g, "").toUpperCase());
      params.set("category", cat);
      const hist = (router as any).history;
      const prev = hist._ignoreSubscribers;
      hist._ignoreSubscribers = true;
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params.toString()}`,
      );
      hist._ignoreSubscribers = prev;
    },
    [router],
  );

  const performSearch = useCallback(
    async (pc: string, cat: string) => {
      const normalised = pc.trim().toUpperCase();
      setStatus("loading");
      setResults([]);
      setSearchedPostcode(normalised);
      setRadius(DEFAULT_RADIUS);
      setSeenNames([]);
      setRefreshExhausted(false);
      updateUrl(normalised, cat);
      try {
        const resp = await fetch(
          `/api/local-businesses?postcode=${encodeURIComponent(normalised)}&category=${encodeURIComponent(cat)}`,
        );
        const data = await resp.json();
        if (!resp.ok) {
          setStatus("error");
        } else {
          setResults(data.results ?? []);
          setStatus("success");
        }
      } catch {
        setStatus("error");
      }
    },
    [updateUrl],
  );

  const handleRefresh = useCallback(async () => {
    const nextRadius = Math.min(radius + RADIUS_STEP, MAX_RADIUS);
    const newSeen = [...seenNames, ...results.map((r) => r.name)];
    setSeenNames(newSeen);
    setRefreshLoading(true);
    try {
      const resp = await fetch(
        `/api/local-businesses?postcode=${encodeURIComponent(searchedPostcode)}&category=${encodeURIComponent(category)}&radius=${nextRadius}&exclude=${encodeURIComponent(newSeen.join(","))}`,
      );
      const data = await resp.json();
      if (resp.ok) {
        const newResults: BusinessResult[] = data.results ?? [];
        setResults(newResults);
        setRadius(nextRadius);
        if (newResults.length === 0) setRefreshExhausted(true);
      }
    } catch {
      // keep existing results on network error
    } finally {
      setRefreshLoading(false);
    }
  }, [radius, seenNames, results, searchedPostcode, category]);

  // On mount: read URL params and auto-trigger search if present
  useEffect(() => {
    if (initDone.current || typeof window === "undefined") return;
    initDone.current = true;
    const params = new URLSearchParams(window.location.search);
    const pc = params.get("postcode") ?? "";
    const cat = params.get("category") ?? "";
    const validCat = cat && VALID_CATEGORY_IDS.has(cat) ? cat : "surveyors";
    if (pc && POSTCODE_REGEX.test(pc)) {
      const formatted = pc
        .replace(/([A-Z0-9]+?)([0-9][A-Z]{2})$/i, "$1 $2")
        .toUpperCase();
      setPostcode(formatted);
      setCategory(validCat);
      performSearch(pc, validCat);
    } else if (cat && VALID_CATEGORY_IDS.has(cat)) {
      setCategory(cat);
    }
  }, [performSearch]);

  const handleSubmit = () => {
    const trimmed = postcode.trim();
    if (!POSTCODE_REGEX.test(trimmed)) {
      setInputError("Enter a valid UK postcode, e.g. SW1A 1AA");
      return;
    }
    setInputError(null);
    performSearch(trimmed, category);
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    if (searchedPostcode) {
      performSearch(searchedPostcode, cat);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: BODY, color: C.dark }}>
      <style>{`
        @keyframes lbPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes lbSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .skeleton { animation: lbPulse 1.5s ease-in-out infinite; background: rgba(26,17,8,0.09); }
        .lb-spinner { width: 28px; height: 28px; border: 3px solid rgba(45,106,79,0.2); border-top-color: #2D6A4F; border-radius: 50%; animation: lbSpin 0.8s linear infinite; }
        .address-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .category-pills { display: flex; flex-wrap: nowrap; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 8px; }
        .category-pills::-webkit-scrollbar { display: none; }
        .category-pills button { flex-shrink: 0; white-space: nowrap; }
        input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0px 1000px #FFFDF9 inset;
          box-shadow: 0 0 0px 1000px #FFFDF9 inset;
          -webkit-text-fill-color: #1A1108;
        }
      `}</style>
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
              fontSize: "clamp(28px, 4vw, 38px)",
              fontWeight: 400,
              color: C.dark,
              letterSpacing: "-0.5px",
              lineHeight: 1.15,
              margin: "0 0 12px",
            }}
          >
            Find local property professionals
          </h1>
          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, margin: 0 }}>
            Search by postcode to find top-rated surveyors, solicitors, architects and more — ranked by review score.
          </p>
        </div>

        {/* Search bar */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8, maxWidth: 480 }}>
            <input
              type="text"
              value={postcode}
              onChange={(e) => {
                setPostcode(e.target.value.toUpperCase());
                if (inputError) setInputError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="Enter postcode e.g. SW1A 1AA"
              style={{
                flex: 1,
                padding: "12px 16px",
                fontSize: 15,
                color: C.dark,
                background: C.card,
                border: inputError ? "1px solid #C0392B" : `0.5px solid ${C.border}`,
                borderRadius: 12,
                outline: "none",
                fontFamily: BODY,
              }}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={status === "loading"}
              style={{
                padding: "12px 20px",
                fontSize: 14,
                fontWeight: 500,
                color: "#FFFDF9",
                background: C.green,
                border: "none",
                borderRadius: 12,
                cursor: status === "loading" ? "wait" : "pointer",
                opacity: status === "loading" ? 0.7 : 1,
                whiteSpace: "nowrap",
                fontFamily: BODY,
              }}
            >
              {status === "loading" ? "Searching…" : "Search"}
            </button>
          </div>
          {inputError && (
            <p style={{ fontSize: 12, color: "#C0392B", margin: "6px 0 0", lineHeight: 1.4 }}>
              {inputError}
            </p>
          )}
        </div>

        {/* Category pills */}
        <div className="category-pills" style={{ marginBottom: 32 }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategoryChange(cat.id)}
              style={{
                fontSize: 13,
                fontWeight: category === cat.id ? 500 : 400,
                color: category === cat.id ? "#FFFDF9" : C.muted,
                background: category === cat.id ? C.green : C.card,
                border: category === cat.id ? "none" : `0.5px solid ${C.border}`,
                borderRadius: 100,
                padding: "8px 16px",
                cursor: "pointer",
                transition: "all 0.12s",
                fontFamily: BODY,
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Results area — always between pills and prose */}
        <div style={{ marginBottom: status !== "idle" ? 64 : 0 }}>

          {/* Initial loading */}
          {status === "loading" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div
              style={{
                background: C.card,
                border: `0.5px solid ${C.border}`,
                borderRadius: 16,
                padding: 28,
                textAlign: "center",
              }}
            >
              <p style={{ fontSize: 15, color: C.dark, margin: "0 0 16px" }}>
                Something went wrong. Please try again.
              </p>
              <button
                type="button"
                onClick={() =>
                  searchedPostcode && performSearch(searchedPostcode, category)
                }
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#FFFDF9",
                  background: C.green,
                  border: "none",
                  borderRadius: 100,
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontFamily: BODY,
                }}
              >
                Try again
              </button>
            </div>
          )}

          {/* Success */}
          {status === "success" && (
            <>
              {/* Empty state */}
              {!refreshLoading && results.length === 0 && (
                <div
                  style={{
                    background: C.card,
                    border: `0.5px solid ${C.border}`,
                    borderRadius: 16,
                    padding: 28,
                    textAlign: "center",
                  }}
                >
                  <p style={{ fontSize: 15, color: C.muted, margin: 0, lineHeight: 1.6 }}>
                    {refreshExhausted ? (
                      "No more results found nearby. You've seen all professionals in the area."
                    ) : (
                      <>
                        No results found near{" "}
                        <strong style={{ color: C.dark }}>{searchedPostcode}</strong>.
                        Try a nearby postcode or expand your search.
                      </>
                    )}
                  </p>
                </div>
              )}

              {/* Results or refresh skeleton */}
              {(results.length > 0 || refreshLoading) && (
                <div>
                  {!refreshLoading && (
                    <p style={{ fontSize: 13, color: C.veryMuted, margin: "0 0 14px" }}>
                      Showing {results.length}{" "}
                      {seenNames.length > 0 ? "more " : ""}
                      professional{results.length !== 1 ? "s" : ""} near{" "}
                      <strong style={{ color: C.muted }}>{searchedPostcode}</strong>{" "}
                      (within {Math.round(radius / 1000)}km)
                    </p>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {refreshLoading ? (
                      <>
                        <SkeletonCard />
                        <SkeletonCard />
                        <SkeletonCard />
                      </>
                    ) : (
                      results.map((r, i) => (
                        <BusinessCard
                          key={`${r.name}-${i}`}
                          result={r}
                          rank={i}
                          onReviewClick={setReviewTarget}
                        />
                      ))
                    )}
                  </div>

                  {/* Refresh list button */}
                  {!refreshLoading && !refreshExhausted && radius < MAX_RADIUS && (
                    <button
                      type="button"
                      onClick={handleRefresh}
                      style={{
                        display: "block",
                        marginTop: 16,
                        fontSize: 13,
                        fontWeight: 500,
                        color: C.green,
                        background: "transparent",
                        border: `1px solid ${C.green}`,
                        borderRadius: 100,
                        padding: "10px 20px",
                        cursor: "pointer",
                        fontFamily: BODY,
                      }}
                    >
                      Refresh list →
                    </button>
                  )}

                  {/* Map placeholder */}
                  {!refreshLoading && (
                    <div
                      style={{
                        marginTop: 20,
                        background: C.card,
                        border: `0.5px solid ${C.border}`,
                        borderRadius: 16,
                        padding: "28px 20px",
                        textAlign: "center",
                      }}
                    >
                      <p style={{ fontSize: 13, color: C.veryMuted, margin: 0 }}>
                        🗺 View on map — coming soon
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* SEO prose content — always rendered server-side */}
        <div>
          <h2
            style={{
              fontFamily: HEADING,
              fontSize: 24,
              fontWeight: 400,
              color: C.dark,
              letterSpacing: "-0.3px",
              margin: "0 0 16px",
              borderLeft: `3px solid ${C.green}`,
              paddingLeft: 12,
            }}
          >
            Why use a specialist property professional?
          </h2>
          <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
            <p style={{ margin: "0 0 16px" }}>
              Buying a home is the largest financial transaction most people make. Having the right professionals in your corner — a good surveyor, an experienced property solicitor, and a mortgage broker who knows the market — can save you thousands and protect you from costly surprises.
            </p>
            <p style={{ margin: "0 0 16px" }}>
              A RICS-accredited surveyor will identify structural issues, damp, and defects that aren't visible on a viewing. A full building survey typically costs £500–£1,000 but can reveal defects worth tens of thousands to repair — and give you powerful negotiation leverage on the asking price.
            </p>
            <p style={{ margin: "0 0 16px" }}>
              A specialist property solicitor handles conveyancing, searches, and contract review. Choosing a solicitor with strong local knowledge of the area's planning history and common issues can accelerate your purchase and reduce the risk of surprises late in the transaction.
            </p>
            <p style={{ margin: "0 0 0" }}>
              For renovation properties, getting a renovation contractor's assessment before you make an offer — not after — can be the difference between a good deal and a money pit.
            </p>
          </div>

          <h2
            style={{
              fontFamily: HEADING,
              fontSize: 24,
              fontWeight: 400,
              color: C.dark,
              letterSpacing: "-0.3px",
              margin: "40px 0 16px",
              borderLeft: `3px solid ${C.green}`,
              paddingLeft: 12,
            }}
          >
            How we rank results
          </h2>
          <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
            <p style={{ margin: "0 0 0" }}>
              Professionals are ranked by their aggregated Google review score, with higher-rated businesses appearing first. Where ratings are equal, we prioritise businesses with more reviews, as a larger sample is a more reliable signal of consistent quality. We show businesses within approximately 5 miles of your postcode.
            </p>
          </div>

          {/* Internal links */}
          <div style={{ marginTop: 36 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: C.veryMuted,
                marginBottom: 14,
              }}
            >
              Related
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Link
                to="/tools/renovation-calculator"
                style={{
                  fontSize: 14,
                  color: C.green,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                Estimate your renovation costs
              </Link>
              <Link
                to="/"
                style={{
                  fontSize: 14,
                  color: C.green,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                Analyse a Rightmove listing with vett
              </Link>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div
          style={{
            marginTop: 56,
            borderTop: `0.5px solid ${C.border}`,
            paddingTop: 28,
          }}
        >
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
            Business listings and ratings are sourced from Google Places and may not be complete or up to date. vett does not endorse or verify any listed business. Always check credentials, references, and insurance before engaging any professional. RICS accreditation can be verified at{" "}
            <a
              href="https://www.rics.org"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.muted }}
            >
              rics.org
            </a>
            .{" "}Solicitor registration can be verified at{" "}
            <a
              href="https://www.sra.org.uk"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.muted }}
            >
              sra.org.uk
            </a>
            .
          </p>
        </div>

      </main>

      <SiteFooter />

      {/* Reviews modal — portal to document.body */}
      {reviewTarget && (
        <ReviewsModal
          target={reviewTarget}
          onClose={() => setReviewTarget(null)}
        />
      )}
    </div>
  );
}
