#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, callout, bullet

#let data = json("data.json")

#cover(
  "report",
  data.client.name,
  "Monthly report · " + data.period.label,
  data.generated_at,
  data.at("generated_by", default: none),
)

#header_footer(data.client.name, "Monthly report · " + data.period.label)

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#h1[Monthly report]

#callout[#data.output.executive_summary]

#h2[Month over month]
#data.output.month_over_month
#v(lumidian.space_block)
#image(bytes(data.charts._chart_visibility_over_time), format: "svg", width: 100%)

#if data.output.content_velocity != none [
  #h2[Content velocity]
  #data.output.content_velocity
  #v(lumidian.space_block)
  #image(bytes(data.charts._chart_drafts_by_platform_mix), format: "svg", width: 60%)
]

#if data.output.highlights.len() > 0 [
  #h2[Highlights]
  #for item in data.output.highlights [#bullet(item)]
]

#if data.output.next_month.len() > 0 [
  #h2[Next month]
  #for item in data.output.next_month [#bullet(item)]
]
