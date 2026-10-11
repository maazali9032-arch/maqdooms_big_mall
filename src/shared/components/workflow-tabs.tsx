import { useEffect, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Mount on first use, then retain forms/carts and uncertain transaction retries. */
export function WorkflowTabs({
  items,
  activeId,
  onChange,
}: {
  items: { id: string; label: string; content: ReactNode }[];
  activeId?: string;
  onChange?: (id: string) => void;
}) {
  const initial = items.some((item) => item.id === activeId) ? activeId! : (items[0]?.id ?? "");
  const [active, setActive] = useState(initial);
  const [visited, setVisited] = useState(new Set([initial]));
  const requested = activeId ?? active;
  const selected = items.some((item) => item.id === requested) ? requested : (items[0]?.id ?? "");
  useEffect(() => {
    setVisited((previous) =>
      previous.has(selected) ? previous : new Set([...previous, selected]),
    );
  }, [selected]);
  return (
    <Tabs
      value={selected}
      onValueChange={(id) => {
        setActive(id);
        setVisited((previous) => new Set([...previous, id]));
        onChange?.(id);
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
