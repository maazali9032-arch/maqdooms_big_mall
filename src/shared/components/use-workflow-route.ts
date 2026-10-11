import { useNavigate, useRouterState } from "@tanstack/react-router";

/** Existing pages expose their workflow tabs as navigable sidebar destinations. */
export function useWorkflowRoute() {
  const activeId = useRouterState({ select: (s) => s.location.hash });
  const navigate = useNavigate();
  return {
    activeId,
    onChange: (id: string) => {
      void navigate({ hash: id, replace: true, resetScroll: false });
    },
  };
}
