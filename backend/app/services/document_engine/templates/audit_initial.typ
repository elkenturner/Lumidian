#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, h3, callout, bullet

#let data = json("data.json")

#cover(
  "briefing",
  data.brand.name,
  "Initial audit",
  data.generated_at,
  data.at("generated_by", default: none),
)

#header_footer(data.brand.name, "Initial audit")

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#h1[Initial Visibility Audit]

#callout[
  #data.output.current_state
]

#if data.output.working.len() > 0 [
  #h2[What's working]
  #for item in data.output.working [#bullet(item)]
]

#if data.output.gaps.len() > 0 [
  #h2[Gaps]
  #for item in data.output.gaps [#bullet(item)]
]

#if data.output.recommendations.len() > 0 [
  #h2[Recommendations — next 30 days]
  #for (i, item) in data.output.recommendations.enumerate() [
    #grid(columns: (24pt, 1fr), gutter: lumidian.space_line)[
      #text(font: lumidian.mono_font, fill: lumidian.primary)[#(i + 1).]
      #item
    ]
  ]
]

#if data.output.open_questions.len() > 0 [
  #h2[Open questions for the client]
  #for item in data.output.open_questions [#bullet(item)]
]
