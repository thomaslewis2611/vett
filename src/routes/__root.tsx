import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";

const HEADING_FONT = "'Playfair Display', Georgia, serif";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "#F1EFE8" }}>
      <div
        className="w-full max-w-md text-center p-10"
        style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.1)", borderRadius: 16 }}
      >
        <div style={{ fontFamily: HEADING_FONT, fontWeight: 400, fontSize: 64, color: "#1A1108", lineHeight: 1 }}>
          404
        </div>
        <h2 style={{ fontFamily: HEADING_FONT, fontWeight: 400, fontSize: 24, color: "#1A1108", marginTop: 12 }}>
          Page not found
        </h2>
        <p className="mt-3" style={{ fontWeight: 300, fontSize: 14, color: "#5F5E5A" }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-7">
          <Link
            to="/"
            className="inline-flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              background: "#2D6A4F",
              color: "#FFFDF9",
              fontSize: 14,
              fontWeight: 500,
              borderRadius: 100,
              padding: "12px 22px",
            }}
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "#F1EFE8" }}>
      <div
        className="w-full max-w-md text-center p-10"
        style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.1)", borderRadius: 16 }}
      >
        <h1 style={{ fontFamily: HEADING_FONT, fontWeight: 400, fontSize: 28, color: "#1A1108" }}>
          This page didn't load
        </h1>
        <p className="mt-3" style={{ fontWeight: 300, fontSize: 14, color: "#5F5E5A" }}>
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              background: "#2D6A4F",
              color: "#FFFDF9",
              fontSize: 14,
              fontWeight: 500,
              borderRadius: 100,
              padding: "12px 22px",
            }}
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center transition-colors"
            style={{
              background: "transparent",
              border: "0.5px solid #1A1108",
              color: "#1A1108",
              fontSize: 14,
              fontWeight: 500,
              borderRadius: 100,
              padding: "12px 22px",
            }}
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
      { title: "Roovr — Every listing. Analysed. Instantly." },
      { name: "description", content: "Paste any Rightmove listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in minutes. From £4.99." },
      { name: "author", content: "Roovr" },
      { property: "og:title", content: "Roovr — AI property analysis for smarter buyers" },
      { property: "og:description", content: "Paste any Rightmove listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in minutes. From £4.99." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@roovr" },
      { name: "twitter:title", content: "Roovr — AI property analysis for smarter buyers" },
      { name: "twitter:description", content: "Paste any Rightmove listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in minutes. From £4.99." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/255de182-edb0-4d96-8a07-3e73806ff312/id-preview-e28ee195--e239acee-68b4-47c9-912e-3378d99dae28.lovable.app-1778654002429.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/255de182-edb0-4d96-8a07-3e73806ff312/id-preview-e28ee195--e239acee-68b4-47c9-912e-3378d99dae28.lovable.app-1778654002429.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
