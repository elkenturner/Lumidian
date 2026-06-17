#import "_tokens.typ": lumidian

// slim_header — for briefing-style docs that should start content on page 1.
// Compact masthead: wordmark on the left, doc kind + client + date on the right.
// No pagebreak — content flows immediately below.
#let slim_header(client_name, doc_kind_label, generated_at, generated_by) = {
  block(below: lumidian.space_section, [
    #grid(
      columns: (auto, 1fr),
      align: (left + horizon, right + horizon),
      column-gutter: 1fr,
      text(font: lumidian.display_font, size: 16pt, fill: lumidian.primary)[Lumidian],
      [
        #text(font: lumidian.display_font, size: lumidian.size_h2, fill: lumidian.ink)[#client_name]
        #v(2pt)
        #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted, tracking: 1pt)[#upper(doc_kind_label) · #generated_at]
      ]
    )
    #v(lumidian.space_line)
    #line(length: 100%, stroke: 0.5pt + lumidian.border)
  ])
}

// cover(style, client_name, doc_kind_label, generated_at, generated_by)
// style ∈ ("briefing", "report", "contract")
// Full-page cover for report + contract kinds (briefings should use slim_header).
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
      #text(font: lumidian.body_font, size: 10pt, fill: lumidian.muted, weight: "medium", tracking: 0.5pt)[#upper(doc_kind_label)]
      #v(0.25in)
      #text(font: lumidian.display_font, size: 48pt, fill: lumidian.ink)[#client_name]
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
