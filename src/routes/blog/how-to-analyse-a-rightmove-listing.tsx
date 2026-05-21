import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/blog/how-to-analyse-a-rightmove-listing")({
  loader: () => {
    throw redirect({
      to: "/blog/the-complete-uk-home-buyers-guide-to-analysing-a-property-listing",
      statusCode: 301,
    });
  },
});
