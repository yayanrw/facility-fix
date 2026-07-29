import sanitizeHtml from "sanitize-html";

/**
 * Cleans reviewer/approver remarks before they are stored.
 *
 * Sanitising on **write** rather than on read means the stored value is
 * trustworthy: there is no way for one render path to forget to clean it. The
 * WYSIWYG editor in the browser is a convenience, never a trust boundary —
 * anything can be posted to the Server Action directly.
 *
 * `<img>` and `<script>` are absent from the allow-list, so `onerror=` and
 * friends have nothing to attach to.
 */
export function cleanRemarks(dirty: string | null | undefined): string | null {
  if (!dirty) return null;

  const clean = sanitizeHtml(dirty, {
    allowedTags: ["b", "strong", "i", "em", "u", "p", "br", "ul", "ol", "li", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    // Stops a same-tab navigation from handing window.opener to the target.
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });

  return clean.trim() === "" ? null : clean;
}
