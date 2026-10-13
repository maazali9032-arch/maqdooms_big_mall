import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  activeId: string;
  showOperationalHistory: boolean;
  canReceive: boolean;
  isOwner: boolean;
  showFinishedProducts?: boolean;
  showIncomplete: boolean;
  incompleteOnly: boolean;
  onIncompleteChange: (value: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
};

export function InventoryToolbar(props: Props) {
  const sections = [
    { id: "fabric-stock", label: "Fabric stock & scan" },
    { id: "thaans", label: "Legacy / internal Thaans" },
    { id: "locations", label: "Locations & transfers" },
    ...(props.showOperationalHistory ? [{ id: "movements", label: "Stock movements" }] : []),
    ...(props.canReceive ? [{ id: "batches", label: "Receiving" }] : []),
    ...((props.showFinishedProducts ?? props.isOwner)
      ? [{ id: "finished-products", label: "Finished products" }]
      : []),
    { id: "consumables", label: "Consumables" },
    { id: "archived", label: "Depleted / archived" },
  ];
  const legacySearch = props.activeId === "thaans" || props.activeId === "archived";
  return (
    <div className="space-y-3">
      <TabsList
        aria-label="Inventory sections"
        className="grid h-auto w-full grid-cols-2 gap-1 p-1.5 sm:flex sm:flex-wrap sm:justify-start"
      >
        {sections.map((section) => (
          <TabsTrigger
            key={section.id}
            value={section.id}
            className="min-h-11 min-w-0 justify-start whitespace-normal px-3 py-2 text-left leading-snug sm:justify-center"
          >
            {section.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {(props.showIncomplete || legacySearch) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {props.showIncomplete && (
            <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm shadow-black/[0.02]">
              <Checkbox
                checked={props.incompleteOnly}
                onCheckedChange={(value) => props.onIncompleteChange(Boolean(value))}
              />
              Incomplete only
            </label>
          )}
          {legacySearch && (
            <Input
              aria-label="Search legacy Thaans"
              placeholder="Search barcode, fabric, rack…"
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              className="h-11 sm:w-72"
            />
          )}
        </div>
      )}
    </div>
  );
}
