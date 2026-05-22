import { createFileRoute } from "@tanstack/react-router";

const FROM_ADDRESS = "vett <noreply@vetthome.com>";

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

interface EmailItem {
  label: string;
  low: number;
  mid: number;
  high: number;
}

function buildHtml(items: EmailItem[], total: number, region: string, propertyType: string): string {
  const regionLabels: Record<string, string> = {
    london: "London",
    southeast: "South East",
    england: "England (excl. London/SE)",
    scotwales: "Scotland / Wales",
  };
  const propLabels: Record<string, string> = {
    flat: "Flat",
    terrace: "Terraced house",
    semi: "Semi-detached",
    detached: "Detached",
  };

  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:14px;color:#1A1108;">${escapeHtml(item.label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:14px;color:#5F5E5A;text-align:right;">${gbp(item.low)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:14px;color:#1A1108;font-weight:600;text-align:right;">${gbp(item.mid)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:14px;color:#5F5E5A;text-align:right;">${gbp(item.high)}</td>
        </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Your renovation estimate — vett</title></head>
<body style="margin:0;padding:0;background:#F1EFE8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1108;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1EFE8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFDF9;border-radius:12px;overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:#1A1108;padding:24px 32px;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#FFFDF9;letter-spacing:-1px;">vett</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px 32px 24px 32px;">
          <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.3;color:#1A1108;">Your renovation estimate</h1>
          <p style="margin:0 0 4px 0;font-size:14px;color:#5F5E5A;">
            Property type: <strong style="color:#1A1108;">${escapeHtml(propLabels[propertyType] ?? propertyType)}</strong>
            &nbsp;·&nbsp;
            Region: <strong style="color:#1A1108;">${escapeHtml(regionLabels[region] ?? region)}</strong>
          </p>
          <p style="margin:0 0 28px 0;font-size:13px;color:#888780;">Regional pricing adjustments applied.</p>

          <!-- Estimate table -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid #eee;">
            <thead>
              <tr style="background:#F1EFE8;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#888780;font-weight:500;">Item</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;color:#888780;font-weight:500;">Low</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;color:#888780;font-weight:500;">Mid</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;color:#888780;font-weight:500;">High</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:#F1EFE8;">
                <td style="padding:12px 12px;font-size:14px;font-weight:700;color:#1A1108;">Total estimate</td>
                <td colspan="2" style="padding:12px 12px;text-align:right;font-size:18px;font-weight:700;color:#2D6A4F;">${gbp(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          <p style="margin:28px 0 8px 0;font-size:14px;color:#1A1108;font-weight:600;">Want a full property analysis?</p>
          <p style="margin:0 0 20px 0;font-size:14px;color:#5F5E5A;line-height:1.6;">
            Before you commit to a renovation budget, run the listing through vett. Get red flags, fair value assessment, hidden costs, and negotiation strategy in under 2 minutes.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#2D6A4F;border-radius:999px;">
            <a href="https://vetthome.com" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Analyse a listing with vett →</a>
          </td></tr></table>
        </td></tr>

        <!-- Disclaimer -->
        <tr><td style="padding:24px 32px 32px 32px;border-top:1px solid #eee;font-size:11px;color:#888780;line-height:1.65;">
          These figures are indicative estimates only and should not be relied upon as quotes. Actual costs will vary based on the specific property, contractor, materials, and unforeseen issues discovered during works. Always obtain at least three quotes from qualified contractors before proceeding.<br><br>
          © 2026 vett · vetthome.com
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export const Route = createFileRoute("/api/renovation-estimate-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.RESEND_API_KEY ?? (globalThis as any).RESEND_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "Email service unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: { email?: unknown; items?: unknown; total?: unknown; region?: unknown; propertyType?: unknown };
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const email = typeof body.email === "string" ? body.email.trim() : "";
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return new Response(JSON.stringify({ error: "Invalid email address" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const items = Array.isArray(body.items) ? (body.items as EmailItem[]) : [];
        const total = typeof body.total === "number" ? body.total : 0;
        const region = typeof body.region === "string" ? body.region : "england";
        const propertyType = typeof body.propertyType === "string" ? body.propertyType : "terrace";

        const html = buildHtml(items, total, region, propertyType);

        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10_000);
        try {
          const resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: FROM_ADDRESS,
              to: email,
              subject: "Your renovation cost estimate — vett",
              html,
            }),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const err = await resp.text();
            console.error("[renovation-email] Resend error", err);
            return new Response(JSON.stringify({ error: "Failed to send email" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[renovation-email] fetch error", msg);
          return new Response(JSON.stringify({ error: "Failed to send email" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        } finally {
          clearTimeout(t);
        }
      },
    },
  },
});
