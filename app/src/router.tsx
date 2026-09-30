import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Page changes cross-fade through the browser's View Transitions API
    // (timing and the pinned nav live in styles.css). Browsers without it
    // switch instantly, exactly as before; there is no JS fallback to ship.
    defaultViewTransition: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
