# 0011. Hash routing on GitHub Pages

Status: accepted

## Context

GitHub Pages serves static files and has no server-side rewrites, so a deep
link like `/idea-x/user/team` would 404 on reload with ordinary routing.

## Decision

Use React Router's hash mode: routes live after a `#`. Path-shaped URLs are
rewritten to their hash form by `src/hashRedirect.js` and `public/404.html`.

## Consequences

- Every link and every URL sent to people includes the `#`.
- A bare path used to fall through to the competitor form, because an empty hash
  matches `/`; the rewrite fixes that, but the `#` form is still the one to send.
