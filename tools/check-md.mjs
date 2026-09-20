import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import { RESOURCE_LISTS, INTERNAL_DOCS } from "./lib/lists.mjs"

let failures = 0
const report = (file, msg) => {
  failures++
  console.error(`[${file}] ${msg}`)
}

const isResourceList = (f) => RESOURCE_LISTS.includes(f)
const isInternalDoc = (f) => INTERNAL_DOCS.includes(f)
// category-style lists (enforce "Parent : Child" subcategory naming)
const isCategoryList = (f) =>
  ["python.md", "php.md", "ruby.md", "javascript.md", "golang.md", "java.md"].includes(f)

function lintMarkdown(file, src) {
  const lines = src.split("\n")
  const tree = unified().use(remarkParse).use(remarkGfm).parse(src)

  let headings = []
  let listItems = []
  let hasTable = false

  function walk(node) {
    if (node.type === "table") hasTable = true
    if (node.type === "heading") {
      const text = node.children
        .filter((c) => c.type === "text" || c.type === "inlineCode")
        .map((c) => c.value)
        .join("")
      headings.push({ depth: node.depth, text, line: node.position.start.line })
    }
    if (node.type === "listItem") {
      listItems.push(node)
    }
    if (node.children) for (const c of node.children) walk(c)
  }
  walk(tree)

  // 1. bullet marker
  if (isResourceList(file)) {
    for (const item of listItems) {
      const l = lines[item.position.start.line - 1]
      if (l && /^\s*- /.test(l)) {
        report(file, `line ${item.position.start.line}: "-" bullet; expected "*"`)
      }
    }
  }

  // 2. duplicate headings
  const seen = {}
  for (const h of headings) {
    const key = h.text.toLowerCase()
    if (seen[key]) {
      report(file, `duplicate heading "${h.text}" (lines ${seen[key]} and ${h.line})`)
    }
    seen[key] = h.line
  }

  // 3. subcategory naming (category lists only)
  const h2set = new Set(headings.filter((h) => h.depth === 2).map((h) => h.text))
  if (isCategoryList(file)) {
    for (const h of headings) {
      if (h.depth !== 3) continue
      const m = h.text.match(/^([^:]+?)\s*:\s*(.+)$/)
      if (!m) {
        report(file, `line ${h.line}: level-3 heading "${h.text}" lacks "Parent : Child"`)
        continue
      }
      if (!h2set.has(m[1])) {
        report(file, `line ${h.line}: subcategory "${h.text}" has no "## ${m[1]}" parent`)
      }
      if (h.text.includes("::")) {
        report(file, `line ${h.line}: double-colon in "${h.text}"`)
      }
    }
  }

  // 4. tables
  if (hasTable) report(file, "table detected; tables are banned")

  // 5. entry grammar (resource lists only)
  if (isResourceList(file)) {
    for (const item of listItems) {
      const line = item.position.start.line
      const raw = lines[line - 1]
      if (!raw) continue
      const c = raw.trim()
      if (c === "* TODO" || c === "- TODO" || c === "* EMPTY CONTENT") continue
      // TOC / navigation links (anchor targets) are not entries
      if (/^\* \[.+\]\(#.+\)$/.test(c)) continue
      // Grouping labels (bare text, no link) are not entries
      if (!/\[.+\]\(.+\)/.test(c)) continue
      // ---- now c is a link-bearing line ----
      if (file === "README.md") {
        // loose index: bare links permitted
        if (/^\* \[.+\]\(.+\)$/.test(c)) continue
        if (!/^\* \[.+\]\([^)]+\)\s*-\s*.*/.test(c)) {
          report(file, `line ${line}: README entry malformed: ${c.slice(0, 50)}`)
        }
        continue
      }
      if (file === "manuals.md") {
        if (/^\* \[.+\]\(.+\)$/.test(c)) continue // link-only ok
        if (!/^\* \[.+\]\([^)]+\)\s*-\s*.*/.test(c)) {
          report(file, `line ${line}: manuals entry malformed: ${c.slice(0, 50)}`)
        }
        continue
      }
      if (!/^\* \[.+\]\(https?:\/\/[^)]+\)\s*-\s*.*/.test(c)) {
        if (/^\* \[.+\]\(https?:\/\/[^)]+\)$/.test(c)) {
          report(file, `line ${line}: entry missing " - description": ${c.slice(0, 60)}`)
        } else {
          report(file, `line ${line}: entry malformed: ${c.slice(0, 60)}`)
        }
      }
    }
  }
}

// ---- driver ----
const allMd = readdirSync(".").filter((f) => f.endsWith(".md"))

for (const file of allMd) {
  const src = readFileSync(file, "utf8")
  lintMarkdown(file, src)
}

// ---- line length: internal docs only ----
const LEN = 88
for (const file of INTERNAL_DOCS) {
  if (!existsSync(file)) continue
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((l, i) => {
      if (l.length > LEN) {
        report(file, `line ${i + 1}: ${l.length} chars > ${LEN}`)
      }
    })
}

if (failures) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log("check-md: OK")