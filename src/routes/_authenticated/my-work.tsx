import { createFileRoute } from "@tanstack/react-router";
import { SalespersonWork } from "@/features/salesperson/SalespersonWork";
export const Route = createFileRoute("/_authenticated/my-work")({ component: SalespersonWork });
