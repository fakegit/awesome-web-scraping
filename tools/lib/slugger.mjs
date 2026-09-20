// GitHub-style heading anchor: lowercase; keep word chars, spaces and
// hyphens; drop everything else; spaces -> hyphens.
export function slugger(text) {
  const lower = text.toLowerCase().trim()
  const cleaned = lower.replace(/[^\w\s-]/g, "")
  return cleaned.replace(/\s+/g, "-")
}