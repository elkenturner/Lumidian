#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, check_item

#let data = json("data.json")

#cover("briefing", data.brand.name, "Kickoff checklist", data.generated_at, data.at("generated_by", default: none))
#header_footer(data.brand.name, "Kickoff checklist")

#set par(leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body)

#h1[Kickoff checklist]

#if data.output.pre_kickoff.len() > 0 [
  #h2[Before the meeting]
  #for item in data.output.pre_kickoff [#check_item(item.done, item.label)]
]

#if data.output.in_meeting.len() > 0 [
  #h2[In the meeting]
  #for item in data.output.in_meeting [#check_item(item.done, item.label)]
]

#if data.output.post_kickoff.len() > 0 [
  #h2[After the meeting]
  #for item in data.output.post_kickoff [#check_item(item.done, item.label)]
]
