// The six platforms a content cluster generates pieces for. owned_site is
// the anchor piece (own-domain page) and always leads; Wikipedia is
// intentionally excluded — it lives on its own surface.
// Order here is the canonical display order across cluster views.
//
// Typed as `readonly string[]` (NOT `as const`) on purpose: the detail page
// calls `PLATFORM_ORDER.includes(p)` with a plain `string`, which a literal
// tuple type would reject under strict TS.
export const CLUSTER_PLATFORMS: readonly string[] = ["owned_site", "linkedin", "medium", "reddit", "quora", "x"];

// Human-facing labels for the platform filter chips.
export const CLUSTER_PLATFORM_LABELS: Record<string, string> = {
  owned_site: "Your site",
  linkedin: "LinkedIn",
  medium: "Medium",
  reddit: "Reddit",
  quora: "Quora",
  x: "X",
};
