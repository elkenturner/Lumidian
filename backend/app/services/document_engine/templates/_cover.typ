#import "_tokens.typ": lumidian

// cover(style, client_name, doc_kind_label, generated_at, generated_by)
// style ∈ ("briefing", "report", "contract")
#let cover(style, client_name, doc_kind_label, generated_at, generated_by) = {
  set page(margin: (top: 1.2in, right: 0.85in, bottom: 1.0in, left: 0.85in))

  // Logo / wordmark
  align(left)[
    #text(font: lumidian.display_font, size: 20pt, fill: lumidian.primary)[Lumidian]
  ]

  v(0.6in)

  if style == "briefing" {
    align(left)[
      #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted, tracking: 2pt)[#upper(doc_kind_label)]
      #v(0.15in)
      #text(font: lumidian.display_font, size: lumidian.size_display, fill: lumidian.ink)[#client_name]
    ]
  } else if style == "report" {
    align(center)[
      #v(2in)
      #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted, tracking: 2pt)[#upper(doc_kind_label)]
      #v(0.3in)
      #text(font: lumidian.display_font, size: 64pt, fill: lumidian.ink)[#client_name]
    ]
  } else if style == "contract" {
    align(left)[
      #text(font: lumidian.mono_font, size: lumidian.size_caption, fill: lumidian.muted)[#upper(doc_kind_label)]
      #v(0.2in)
      #text(font: lumidian.display_font, size: lumidian.size_h1, fill: lumidian.ink)[#client_name]
    ]
  }

  // Bottom metadata
  place(bottom + left, [
    #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[
      Generated #generated_at#if generated_by != none [ by #generated_by]
    ]
  ])

  pagebreak()
}
