#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, h3, callout, bullet

#let data = json("data.json")

#cover(
  "briefing",
  data.brand.name,
  "Wikipedia plan",
  data.generated_at,
  data.at("generated_by", default: none),
)

#header_footer(data.brand.name, "Wikipedia plan")

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#h1[Wikipedia opportunity plan]

#callout[#data.output.summary]

#h2[Approach]
#data.output.approach

#if data.output.top_candidates.len() > 0 [
  #h2[Top candidate articles]
  #for cand in data.output.top_candidates [
    #block(above: lumidian.space_block, stroke: (left: 1pt + lumidian.border), inset: (left: lumidian.space_card))[
      #text(font: lumidian.body_font, weight: "medium", fill: lumidian.ink)[#cand.article_title]
      #if cand.suggested_section != none [
        #text(font: lumidian.mono_font, size: lumidian.size_caption, fill: lumidian.muted)[ → #cand.suggested_section]
      ]
      #v(lumidian.space_line / 2)
      #text(fill: lumidian.ink)[#cand.angle]
    ]
  ]
]

#if data.output.risks.len() > 0 [
  #h2[Risks]
  #for item in data.output.risks [#bullet(item)]
]
