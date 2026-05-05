# Supabase migrations (mirror)

These SQL files mirror the Supabase migrations applied to project
`qqcljfqkrslwqakjjrvw` via the Supabase MCP. They are committed for
**audit and disaster-recovery replay**, not for re-running on the live
project.

## Source of truth

The Supabase project itself is the source of truth. To list applied
migrations:

```
list_migrations(project_id="qqcljfqkrslwqakjjrvw")
```

## Naming convention

`<version>_<name>.sql` where `<version>` is the Supabase-assigned
timestamp (`YYYYMMDDhhmmss`). Files sort chronologically.

## Adding new migrations to this mirror

When a migration is applied via Supabase MCP, copy the SQL into a new
file here using the version + name from `list_migrations`. The
`apply_migration` MCP call already records the SQL upstream, so this
mirror is purely a repo-side copy.
