#import "_tokens.typ": lumidian
#import "_cover.typ": slim_header
#import "_header_footer.typ": header_footer
#import "_components.typ": h2, check_item

#let data = json("data.json")

#header_footer(data.brand.name, "Kickoff checklist")

#set par(leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body)

#slim_header(
  data.brand.name,
  "Kickoff checklist",
  data.generated_at,
  data.at("generated_by", default: none),
)

#let pre_items = data.at("pre_kickoff_items", default: ())
#if pre_items.len() > 0 [
  #h2[Brand profile readiness]
  #for item in pre_items [#check_item(item.done, item.label)]
]

#if data.output.in_meeting.len() > 0 [
  #h2[In the kickoff meeting]
  #for item in data.output.in_meeting [#check_item(item.done, item.label)]
]

#if data.output.post_kickoff.len() > 0 [
  #h2[After the kickoff]
  #for item in data.output.post_kickoff [#check_item(item.done, item.label)]
]
