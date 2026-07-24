-- D1 Database Schema for Filatelia

-- --- AUTH & USERS ---
CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  emailVerified INTEGER,
  image TEXT,
  password TEXT,
  firstName TEXT,
  lastName TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Role (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS UserRole (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  roleId TEXT NOT NULL REFERENCES Role(id) ON DELETE CASCADE,
  UNIQUE(userId, roleId)
);

-- --- CORE FILATELIA ---
CREATE TABLE IF NOT EXISTS Country (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE, -- ISO 2-letter
  nameEs TEXT NOT NULL,
  nameEn TEXT NOT NULL,
  continent TEXT,
  totalStamps INTEGER DEFAULT 0,
  stampsFromYear INTEGER,
  stampsToYear INTEGER
);

CREATE TABLE IF NOT EXISTS Theme (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS Catalog (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  description TEXT,
  yearStart INTEGER,
  yearEnd INTEGER,
  status TEXT DEFAULT 'en_construccion', -- activo, en_construccion, borrador, inactivo
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS StampGroup (
  id TEXT PRIMARY KEY,
  catalogId TEXT NOT NULL REFERENCES Catalog(id) ON DELETE CASCADE,
  titleEs TEXT NOT NULL,
  titleEn TEXT,
  year INTEGER,
  description TEXT,
  "order" INTEGER DEFAULT 0,
  UNIQUE(catalogId, titleEs)
);

CREATE TABLE IF NOT EXISTS Stamp (
  id TEXT PRIMARY KEY,
  wnsNumber TEXT UNIQUE,
  scottNumber TEXT,
  michelNumber TEXT,
  yvertNumber TEXT,
  
  countryCode TEXT,
  year INTEGER,
  issueDate TEXT,
  denomination REAL,
  currency TEXT,
  faceValueUsd REAL,
  
  nameEs TEXT NOT NULL,
  nameEn TEXT,
  descriptionEs TEXT,
  descriptionEn TEXT,
  theme TEXT,
  subtheme TEXT,
  tags TEXT, -- Comma separated tags
  
  color TEXT,
  perforation TEXT,
  watermark TEXT,
  printTechnique TEXT,
  paperType TEXT,
  sizeMm TEXT,
  shape TEXT DEFAULT 'rectangular',
  
  printRun INTEGER,
  printer TEXT,
  designer TEXT,
  engraver TEXT,
  
  rarityScore REAL,
  conditionMintUsd REAL,
  conditionUsedUsd REAL,
  marketPriceUsd REAL,
  marketPriceUpdatedAt TEXT,
  
  imageUrl TEXT,
  imageThumbUrl TEXT,
  imageBackUrl TEXT,
  
  groupId TEXT NOT NULL REFERENCES StampGroup(id) ON DELETE CASCADE,
  countryId TEXT REFERENCES Country(id),
  themeId TEXT REFERENCES Theme(id),
  
  source TEXT,
  sourceUrl TEXT,
  isVerified INTEGER DEFAULT 0,
  isErrorStamp INTEGER DEFAULT 0,
  isRare INTEGER DEFAULT 0,
  
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- --- PRICE ALERTS ---
CREATE TABLE IF NOT EXISTS PriceAlert (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  stampId TEXT NOT NULL REFERENCES Stamp(id) ON DELETE CASCADE,
  targetPrice REAL NOT NULL,
  condition TEXT,
  alertType TEXT DEFAULT 'below',
  isActive INTEGER DEFAULT 1,
  isNotified INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- --- STORE & PRODUCTS ---
CREATE TABLE IF NOT EXISTS ProductCategory (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS Product (
  id TEXT PRIMARY KEY,
  stampId TEXT REFERENCES Stamp(id) ON DELETE SET NULL,
  categoryId TEXT REFERENCES ProductCategory(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  stock INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- --- ORDERS & TRANSACTIONS ---
CREATE TABLE IF NOT EXISTS "Order" (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES User(id),
  status TEXT DEFAULT 'PENDING',
  totalAmount REAL NOT NULL,
  shippingAddress TEXT,
  paymentMethod TEXT,
  paymentId TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS OrderItem (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE,
  productId TEXT NOT NULL REFERENCES Product(id),
  quantity INTEGER NOT NULL,
  price REAL NOT NULL
);

-- --- INDEXES FOR PERFORMANCE ---
CREATE INDEX IF NOT EXISTS idx_stamps_country_code ON Stamp(countryCode);
CREATE INDEX IF NOT EXISTS idx_stamps_year ON Stamp(year);
CREATE INDEX IF NOT EXISTS idx_stamps_theme ON Stamp(theme);
CREATE INDEX IF NOT EXISTS idx_stamps_group ON Stamp(groupId);
CREATE INDEX IF NOT EXISTS idx_stamps_wns ON Stamp(wnsNumber);
