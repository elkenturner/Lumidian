#import "_tokens.typ": lumidian
#import "_cover.typ": slim_header
#import "_header_footer.typ": header_footer
#import "_components.typ": h2, h3, callout, bullet, score_card

#let data = json("data.json")

#header_footer(data.brand.name, "Site plan")

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#slim_header(
  data.brand.name,
  "Site plan",
  data.generated_at,
  data.at("generated_by", default: none),
)

#callout[#data.output.summary]

#grid(columns: (1fr, 1fr), column-gutter: lumidian.space_block,
  score_card(str(data.audit.overall_score), "Overall"),
  score_card(str(data.audit.bot_access_score), "Bot access"),
)

#h2[Reading the scores]
#data.output.score_interpretation

#if data.output.top_fixes.len() > 0 [
  #h2[Top fixes to ship]
  #for fix in data.output.top_fixes [
    #block(above: lumidian.space_block, stroke: 0.5pt + lumidian.border, inset: lumidian.space_card, breakable: false)[
      #grid(columns: (1fr, auto),
        text(font: lumidian.body_font, weight: "medium")[#fix.title],
        text(font: lumidian.mono_font, size: lumidian.size_caption, fill: lumidian.muted)[#upper(fix.priority) · #fix.category],
      )
      #v(lumidian.space_line)
      #text(fill: lumidian.muted, size: lumidian.size_caption)[Why it matters]
      #v(2pt)
      #fix.why_it_matters
      #v(lumidian.space_line)
      #text(fill: lumidian.muted, size: lumidian.size_caption)[What to do]
      #v(2pt)
      #fix.plain_action
    ]
  ]
]

#if data.output.next_30_days.len() > 0 [
  #h2[Next 30 days]
  #for item in data.output.next_30_days [#bullet(item)]
]
