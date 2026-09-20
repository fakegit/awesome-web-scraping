import { readFileSync } from "node:fs"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { RESOURCE_LISTS } from "./lib/lists.mjs"
import { slugger } from "./lib/slugger.mjs"

let failures = 0
const report = (f, m) => {
  failures++
  console.error(`[${f}] ${m}`)
}

// Collect headings and the first "navigation list" (a list whose links all
// point to #-anchors) using mdast.
function analyze(file) {
  const src = readFileSync(file, "utf8")
  const tree = unified().use(remarkParse).parse(src)
  const headings = []
  let navLinks = null

  function hasOnlyAnchors(node) {
    if (node.type !== "list") return false
    let anchor = 0
    let other = 0
    const scan = (n) => {
      if (n.type === "link") {
        ;(n.url.startsWith("#") ? anchor++ : other++)
      }
      if (n.children) for (const c of n.children) scan(c)
    }
    for (const c of node.children) scan(c)
    return anchor > 0 && other === 0
  }

  function walk(node, inNav) {
    if (node.type === "heading") {
      const text = node.children
        .filter((c) => c.type === "text" || c.type === "inlineCode")
        .map((c) => c.value)
        .join("")
      headings.push({ depth: node.depth, text })
    }
    if (node.type === "list" && navLinks === null && hasOnlyAnchors(node)) {
      navLinks = []
      const collect = (n) => {
        if (n.type === "link" && n.url.startsWith("#")) navLinks.push(n.url.slice(1))
        if (n.children) for (const c of n.children) collect(c)
      }
      for (const c of node.children) collect(c)
      return // navigation list consumed; do not descend
    }
    if (node.children) for (const c of node.children) walk(c)
  }

  walk(tree)
  return { headings, navLinks }
}

// TOC depth: python/cli flat (## only), manuals deep (## + ###)
const TOC_DEPTH = { "manuals.md": [2, 3] }

for (const f of RESOURCE_LISTS) {
  if (f === "README.md") continue
  const { headings, navLinks } = analyze(f)
  const h1 = headings[0]
  const depths = TOC_DEPTH[f] ?? [2]
  const expect = headings
    .filter((h) => depths.includes(h.depth))
    .filter((h) => h.text !== "Contents" && h.text !== "Table of Contents")
    .map((h) => slugger(h.text))
  // drop H1 self-link from nav links
  const toc = (navLinks ?? []).filter((a) => a !== slugger(h1.text))

  if (JSON.stringify(expect) !== JSON.stringify(toc)) {
    report(
      f,
      "TOC != heading order\n  toc:     " +
        JSON.stringify(toc) +
        "\n  expected:" +
        JSON.stringify(expect)
    )
  }
}

// --- canon cross-check (python.md, reference implementation) ---
const canon = readFileSync("spec/docs/categories.md", "utf8")
const canonNames = [...canon.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map((m) => m[1])
const standing = ["Proxy Tools", "Proxy Server", "Whois", "JavaScript Engine"]

const py = analyze("python.md")
const pyHeadings = py.headings
  .filter((h) => h.depth === 2 && h.text !== "Contents")
  .map((h) => h.text)

for (const h of pyHeadings) {
  const hit =
    canonNames.some((c) => c === h || h.startsWith("Other ")) ||
    standing.includes(h)
  if (!hit) report("python.md", `top-level "${h}" not found in spec/docs/categories.md`)
}

for (const c of canonNames) {
  if (c === "Other Lists") continue
  const hit = pyHeadings.includes(c) || standing.some((s) => c.startsWith(s))
  if (!hit) report("spec/docs/categories.md", `canon entry "${c}" absent from python.md`)
}

for (const s of standing) {
  if (!pyHeadings.includes(s)) report("spec/docs/categories.md", `standing "${s}" absent from python.md`)
}

if (failures) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log("check-sync: OK")