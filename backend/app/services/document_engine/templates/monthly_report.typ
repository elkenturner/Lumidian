#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h2, callout, bullet

#let data = json("data.json")
#let brand_or_client = if "brand" in data and data.brand != none and "name" in data.brand { data.brand.name } else { data.client.name }

#cover(
  "report",
  brand_or_client,
  "Monthly report · " + data.period.label,
  data.generated_at,
  data.at("generated_by", default: none),
)

#header_footer(brand_or_client, "Monthly report · " + data.period.label)

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#callout[#data.output.executive_summary]

#block(breakable: false)[
  #h2[Month over month]
  #data.output.month_over_month
]
#v(lumidian.space_block)
#image(bytes(data.charts._chart_visibility_over_time), format: "svg", width: 100%)

#if data.output.content_velocity != none [
  #block(breakable: false)[
    #h2[Content velocity]
    #data.output.content_velocity
    #v(lumidian.space_block)
    #align(center, image(bytes(data.charts._chart_drafts_by_platform_mix), format: "svg", width: 70%))
  ]
]

#if data.output.highlights.len() > 0 [
  #block(breakable: false)[
    #h2[Highlights]
    #for item in data.output.highlights [#bullet(item)]
  ]
]

#if data.output.next_month.len() > 0 [
  #block(breakable: false)[
    #h2[Next month]
    #for item in data.output.next_month [#bullet(item)]
  ]
]
