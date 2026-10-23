@AGENTS.md

## GitHub account

- Use the `phananhtuan09` account for every GitHub action in this repository (comments, reviews, PR edits, thread resolution), even when another `gh` account is active.
  Pass its token per command with `token=$(gh auth token -u phananhtuan09) && GH_TOKEN="$token" gh ...`, so a failed lookup stops the command instead of falling back to the active account; never act as `tuanpa-mor`.
