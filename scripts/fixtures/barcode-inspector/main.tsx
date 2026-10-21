import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JsBarcode from "jsbarcode";
import { OwnerDashboard } from "@/features/reports/OwnerDashboard";
import { OwnerReports } from "@/features/reports/OwnerReports";
import { OwnerAudit } from "@/features/reports/OwnerAudit";
import { WorkshopFabricStock } from "@/features/inventory/WorkshopFabricStock";
import { SessionContext } from "../workshop-inventory/session";
import "@/styles.css";
const params = new URLSearchParams(location.search);
Object.assign(window, { cameraStops: 0, cameraStarts: 0 });
// Actual CODE128 decoding through a real video/canvas MediaStream; no decoder mock.
navigator.mediaDevices.getUserMedia = async () => {
  const state = window as unknown as { cameraStops: number; cameraStarts: number };
  state.cameraStarts++;
  if (params.get("camera") !== "scan" && params.get("camera") !== "delay")
    throw new DOMException("Denied", "NotAllowedError");
  if (params.get("camera") === "delay") await new Promise((resolve) => setTimeout(resolve, 500));
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, params.get("barcode") ?? "AND-909558881", {
    format: "CODE128",
    width: 3,
    height: 180,
    margin: 30,
    displayValue: false,
  });
  const stream = canvas.captureStream(15);
  const track = stream.getTracks()[0]!;
  const stop = track.stop.bind(track);
  track.stop = () => {
    state.cameraStops++;
    stop();
  };
  return stream;
};
function Fixture() {
  const [owner, setOwner] = useState(!params.has("staff"));
  return (
    <SessionContext.Provider
      value={{
        userId: owner ? "owner" : "staff",
        fullName: "Owner",
        email: "owner@example.test",
        roles: [owner ? "owner" : (params.get("staff") ?? "counter")],
        isOwner: owner,
        loading: false,
        can: () => owner,
        permissions: [],
      }}
    >
      <button onClick={() => setOwner(false)}>Remove Owner access (fixture)</button>
      <main className="mx-auto max-w-7xl space-y-4 p-4">
        {params.has("reports") ? (
          <OwnerReports />
        ) : params.has("audit") ? (
          <OwnerAudit />
        ) : params.has("inventory") ? (
          <WorkshopFabricStock />
        ) : (
          <OwnerDashboard />
        )}
      </main>
    </SessionContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Fixture />
  </QueryClientProvider>,
);
