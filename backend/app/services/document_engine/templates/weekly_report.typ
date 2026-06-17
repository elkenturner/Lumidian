#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h2, h3, callout, bullet

#let data = json("data.json")
#let brand_or_client = if "brand" in data and data.brand != none and "name" in data.brand { data.brand.name } else { data.client.name }

// Report hero: the brand being measured (not the agency client).
#cover(
  "report",
  brand_or_client,
  "Weekly report · " + data.period.label,
  data.generated_at,
  data.at("generated_by", default: none),
)

#header_footer(brand_or_client, "Weekly report · " + data.period.label)

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#callout[#data.output.executive_summary]

#block(breakable: false)[
  #h2[Visibility this week]
  #data.output.week_in_review
]
#v(lumidian.space_block)
#image(bytes(data.charts._chart_visibility_over_time), format: "svg", width: 100%)

#block(breakable: false)[
  #h2[Where the score comes from]
  #grid(columns: (1fr, 1.05fr), column-gutter: lumidian.space_block, rows: auto, align: top + center,
    image(bytes(data.charts._chart_model_mix), format: "svg", width: 100%),
    image(bytes(data.charts._chart_competitor_compare), format: "svg", width: 100%),
  )
]

#if data.output.per_prompt_callouts.len() > 0 [
  #block(breakable: false)[
    #h2[Per-prompt callouts]
    #for item in data.output.per_prompt_callouts [#bullet(item)]
  ]
]

#block(breakable: false)[
  #h3[Worst-scoring prompts this week]
  #image(bytes(data.charts._chart_prompt_scorecard), format: "svg", width: 100%)
]

#if data.output.competitor_delta != none [
  #block(breakable: false)[
    #h2[Competitor delta]
    #data.output.competitor_delta
  ]
]

#if data.output.content_shipped.len() > 0 [
  #block(breakable: false)[
    #h2[Content shipped]
    #for item in data.output.content_shipped [#bullet(item)]
  ]
]

#if data.output.top_gaps.len() > 0 [
  #block(breakable: false)[
    #h2[Top gaps to close]
    #for item in data.output.top_gaps [#bullet(item)]
  ]
]

#if data.output.next_week.len() > 0 [
  #block(breakable: false)[
    #h2[Next week]
    #for item in data.output.next_week [#bullet(item)]
  ]
]
