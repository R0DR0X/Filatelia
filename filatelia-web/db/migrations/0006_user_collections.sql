-- D1 Migration v6: UserCollection table with list types and condition grades
CREATE TABLE IF NOT EXISTS UserCollection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  stamp_id TEXT NOT NULL,
  list_type TEXT CHECK(list_type IN ('collection', 'wishlist', 'trade')) NOT NULL,
  condition TEXT CHECK(condition IN ('MNH', 'MH', 'Used', 'FDC')) NOT NULL DEFAULT 'MNH',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, stamp_id, list_type)
);

CREATE INDEX IF NOT EXISTS idx_user_collection_user_type ON UserCollection(user_id, list_type);
CREATE INDEX IF NOT EXISTS idx_user_collection_stamp ON UserCollection(stamp_id);
