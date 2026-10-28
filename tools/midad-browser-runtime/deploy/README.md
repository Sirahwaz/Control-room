# Deployment bundle files

- `operator-worker.Dockerfile` builds a single long-running worker image.
- `Procfile` is for hosts that support a worker process entrypoint.
- `.env.example` lists configuration names only; every value is a placeholder.
- Mount the private account registry at `/var/lib/midad-browser/accounts.json` with restrictive permissions.
- Configure the MIDAD ingest key and platform password aliases in the host secret manager, not in the repository or archive.
- Run one worker replica per owner queue. The current poller uses in-process deduplication and has no atomic cross-process job lease.
