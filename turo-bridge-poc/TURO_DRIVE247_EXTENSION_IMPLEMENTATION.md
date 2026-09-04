# Moved

The Turo → Drive247 extension documentation lives at the repository root:

**[`TURO_DRIVE247_EXTENSION_IMPLEMENTATION.md`](../TURO_DRIVE247_EXTENSION_IMPLEMENTATION.md)**

That file is canonical. This one is a pointer and holds no content of its own —
a second full copy is a second thing to keep in step, and the two had already
started to disagree about how sign-in errors are reported.

It covers the authentication flow and its failure taxonomy, email and password
field behaviour, session restore and refresh, tenant resolution, the one-way
Turo → Drive247 sync, the `app_users` exposure and the migration that closes it,
the access matrix, testing, deployment status and the rollback procedure.
