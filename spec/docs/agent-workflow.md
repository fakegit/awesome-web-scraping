# Agent Workflow

This repository is documentation-driven: the documents under `spec/docs/`
describe the intended design of the project.

While working on a task, keep the documentation and the implementation in
sync. At the commit/finish point:

- Check whether the work made any part of the documentation stale or
  inaccurate.
- If a document no longer matches the implementation, update it as part of
  the same change.
- If the mismatch is ambiguous — for example, it is unclear whether the code
  or the document reflects the intended behavior — ask the user for a hint
  rather than guessing.