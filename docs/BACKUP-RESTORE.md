# Backup and Restore

Stop `grain daemon` before a consistent manual backup. Copy `~/.grain` and the
configured Engram database directory to encrypted storage. Protect config and
session backups as sensitive data; `.env` contains credentials.

To restore, install the same or newer Grain version, keep the new empty state as
a rollback copy, restore `~/.grain`, restore Engram separately, then run:

```sh
grain doctor
grain agents validate
grain engram status
```

Grain performs forward migrations and retains legacy session/learning sources.
Do not downgrade a migrated state without restoring the pre-upgrade backup.
Verified Engram snapshot/restore remains blocked on the Engram `/v1` server PR.
