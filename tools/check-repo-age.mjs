import { gh, ghAll, collectTargetRepos } from "./lib/gh.mjs"

const owner = process.env.GITHUB_REPOSITORY_OWNER
const name = process.env.GITHUB_REPOSITORY_NAME
const pr = process.env.PR_NUMBER
const minAgeDays = Number(process.env.MIN_AGE_DAYS ?? 30)

if (!owner || !name || !pr) {
  console.error("missing env: GITHUB_REPOSITORY_OWNER, GITHUB_REPOSITORY_NAME, PR_NUMBER")
  process.exit(1)
}

const MARKER = "<!-- repo-age-check -->"

async function main() {
  const targets = await collectTargetRepos(owner, name, pr)

  const young = []
  for (const repo of targets) {
    let data
    try {
      data = await gh(`/repos/${repo}`)
    } catch (e) {
      console.log(`skip ${repo}: ${e.message.split("\n")[0]}`)
      continue
    }
    const created = new Date(data.created_at)
    const ageDays = (Date.now() - created.getTime()) / 86400000
    const ageLabel = ageDays < 1 ? "less than a day" : `${Math.floor(ageDays)} days`
    if (ageDays < minAgeDays) {
      young.push({ repo, created: data.created_at.slice(0, 10), ageLabel })
    }
    console.log(`${repo}: created ${data.created_at.slice(0, 10)} (${ageLabel} old)`)
  }

  const comments = await ghAll(`/repos/${owner}/${name}/issues/${pr}/comments`)
  const marked = comments.find((c) => c.body.includes(MARKER))

  if (young.length === 0) {
    if (marked) {
      await gh(`/repos/${owner}/${name}/issues/comments/${marked.id}`, { method: "DELETE" })
      console.log("no young repos; removed stale warning comment")
    } else {
      console.log(`no new github repos younger than ${minAgeDays} days`)
    }
    return
  }

  const lines = [
    MARKER,
    `Warning: the following proposed GitHub repos are younger than ${minAgeDays} days:`,
    "",
    ...young.map((y) => `- [${y.repo}](https://github.com/${y.repo}) - created ${y.created} (${y.ageLabel} old)`),
  ]
  const body = lines.join("\n")

  if (marked) {
    if (marked.body === body) {
      console.log("warning comment already up to date")
      return
    }
    await gh(`/repos/${owner}/${name}/issues/comments/${marked.id}`, { method: "PATCH", body: { body } })
    console.log("updated warning comment")
  } else {
    await gh(`/repos/${owner}/${name}/issues/${pr}/comments`, { method: "POST", body: { body } })
    console.log("posted warning comment")
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})