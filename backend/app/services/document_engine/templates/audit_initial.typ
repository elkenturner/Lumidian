#import "_tokens.typ": lumidian
#import "_cover.typ": slim_header
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, h3, callout, bullet, numbered_item

#let data = json("data.json")

#header_footer(data.brand.name, "Initial audit")

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#slim_header(
  data.brand.name,
  "Initial audit",
  data.generated_at,
  data.at("generated_by", default: none),
)

#callout[
  #data.output.current_state
]

#if data.output.working.len() > 0 [
  #block(breakable: false)[
    #h2[What's working]
    #for item in data.output.working [#bullet(item)]
  ]
]

#if data.output.gaps.len() > 0 [
  #block(breakable: false)[
    #h2[Gaps]
    #for item in data.output.gaps [#bullet(item)]
  ]
]

#if data.output.recommendations.len() > 0 [
  #block(breakable: false)[
    #h2[Recommendations — next 30 days]
    #for (i, item) in data.output.recommendations.enumerate() [
      #numbered_item(i + 1, item)
    ]
  ]
]

#if data.output.open_questions.len() > 0 [
  #block(breakable: false)[
    #h2[Open questions for the client]
    #for item in data.output.open_questions [#bullet(item)]
  ]
]
