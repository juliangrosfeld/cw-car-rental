/**
 * The shape of a legal document as the site renders it.
 *
 * Legal text is stored as data, verbatim from the signed-off source file, and
 * laid out by src/components/site/legal-document.tsx. Formatting only: headings,
 * numbered clauses, paragraphs and bullet lists. The wording is never edited
 * here, including punctuation the brand copy rule would otherwise remove.
 */
export type LegalBlock =
  /** A paragraph. `number` is the clause number ("3.1"), printed in bold. */
  | { kind: 'clause'; number?: string; text: string }
  | { kind: 'list'; items: string[] }

export interface LegalSection {
  heading: string
  blocks: LegalBlock[]
}

export interface LegalDocument {
  title: string
  /** Lines printed above the title, as on the source document's letterhead. */
  letterhead?: string[]
  /** True while the real text has not been supplied. Renders a visible banner
   *  and must keep the page out of production. */
  draft?: boolean
  intro: string[]
  sections: LegalSection[]
  /** The source document's footer line. */
  footer?: string
}
