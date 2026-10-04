import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Mount on first use, then retain forms/carts and uncertain transaction retries. */
export function WorkflowTabs({
  items,
}: {
  items: { id: string; label: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const [visited, setVisited] = useState(new Set([items[0]?.id ?? ""]));
  const selected = items.some((item) => item.id === active) ? active : (items[0]?.id ?? "");
  return (
    <Tabs
      value={selected}
      onValueChange={(id) => {
        setActive(id);
        setVisited((previous) => new Set([...previous, id]));
      }}
    >
      <div className="overflow-x-auto pb-2">
        <TabsList aria-label="Choose workflow" className="min-w-max justify-start">
          {items.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {items
        .filter((item) => visited.has(item.id) || item.id === selected)
        .map((item) => (
          <TabsContent key={item.id} value={item.id} forceMount hidden={selected !== item.id}>
            {item.content}
          </TabsContent>
        ))}
    </Tabs>
  );
}
