-- Seed data for D1 database

-- --- COUNTRIES ---
INSERT OR IGNORE INTO Country (id, code, nameEs, nameEn, continent, totalStamps, stampsFromYear, stampsToYear) VALUES
('pe-id', 'PE', 'Perú', 'Peru', 'South America', 10004, 1857, 2024),
('il-id', 'IL', 'Israel', 'Israel', 'Asia', 2300, 1948, 2024),
('cl-id', 'CL', 'Chile', 'Chile', 'South America', 0, 1853, 2024),
('br-id', 'BR', 'Brasil', 'Brazil', 'South America', 0, 1843, 2024);

-- --- CATALOGS ---
INSERT OR IGNORE INTO Catalog (id, name, description, yearStart, yearEnd, status) VALUES
('cat-pe-1', 'Perú Clásico (1857-1900)', 'Catálogo completo de los primeros sellos postales emitidos en la República del Perú.', 1857, 1900, 'activo'),
('cat-il-1', 'Israel (1948-1950)', 'Primeros sellos del Estado de Israel.', 1948, 1950, 'activo'),
('cat-cl-1', 'Chile - Primeros Centavos', 'Catálogo de sellos clásicos chilenos.', 1853, 1900, 'en_construccion'),
('cat-br-1', 'Brasil - Ojos de Buey', 'Catálogo del primer sello postal de América.', 1843, 1890, 'en_construccion');

-- --- STAMP GROUPS ---
INSERT OR IGNORE INTO StampGroup (id, catalogId, titleEs, titleEn, year, description, "order") VALUES
('group-pe-1', 'cat-pe-1', 'Primeras Emisiones Provisionales de la Compañía de Navegación a Vapor Pacífico', 'Pacific Steam Navigation Company First Provisional Issues', 1857, 'Emisiones impresas en Londres y usadas en Perú en 1857 de forma provisional.', 1),
('group-pe-2', 'cat-pe-1', 'Emisión del Escudo de Armas de 1858', '1858 Coat of Arms Issue', 1858, 'La primera emisión oficial grabada en Lima por el grabador Emil Lecoq.', 2),
('group-il-1', 'cat-il-1', 'Monedas de Judea de 1948', '1948 Judean Coins', 1948, 'La primera serie de sellos postales emitidos tras la independencia de Israel.', 1);

-- --- STAMPS ---
INSERT OR IGNORE INTO Stamp (
  id, wnsNumber, scottNumber, michelNumber, yvertNumber,
  countryCode, year, denomination, currency, nameEs, nameEn, descriptionEs, descriptionEn,
  groupId, countryId, imageUrl, imageThumbUrl, marketPriceUsd, rarityScore, isVerified
) VALUES
('stamp-pe-psnc-1', 'PE-1857-01', '1', '1', '1', 'PE', 1857, 1.0, 'Real', '1 Real Azul (PSNC)', '1 Real Blue (PSNC)', 'Sello de la Pacific Steam Navigation Company sobrecargado para uso en Perú.', 'Pacific Steam Navigation Company stamp overprinted for Peruvian local usage.', 'group-pe-1', 'pe-id', '/images/stamps/pe-psnc-1.png', '/images/stamps/pe-psnc-1.png', 450.00, 8.5, 1),
('stamp-pe-psnc-2', 'PE-1857-02', '2', '2', '2', 'PE', 1857, 2.0, 'Reales', '2 Reales Marrón (PSNC)', '2 Reales Brown (PSNC)', 'Sello provisional de 2 reales marrón de la compañía PSNC.', 'Provisional 2 reales brown stamp of the PSNC.', 'group-pe-1', 'pe-id', '/images/stamps/pe-psnc-2.png', '/images/stamps/pe-psnc-2.png', 600.00, 9.0, 1),
('stamp-pe-arms-1', 'PE-1858-01', '3', '3', '3', 'PE', 1858, 1.0, 'Dinero', '1 Dinero Azul', '1 Dinero Blue', 'Primer sello nacional oficial impreso en Lima por Lecoq con el escudo peruano.', 'First official national stamp printed in Lima by Lecoq featuring the Peruvian coat of arms.', 'group-pe-2', 'pe-id', '/images/stamps/pe-arms-1.png', '/images/stamps/pe-arms-1.png', 75.00, 5.0, 1),
('stamp-pe-arms-2', 'PE-1858-02', '4', '4', '4', 'PE', 1858, 1.0, 'Peseta', '1 Peseta Rosa', '1 Peseta Pink', 'Sello oficial de 1 peseta color rosa grabado en Lima.', 'Official 1 peseta pink stamp engraved in Lima.', 'group-pe-2', 'pe-id', '/images/stamps/pe-arms-2.png', '/images/stamps/pe-arms-2.png', 120.00, 6.0, 1),
('stamp-il-coin-1', 'IL-1948-01', '1', '1', '1', 'IL', 1948, 3.0, 'Mils', '3 Mils Verde - Monedas de Judea', '3 Mils Green - Judean Coins', 'Sello conmemorativo de la primera emisión de Israel con monedas antiguas.', 'Commemorative stamp from Israel first issue featuring ancient coins.', 'group-il-1', 'il-id', '/images/stamps/il-coin-1.png', '/images/stamps/il-coin-1.png', 25.00, 3.0, 1);

-- --- PRODUCT CATEGORIES ---
INSERT OR IGNORE INTO ProductCategory (id, name) VALUES
('cat-prod-1', 'estampillas'),
('cat-prod-2', 'accesorios'),
('cat-prod-3', 'álbumes');

-- --- PRODUCTS ---
INSERT OR IGNORE INTO Product (id, stampId, categoryId, name, description, price, stock, status) VALUES
('prod-1', 'stamp-pe-psnc-1', 'cat-prod-1', '1 Real Azul PSNC Original Usado', 'Estampilla provisional original de 1857 usada, en buen estado de conservación.', 420.00, 1, 'ACTIVE'),
('prod-2', 'stamp-pe-arms-1', 'cat-prod-1', '1 Dinero Azul 1858 Sin Matasellos', 'Sello nacional de 1 dinero azul nuevo con goma original.', 95.00, 3, 'ACTIVE'),
('prod-3', NULL, 'cat-prod-2', 'Lupa Profesional Filatélica con Luz UV', 'Lupa de 10x aumentos con iluminación LED y luz ultravioleta para detectar filigranas y fluorescencias.', 35.00, 12, 'ACTIVE'),
('prod-4', NULL, 'cat-prod-3', 'Álbum Clasificador Premium de Cuero Verde Musgo', 'Clasificador de sellos con 64 páginas de fondo negro y tiras transparentes de protección.', 65.00, 5, 'ACTIVE');
