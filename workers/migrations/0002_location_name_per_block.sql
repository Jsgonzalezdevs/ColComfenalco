DROP INDEX IF EXISTS locations_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS locations_name_block_unique
  ON locations(lower(trim(name)), lower(trim(block)));
