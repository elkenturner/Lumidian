// Lumidian design tokens — single source of truth.
// All templates import this; no per-template ad-hoc colors/sizes/spacing.

#let lumidian = (
  // Colors
  ink:            rgb("#0B1220"),
  paper:          rgb("#FAF7F2"),
  primary:        rgb("#2447EE"),       // Lumidian blue
  muted:          rgb("#546880"),
  border:         rgb("#E5E0D7"),
  delta_up:       rgb("#10A37F"),
  delta_down:     rgb("#DC2626"),
  model_chatgpt:  rgb("#10A37F"),
  model_claude:   rgb("#F97316"),
  model_perp:     rgb("#8B5CF6"),
  model_gemini:   rgb("#3B82F6"),

  // Type families
  display_font:   "Instrument Serif",
  body_font:      "Inter",
  mono_font:      "IBM Plex Mono",

  // Type scale
  size_display:   48pt,
  size_h1:        32pt,
  size_h2:        20pt,
  size_h3:        14pt,
  size_body:      11pt,
  size_caption:   9pt,
  size_mono_xl:   120pt,

  // Spacing
  space_section:  28pt,
  space_block:    16pt,
  space_card:     14pt,
  space_line:     8pt,

  // Page
  page_margin:    (top: 0.9in, right: 0.85in, bottom: 1.0in, left: 0.85in),
)
