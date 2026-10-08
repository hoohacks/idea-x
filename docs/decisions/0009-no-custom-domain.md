# 0009. No custom domain

Status: accepted

## Context

A root `CNAME` once held `ideathon.hoohacks.io/registration`. It never worked:
a CNAME must be a bare hostname, and a file outside `public/` is never copied into
the published build.

## Decision

Serve from `hoohacks.github.io/idea-x` with no custom domain.

## Consequences

- Do not simply add a CNAME back. `ideathon.hoohacks.io` already serves the
  marketing site, which links here; a CNAME naming it would point Pages at that
  host and take this app offline.
- Moving to a custom domain means changing four things together: DNS, the Pages
  setting, `base` in `vite.config.mjs`, and the base path in `public/404.html`.
