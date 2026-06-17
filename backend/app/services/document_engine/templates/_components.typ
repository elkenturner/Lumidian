#import "_tokens.typ": lumidian

#let h1(body) = block(below: lumidian.space_section, text(font: lumidian.display_font, size: lumidian.size_h1, fill: lumidian.ink, body))
#let h2(body) = block(above: lumidian.space_section, below: lumidian.space_block, text(font: lumidian.display_font, size: lumidian.size_h2, fill: lumidian.ink, body))
#let h3(body) = block(above: lumidian.space_block, below: lumidian.space_line, text(font: lumidian.body_font, weight: "medium", size: lumidian.size_h3, fill: lumidian.ink, body))

#let callout(body) = block(
  fill: lumidian.paper.darken(2%),
  stroke: (left: 2pt + lumidian.primary),
  inset: lumidian.space_card,
  width: 100%,
  body
)

#let score_card(score, label) = block(
  inset: lumidian.space_card,
  stroke: 0.5pt + lumidian.border,
  width: 100%,
  align(center)[
    #text(font: lumidian.mono_font, size: lumidian.size_mono_xl, fill: lumidian.ink)[#score]
    #v(lumidian.space_line)
    #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted, tracking: 1pt)[#upper(label)]
  ]
)

#let signature_block(name_label, date_label) = block(above: 0.4in)[
  #grid(columns: (1fr, 1fr), column-gutter: 0.4in,
    [
      #line(length: 100%, stroke: 0.5pt + lumidian.ink)
      #v(2pt)
      #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#name_label]
    ],
    [
      #line(length: 100%, stroke: 0.5pt + lumidian.ink)
      #v(2pt)
      #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#date_label]
    ],
  )
]

#let bullet(body) = block(below: lumidian.space_line, grid(columns: (12pt, 1fr), gutter: lumidian.space_line,
  text(fill: lumidian.primary)[•], body
))

#let check_item(done, body) = block(below: lumidian.space_line, grid(columns: (16pt, 1fr), gutter: lumidian.space_line,
  if done {
    text(fill: lumidian.primary)[●]
  } else {
    text(fill: lumidian.muted)[○]
  },
  body
))

#let numbered_item(n, body) = block(below: lumidian.space_line, grid(columns: (24pt, 1fr), gutter: lumidian.space_line,
  text(font: lumidian.mono_font, fill: lumidian.primary)[#str(n).],
  body
))
