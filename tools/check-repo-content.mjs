import { gh, ghAll, collectTargetRepos } from "./lib/gh.mjs"

const owner = process.env.GITHUB_REPOSITORY_OWNER
const name = process.env.GITHUB_REPOSITORY_NAME
const pr = process.env.PR_NUMBER
const apiKey = process.env.OPENCODE_API_KEY
const model = process.env.OPENCODE_MODEL ?? "mimo-v2.5"
const endpoint = process.env.OPENCODE_ENDPOINT ?? "https://opencode.ai/zen/go/v1/chat/completions"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const reposArg = args.find((a) => a.startsWith("--repos="))
const reposOverride = reposArg ? reposArg.split("=")[1].split(",").filter(Boolean) : null

if (!owner || !name || !pr) {
  if (!reposOverride) {
    console.error("missing env: GITHUB_REPOSITORY_OWNER, GITHUB_REPOSITORY_NAME, PR_NUMBER (or pass --repos=owner/repo,...)")
    process.exit(1)
  }
}

if (!apiKey) {
  console.log("OPENCODE_API_KEY not set; skipping AI-content check")
  process.exit(0)
}

const MARKER = "<!-- repo-content-check -->"
const README_CAP = 4000

async function repoInfo(repo) {
  let meta
  try {
    meta = await gh(`/repos/${repo}`)
  } catch (e) {
    console.log(`skip ${repo}: ${e.message.split("\n")[0]}`)
    return null
  }
  let readme = ""
  try {
    readme = await gh(`/repos/${repo}/readme`, { raw: true })
  } catch {
    readme = ""
  }
  return {
    repo,
    description: meta.description ?? "",
    topics: (meta.topics ?? []).join(", "),
    readme: readme.slice(0, README_CAP),
  }
}

async function classify(info, line) {
  const prompt = `You curate "awesome-web-scraping", an awesome list of web-scraping software. The list rejects projects about AI agents, AI-assisted/agentic coding, and the Model Context Protocol (MCP). A contributor proposed a GitHub repo. Decide whether the project is primarily about AI agents / agentic AI / MCP (i.e. "AI-shit"). Reply with exactly one word: "yes" or "no".

Proposed list entry: ${line || "(none)"}
Repo description: ${info.description || "(none)"}
Repo topics: ${info.topics || "(none)"}
Repo README (first ${README_CAP} chars):
${info.readme || "(none)"}

Answer:`

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 100,
    reasoning_effort: "none",
  }
  let res
  for (let attempt = 1; ; attempt++) {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "awesome-web-scraping-check/1.0",
        "x-opencode-session": `check-repo-content-${model}`,
      },
      body: JSON.stringify(body),
    })
    if (res.ok || attempt >= 4) break
    await new Promise((r) => setTimeout(r, 15000 * attempt))
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenCode API -> ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const answer = (data?.choices?.[0]?.message?.content ?? "")
    .trim()
    .toLowerCase()
  if (!answer) throw new Error("OpenCode returned no answer text")
  return answer.startsWith("yes")
}

async function main() {
  let repos = reposOverride
  if (!repos) {
    repos = await collectTargetRepos(owner, name, pr)
  }

  const flagged = []
  for (const repo of repos) {
    const info = await repoInfo(repo)
    if (!info) continue
    let verdict
    try {
      verdict = await classify(info, "")
    } catch (e) {
      console.log(`skip ${repo}: ${e.message.split("\n")[0]}`)
      continue
    }
    console.log(`${repo}: ${verdict ? "yes (AI)" : "no"}`)
    if (verdict) flagged.push(info)
  }

  if (dryRun) {
    console.log(`dry run: ${flagged.length} flagged repo(s); no comments posted`)
    return
  }

  const comments = await ghAll(`/repos/${owner}/${name}/issues/${pr}/comments`)
  const marked = comments.find((c) => c.body.includes(MARKER))

  if (flagged.length === 0) {
    if (marked) {
      await gh(`/repos/${owner}/${name}/issues/comments/${marked.id}`, { method: "DELETE" })
      console.log("no AI projects; removed stale comment")
    } else {
      console.log("no AI-related projects found")
    }
    return
  }

  const lines = [
    MARKER,
    "Note: the following proposed projects are primarily about AI agents / agentic AI / MCP. AI projects are not accepted in this awesome list (see Restricted Content in `CONTRIBUTING.md`).",
    "",
    ...flagged.map((f) => `- [${f.repo}](https://github.com/${f.repo}) - ${f.description}`),
  ]
  const body = lines.join("\n")

  if (marked) {
    if (marked.body === body) {
      console.log("comment already up to date")
      return
    }
    await gh(`/repos/${owner}/${name}/issues/comments/${marked.id}`, { method: "PATCH", body: { body } })
    console.log("updated comment")
  } else {
    await gh(`/repos/${owner}/${name}/issues/${pr}/comments`, { method: "POST", body: { body } })
    console.log("posted comment")
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})