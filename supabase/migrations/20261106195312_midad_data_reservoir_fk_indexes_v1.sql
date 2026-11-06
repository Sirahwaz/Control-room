create index if not exists midad_archive_outbox_retention_class_idx
  on midad_private.midad_archive_outbox(retention_class);

create index if not exists midad_archive_restore_manifest_idx
  on midad_private.midad_archive_restore_jobs(manifest_id);
