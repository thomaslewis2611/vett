import { QueryClient } from "@tanstack/react-query";
import { createRouter, useRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { SiteHeader } from "@/components/site-chrome";

function GlobalErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const isDev = import.meta.env.DEV;

  const handleGoHome = () => {
    reset();
    router.navigate({ to: "/" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            We hit an unexpected error rendering this page. You can head back to
            the homepage and try again.
          </p>

          {isDev && error?.message && (
            <pre className="mt-6 max-h-64 overflow-auto rounded-lg bg-muted p-4 text-left text-xs text-muted-foreground">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={handleGoHome}
              className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Back to homepage
            </button>
            <button
              type="button"
              onClick={() => {
                router.invalidate();
                reset();
              }}
              className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-5 py-3 text-sm font-medium hover:bg-muted"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: GlobalErrorPage,
  });

  return router;
};
