import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/my-report")({
  beforeLoad: () => {
    throw redirect({ to: "/my-reports" });
  },
  component: () => null,
});
