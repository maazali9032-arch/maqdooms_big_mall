export type HierarchyOption = {
  id: string;
  factory_id: string;
  factory_name: string;
  section_id: string | null;
  section_name: string | null;
  tailor_name: string;
  tailor_code: string;
};
export function hierarchySections(options: HierarchyOption[], factory: string) {
  return [
    ...new Map(
      options
        .filter((a) => a.factory_id === factory)
        .map((a) => [a.section_id ?? "none", a.section_name ?? "No Section"]),
    ).entries(),
  ];
}
export function hierarchyTailors(options: HierarchyOption[], factory: string, section: string) {
  return options.filter((a) => a.factory_id === factory && (a.section_id ?? "none") === section);
}
