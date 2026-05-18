import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getSharedReport } from "@/lib/share.functions";
import { ReportView } from "@/routes/results";

export const Route = createFileRoute("/report/$token")({
  component: SharedReportPage,
  head: ({ params }) => ({
    meta: [
      { title: `Shared vett Report — ${params.token.slice(0, 8)}` },
      { name: "description", content: "A shared property analysis from vett." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function SharedReportPage() {
  const { token } = Route.useParams();
  const fetchShared = useServerFn(getSharedReport);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["shared-report", token],
    queryFn: () => fetchShared({ data: { token } }),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading shared report…</span>
        </div>
      </div>
    );
  }

  if (isError || !data?.found || !data.analysis) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
            Report not found
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This shared report could not be found or the link has expired.
          </p>
          <a
            href="https://vetthome.com"
            className="mt-6 inline-block rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: "#2D6A4F", color: "#FFFDF9" }}
          >
            Go to vetthome.com →
          </a>
        </div>
      </div>
    );
  }

  // Set the document title to the property address once loaded.
  if (typeof document !== "undefined" && data.propertyAddress) {
    document.title = `${data.propertyAddress} — vett Report`;
  }

  return <ReportView analysis={data.analysis} shareMode />;
}
