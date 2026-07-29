/**
 * True when HTML carries no visible text.
 *
 * An "empty" contenteditable actually serialises to `<p><br></p>`, so a plain
 * `value === ""` check would wave a blank rejection reason straight through.
 */
export function isRemarksEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim() === "";
}
