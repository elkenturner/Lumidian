#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, h3, bullet, signature_block

#let data = json("data.json")

#cover("contract", data.brand.name, "Statement of work", data.generated_at, data.at("generated_by", default: none))
#header_footer(data.brand.name, "Statement of work")

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#h1[Statement of work]

#block[
  #text(font: lumidian.mono_font, size: lumidian.size_caption, fill: lumidian.muted)[Reference: #data.output.sow_number]
]

#h2[1. Preamble]
#data.output.preamble

#h2[2. Scope of work]
#data.output.scope

#if data.output.deliverables.len() > 0 [
  #h2[3. Deliverables]
  #for item in data.output.deliverables [#bullet(item)]
]

#if data.output.exclusions.len() > 0 [
  #h2[4. Exclusions]
  #for item in data.output.exclusions [#bullet(item)]
]

#h2[5. Timeline]
#data.output.timeline

#h2[6. Fees]
#data.output.fees

#h2[7. Acceptance & signatures]

#v(0.3in)

#signature_block(data.brand.name + " · Authorized signer", "Date")
#v(0.2in)
#signature_block("Lumidian · Authorized signer", "Date")
