type LegalBlock = { kind: "heading" | "paragraph"; text: string };

const HEADING = /^## +(\S.*)$/;

// The body of a legal document is plain text: lines that start with "## " are headings, a blank line ends a paragraph.
// The blocks are rendered as text, never as markup.
export function parseLegalBody(body: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];

  function endParagraph() {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  }

  for (const line of body.split(/\r\n|\r|\n/)) {
    const heading = HEADING.exec(line.trimEnd());
    if (heading) {
      endParagraph();
      blocks.push({ kind: "heading", text: heading[1].trim() });
    } else if (line.trim() === "") {
      endParagraph();
    } else {
      paragraph.push(line.trim());
    }
  }
  endParagraph();
  return blocks;
}
