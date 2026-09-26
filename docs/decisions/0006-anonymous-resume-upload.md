# 0006. Résumés upload before the account exists

Status: accepted

## Context

The registration form takes a résumé. Uploading it after sign-up would mean a
second step that can fail after the account already exists, leaving a
half-registered person, and the form was built to finish in one go.

## Decision

`storage.rules` allows an unauthenticated write to the résumé path, capped at
5 MB and to PDF and Word document types. Reads require sign-in.

## Consequences

- There is an anonymous write endpoint, kept narrow by the size and type caps.
- The alternative, if abuse ever appears, is to create the account first and
  upload with its credentials, at the cost of a second failure point in the form.
- Download URLs carry their own token, so the links themselves must be treated as
  secrets.
