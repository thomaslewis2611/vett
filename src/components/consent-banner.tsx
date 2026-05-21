import { useEffect, useState } from "react";
import { getConsentFromCookie, setConsent } from "../lib/consent";

const HEADING_FONT = "'Playfair Display', Georgia, serif";

const STYLES = `
.vett-cb-pill {
  all: revert;
  position: fixed !important;
  bottom: 20px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  z-index: 9999 !important;
  background: #FFFDF9 !important;
  border: 0.5px solid rgba(26,17,8,0.15) !important;
  border-radius: 22px !important;
  padding: 8px 8px 8px 18px !important;
  display: flex !important;
  align-items: center !important;
  gap: 14px !important;
  box-shadow: 0 2px 12px rgba(26,17,8,0.06) !important;
  max-width: calc(100vw - 32px) !important;
  width: fit-content !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  font-family: inherit !important;
}
.vett-cb-expanded {
  all: revert;
  position: fixed !important;
  bottom: 20px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  z-index: 9999 !important;
  width: calc(100vw - 32px) !important;
  max-width: 460px !important;
  background: #FFFDF9 !important;
  border: 0.5px solid rgba(26,17,8,0.15) !important;
  border-radius: 20px !important;
  padding: 20px !important;
  box-sizing: border-box !important;
  box-shadow: 0 2px 12px rgba(26,17,8,0.06) !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  margin: 0 !important;
}
.vett-cb-text { font-size: 13px; font-weight: 400; color: #1A1108; line-height: 1.3; }
.vett-cb-link { color: #2D6A4F; text-decoration: underline; }
.vett-cb-btn-group { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
.vett-cb-btn-primary { background: #2D6A4F; color: #FFFDF9; font-size: 13px; font-weight: 500; border-radius: 18px; padding: 7px 14px; border: none; cursor: pointer; white-space: nowrap; line-height: 1; height: 30px; display: inline-flex; align-items: center; justify-content: center; }
.vett-cb-btn-ghost { background: transparent; color: #1A1108; font-size: 13px; font-weight: 500; border-radius: 18px; padding: 7px 14px; border: 0.5px solid rgba(26,17,8,0.3); cursor: pointer; white-space: nowrap; line-height: 1; height: 30px; display: inline-flex; align-items: center; justify-content: center; }
.vett-cb-btn-text { background: transparent; color: #1A1108; font-size: 13px; font-weight: 500; padding: 7px 10px; border: none; cursor: pointer; white-space: nowrap; text-decoration: underline; text-underline-offset: 2px; line-height: 1; height: 30px; }
.vett-cb-h2 { font-family: ${HEADING_FONT}; font-weight: 700; font-size: 18px; color: #1A1108; margin: 0 0 6px 0; line-height: 1.2; }
.vett-cb-p { font-size: 13px; font-weight: 300; color: #1A1108; margin: 0 0 12px 0; line-height: 1.5; }
.vett-cb-row { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-top: 0.5px solid rgba(26,17,8,0.1); }
.vett-cb-row-label { font-size: 13px; font-weight: 500; color: #1A1108; }
.vett-cb-row-desc { font-size: 12px; font-weight: 300; color: #5F5E5A; margin-top: 1px; }
.vett-cb-checkbox { margin-top: 3px; accent-color: #2D6A4F; }
.vett-cb-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
`;

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const existing = getConsentFromCookie();
    if (!existing) {
      const t = setTimeout(() => setVisible(true), 400);
      return () => clearTimeout(t);
    }
  }, []);

  if (!visible) return null;

  const handleAcceptAll = () => { setConsent({ analytics: true, marketing: true }); setVisible(false); };
  const handleRejectAll = () => { setConsent({ analytics: false, marketing: false }); setVisible(false); };
  const handleSavePreferences = () => { setConsent({ analytics, marketing }); setVisible(false); };

  if (!showDetails) {
    return (
      <>
        <style>{STYLES}</style>
        <aside aria-label="Cookie consent" aria-live="polite" className="vett-cb-pill">
          <span className="vett-cb-text">
            We use cookies to improve vett. <a href="/privacy" className="vett-cb-link">Learn more</a>
          </span>
          <div className="vett-cb-btn-group">
            <button type="button" onClick={() => setShowDetails(true)} className="vett-cb-btn-text">Customise</button>
            <button type="button" onClick={handleRejectAll} className="vett-cb-btn-ghost">Reject</button>
            <button type="button" onClick={handleAcceptAll} className="vett-cb-btn-primary">Accept</button>
          </div>
        </aside>
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>
      <aside aria-label="Cookie consent preferences" aria-live="polite" className="vett-cb-expanded">
        <h2 className="vett-cb-h2">Cookie preferences</h2>
        <p className="vett-cb-p">Necessary cookies are always on. Choose what else you allow.</p>
        <div style={{ marginBottom: "14px" }}>
          <CategoryRow label="Necessary" description="Required for the site to function." checked={true} disabled={true} onChange={() => {}} />
          <CategoryRow label="Analytics" description="Helps us understand which pages are useful." checked={analytics} disabled={false} onChange={setAnalytics} />
          <CategoryRow label="Marketing" description="Used to measure ad performance. Off by default." checked={marketing} disabled={false} onChange={setMarketing} />
        </div>
        <div className="vett-cb-actions">
          <button type="button" onClick={handleRejectAll} className="vett-cb-btn-ghost">Reject all</button>
          <button type="button" onClick={handleSavePreferences} className="vett-cb-btn-primary">Save preferences</button>
        </div>
      </aside>
    </>
  );
}

function CategoryRow({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void; }) {
  return (
    <div className="vett-cb-row">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="vett-cb-checkbox" aria-label={label} />
      <div style={{ flex: 1 }}>
        <div className="vett-cb-row-label">{label}</div>
        <div className="vett-cb-row-desc">{description}</div>
      </div>
    </div>
  );
}