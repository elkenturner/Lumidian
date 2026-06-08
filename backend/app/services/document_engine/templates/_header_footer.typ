#import "_tokens.typ": lumidian

// header_footer(client_name, doc_kind_label) — call once at the top of a template,
// after the cover, to install running headers and page numbers.
#let header_footer(client_name, doc_kind_label) = {
  set page(
    paper: "us-letter",
    margin: lumidian.page_margin,
    fill: lumidian.paper,
    header: [
      #grid(columns: (1fr, auto),
        text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#client_name],
        text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#doc_kind_label]
      )
      #line(length: 100%, stroke: 0.5pt + lumidian.border)
    ],
    footer: context [
      #line(length: 100%, stroke: 0.5pt + lumidian.border)
      #grid(columns: (1fr, auto),
        text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[Lumidian],
        text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#counter(page).display() / #counter(page).final().first()]
      )
    ],
  )
}
