// A drop-in Prisma replacement that translates ORM calls to SQLite/D1 SQL queries
// both locally (via Cloudflare API gateway) and in production.

// Requires the direct D1 binding (process.env.DB), injected by the Cloudflare
// Pages/Workers edge runtime. There is no network fallback: the Worker's
// /query endpoint no longer accepts arbitrary `sql` (that gateway was a
// critical vulnerability and has been removed entirely), so an environment
// without the DB binding simply cannot run these queries. Run
// `wrangler pages dev` locally to get the binding instead of `next dev`.
const runQuery = async (sql: string, params: any[] = []): Promise<any[]> => {
  const d1 = (process.env as any).DB;
  if (!d1 || typeof d1.prepare !== 'function') {
    throw new Error(
      "D1 binding 'DB' is unavailable in this environment. The remote SQL gateway " +
      "has been removed for security reasons; run this code where the D1 binding " +
      "is attached (e.g. `wrangler pages dev`)."
    );
  }
  const res = await d1.prepare(sql).bind(...params).all();
  return res.results || [];
};

export const prisma: any = {
  $queryRaw: async (queryArray: TemplateStringsArray, ...values: any[]) => {
    // Reconstruct the parameterized query from TemplateStringsArray
    const sql = queryArray.join('?');
    return await runQuery(sql, values);
  },

  user: {
    count: async () => {
      const rows = await runQuery("SELECT COUNT(*) as cnt FROM User");
      return rows[0]?.cnt || 0;
    }
  },

  country: {
    count: async () => {
      const rows = await runQuery("SELECT COUNT(*) as cnt FROM Country");
      return rows[0]?.cnt || 0;
    },
    findMany: async () => {
      return await runQuery("SELECT * FROM Country");
    },
    findFirst: async (args?: any) => {
      let sql = "SELECT * FROM Country";
      const params: any[] = [];
      if (args?.where?.code) {
        sql += " WHERE code = ?";
        params.push(args.where.code);
      }
      const rows = await runQuery(sql, params);
      return rows[0] || null;
    }
  },

  theme: {
    count: async () => {
      const rows = await runQuery("SELECT COUNT(*) as cnt FROM Theme");
      return rows[0]?.cnt || 0;
    }
  },

  catalog: {
    findMany: async (args?: any) => {
      let sql = "SELECT * FROM Catalog";
      if (args?.orderBy?.yearStart) {
        sql += ` ORDER BY yearStart ${args.orderBy.yearStart}`;
      } else if (args?.orderBy?.updatedAt) {
        sql += ` ORDER BY updatedAt ${args.orderBy.updatedAt}`;
      }
      if (args?.take) {
        sql += ` LIMIT ${args.take}`;
      }
      const catalogs = await runQuery(sql);
      // Mock images relation so pages don't crash
      return catalogs.map((c: any) => ({
        ...c,
        images: []
      }));
    },
    findUnique: async (args: { where: { id: string } }) => {
      const catalogs = await runQuery("SELECT * FROM Catalog WHERE id = ?", [args.where.id]);
      if (catalogs.length === 0) return null;
      const catalog = catalogs[0];
      
      const groups = await runQuery("SELECT * FROM StampGroup WHERE catalogId = ? ORDER BY \"order\" ASC", [catalog.id]);
      for (const group of groups) {
        const stamps = await runQuery("SELECT * FROM Stamp WHERE groupId = ? ORDER BY scottNumber ASC", [group.id]);
        group.stamps = stamps.map((s: any) => ({
          ...s,
          catalogNumbers: [],
          images: [{ isMain: true, image: { url: s.imageUrl } }],
          products: s.marketPriceUsd ? [{ price: s.marketPriceUsd, stock: 1, status: 'ACTIVE' }] : []
        }));
      }
      catalog.groups = groups;
      return catalog;
    },
    upsert: async (args: any) => {
      const existing = await runQuery("SELECT * FROM Catalog WHERE name = ?", [args.where.name]);
      if (existing.length > 0) return existing[0];
      const c = args.create;
      const id = c.id || crypto.randomUUID();
      await runQuery(
        "INSERT INTO Catalog (id, name, description, yearStart, yearEnd, status) VALUES (?, ?, ?, ?, ?, ?)",
        [id, c.name, c.description || null, c.yearStart || null, c.yearEnd || null, 'activo']
      );
      return { id, ...c };
    }
  },

  stampGroup: {
    findMany: async (args?: any) => {
      let sql = "SELECT * FROM StampGroup";
      const params: any[] = [];
      if (args?.where?.catalogId) {
        sql += " WHERE catalogId = ?";
        params.push(args.where.catalogId);
      }
      if (args?.orderBy?.year) sql += ` ORDER BY year IS NULL ASC, year ${args.orderBy.year}`;
      else if (args?.orderBy?.order) sql += ` ORDER BY "order" ${args.orderBy.order}`;
      else sql += ` ORDER BY year ASC`;
      // Respect take limit — default 20 to avoid fetching thousands of groups
      const limit = args?.take || 20;
      sql += ` LIMIT ${limit}`;
      const groups = await runQuery(sql, params);
      for (const group of groups) {
        // Limit stamps per group to avoid huge payloads
        const stampLimit = args?.include?.stamps?.take || 50;
        const stamps = await runQuery(
          `SELECT * FROM Stamp WHERE groupId = ? ORDER BY year ASC, scottNumber ASC LIMIT ${stampLimit}`,
          [group.id]
        );
        group.stamps = stamps.map((s: any) => ({
          ...s,
          titleEs: s.nameEs || s.nameEn || 'Sin nombre',  // alias for old schema compat
          titleEn: s.nameEn,
          catalogNumbers: [],
          images: s.imageUrl ? [{ isMain: true, image: { url: s.imageUrl } }] : [],
          products: s.marketPriceUsd ? [{ price: s.marketPriceUsd, stock: 1, status: 'ACTIVE' }] : []
        }));
      }
      return groups;
    },
    upsert: async (args: any) => {
      const existing = await runQuery("SELECT * FROM StampGroup WHERE catalogId = ? AND titleEs = ?", [args.create.catalogId, args.create.titleEs]);
      if (existing.length > 0) return existing[0];
      const g = args.create;
      const id = g.id || crypto.randomUUID();
      await runQuery(
        "INSERT INTO StampGroup (id, catalogId, titleEs, titleEn, year, description, \"order\") VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, g.catalogId, g.titleEs, g.titleEn || null, g.year || null, g.description || null, g.order || 0]
      );
      return { id, ...g };
    }
  },

  stamp: {
    count: async () => {
      const rows = await runQuery("SELECT COUNT(*) as cnt FROM Stamp");
      return rows[0]?.cnt || 0;
    },
    findMany: async (args?: any) => {
      let sql = "SELECT * FROM Stamp";
      const params: any[] = [];
      const conditions: string[] = [];
      if (args?.where?.countryCode) {
        conditions.push("countryCode = ?");
        params.push(args.where.countryCode);
      }
      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }
      if (args?.take) {
        sql += ` LIMIT ${args.take}`;
      }
      const stamps = await runQuery(sql, params);
      return stamps.map((s: any) => ({
        ...s,
        titleEs: s.nameEs || s.nameEn || 'Sin nombre',
        titleEn: s.nameEn,
        catalogNumbers: [],
        images: s.imageUrl ? [{ isMain: true, image: { url: s.imageUrl } }] : [],
        products: s.marketPriceUsd ? [{ price: s.marketPriceUsd, stock: 1, status: 'ACTIVE' }] : []
      }));
    },
    findUnique: async (args: { where: { id: string } }) => {
      const stamps = await runQuery("SELECT * FROM Stamp WHERE id = ?", [args.where.id]);
      if (stamps.length === 0) return null;
      const stamp = stamps[0];
      const groups = await runQuery("SELECT * FROM StampGroup WHERE id = ?", [stamp.groupId]);
      stamp.group = groups[0] || null;
      // Fetch country by code (Country table uses 'code' as the key)
      if (stamp.countryCode) {
        const countries = await runQuery("SELECT * FROM Country WHERE code = ?", [stamp.countryCode]);
        stamp.country = countries[0] || null;
      } else {
        stamp.country = null;
      }
      stamp.catalogNumbers = [];
      stamp.images = stamp.imageUrl ? [{ isMain: true, image: { url: stamp.imageUrl } }] : [];
      stamp.products = stamp.marketPriceUsd ? [{ price: stamp.marketPriceUsd, stock: 1, status: 'ACTIVE' }] : [];
      return stamp;
    },
    create: async (args: any) => {
      const s = args.data;
      const id = s.id || crypto.randomUUID();
      await runQuery(
        `INSERT INTO Stamp (
          id, wnsNumber, scottNumber, michelNumber, yvertNumber, countryCode, year,
          denomination, currency, nameEs, nameEn, descriptionEs, descriptionEn,
          groupId, countryId, imageUrl, imageThumbUrl, marketPriceUsd, rarityScore, isVerified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, s.wnsNumber || null, s.scottNumber || null, s.michelNumber || null, s.yvertNumber || null,
          s.countryCode || null, s.year || null, s.denomination || null, s.currency || null, s.nameEs, s.nameEn || null,
          s.descriptionEs || null, s.descriptionEn || null, s.groupId, s.countryId || null, s.imageUrl || null,
          s.imageThumbUrl || null, s.marketPriceUsd || null, s.rarityScore || null, s.isVerified ? 1 : 0
        ]
      );
      return { id, ...s };
    }
  },

  productCategory: {
    findMany: async () => {
      return await runQuery("SELECT * FROM ProductCategory ORDER BY name ASC");
    }
  },

  product: {
    count: async () => {
      const rows = await runQuery("SELECT COUNT(*) as cnt FROM Product");
      return rows[0]?.cnt || 0;
    },
    findMany: async (args?: any) => {
      let sql = "SELECT * FROM Product";
      const params: any[] = [];
      const conditions: string[] = [];
      if (args?.where?.status) {
        conditions.push("status = ?");
        params.push(args.where.status);
      }
      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }
      sql += " ORDER BY createdAt DESC";
      const products = await runQuery(sql, params);
      
      for (const prod of products) {
        prod.images = [{ isMain: true, image: { url: prod.imageUrl || '/placeholder.jpg' } }];
        if (prod.stampId) {
          const stamps = await runQuery("SELECT * FROM Stamp WHERE id = ?", [prod.stampId]);
          prod.stamp = stamps[0] || null;
        }
      }
      return products;
    },
    findUnique: async (args: { where: { id: string } }) => {
      const prods = await runQuery("SELECT * FROM Product WHERE id = ?", [args.where.id]);
      if (prods.length === 0) return null;
      const prod = prods[0];
      prod.images = [{ isMain: true, image: { url: prod.imageUrl || '/placeholder.jpg' } }];
      if (prod.stampId) {
        const stamps = await runQuery("SELECT * FROM Stamp WHERE id = ?", [prod.stampId]);
        prod.stamp = stamps[0] || null;
      }
      return prod;
    },
    create: async (args: any) => {
      const p = args.data;
      const id = p.id || crypto.randomUUID();
      await runQuery(
        "INSERT INTO Product (id, stampId, categoryId, name, description, price, stock, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, p.stampId || null, p.categoryId || null, p.name, p.description || null, p.price, p.stock || 0, p.status || 'ACTIVE']
      );
      return { id, ...p };
    }
  }
};

export default prisma;
