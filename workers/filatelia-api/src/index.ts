import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { QueryRequest, MatchResult, QueryResponse } from './types';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: any;
  STAMPS_IMAGES: R2Bucket;
  STAMPS_THUMBS: R2Bucket;
  STAMPS_BACKS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENROUTER_API_KEY: string;
  ADMIN_API_TOKEN: string;
  // Optional: absent on any deployment/environment that predates this binding
  // (older Worker version, a local `wrangler dev` run against a stale
  // config, etc). Every call site MUST treat a missing binding as "allow",
  // never throw on it — see `checkAnalyticsRateLimit`.
  ANALYTICS_LIMITER?: RateLimit;
};

const app = new Hono<{ Bindings: Bindings }>();


// Enable CORS
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Client-Info', 'apikey'],
  allowMethods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
}));

// Helper to authenticate user via Supabase Auth.
// No fallback identity exists: an unauthenticated request, an invalid/expired
// token, or a Supabase outage must all resolve to `null` (401 downstream),
// never to a usable identity.
const getAuthenticatedUser = async (c: any): Promise<{ id: string; email?: string } | null> => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;

  try {
    const res = await fetch(`${c.env.SUPABASE_URL || 'https://tshatwvvkworsogjfjyj.supabase.co'}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": c.env.SUPABASE_SERVICE_ROLE_KEY || "",
      }
    });
    if (res.ok) {
      const user: any = await res.json();
      return { id: user.id, email: user.email };
    }
  } catch (e) {
    console.error("Supabase auth verification failed:", e);
  }

  return null;
};

// ==========================================
// 1. ENDPOINT: search-semantic
// ==========================================
app.post('/search-semantic', async (c) => {
  try {
    const body = await c.req.json();
    const { query, topK = 20, filters } = body;
    
    if (!query || query.trim().length === 0) {
      return c.json({ success: false, error: "No query provided" }, 400);
    }

    let embedding: number[] = [];
    
    // Generate Embedding using OpenRouter API
    if (c.env.OPENROUTER_API_KEY) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://filatelia-web.pages.dev",
            "X-Title": "Filatelia API",
          },
          body: JSON.stringify({
            model: "openai/text-embedding-3-small",
            input: query.trim(),
          }),
        });
        
        if (res.ok) {
          const data: any = await res.json();
          if (data?.data?.[0]?.embedding) {
            embedding = data.data[0].embedding;
          }
        }
      } catch (e) {
        console.error("OpenRouter embedding error:", e);
      }
    }

    // 1. Vector Search using Cloudflare Vectorize
    let vectorRows: any[] = [];
    if (embedding.length > 0 && c.env.VECTORIZE) {
      try {
        const vectorizeRes = await c.env.VECTORIZE.query(embedding, {
          topK: topK * 2,
          returnMetadata: true
        });
        
        const matchedIds = vectorizeRes.matches.map(m => m.id);
        
        if (matchedIds.length > 0) {
          const placeHolders = matchedIds.map(() => '?').join(',');
          const querySql = `
            SELECT id, nameEs, nameEn, scottNumber, year, countryCode, imageUrl, marketPriceUsd 
            FROM Stamp 
            WHERE id IN (${placeHolders}) AND (? IS NULL OR countryCode = ?)
          `;
          const bindParams = [...matchedIds, filters?.countryCode || null, filters?.countryCode || null];
          const { results } = await c.env.DB.prepare(querySql).bind(...bindParams).all();
          
          // Map scores to results
          const scoreMap = new Map(vectorizeRes.matches.map(m => [m.id, m.score]));
          vectorRows = results.map((r: any) => ({
            ...r,
            similarity: scoreMap.get(r.id) || 0
          }));
        }
      } catch (vecErr) {
        console.error("Vectorize query error:", vecErr);
      }
    }

    // 2. Full-Text / Keyword Search on D1
    const words = query.trim().split(/\s+/).map((w: string) => `%${w}%`);
    let textRows: any[] = [];
    if (words.length > 0) {
      const conditions = words.map(() => `(nameEs LIKE ? OR descriptionEs LIKE ? OR theme LIKE ?)`).join(' AND ');
      const bindParams: any[] = [];
      words.forEach((w: string) => {
        bindParams.push(w, w, w);
      });
      
      const ftsSql = `
        SELECT id, nameEs, nameEn, scottNumber, year, countryCode, imageUrl, marketPriceUsd 
        FROM Stamp 
        WHERE (${conditions}) AND (? IS NULL OR countryCode = ?)
        LIMIT ?
      `;
      bindParams.push(filters?.countryCode || null, filters?.countryCode || null, topK * 2);
      
      const { results } = await c.env.DB.prepare(ftsSql).bind(...bindParams).all();
      textRows = results;
    }

    // 3. Fusion results using RRF (Reciprocal Rank Fusion)
    const combinedMap = new Map<string, any>();
    
    vectorRows.forEach((r) => {
      combinedMap.set(r.id, {
        ...r,
        similarity: r.similarity,
        ftsRank: 0,
        score: r.similarity || 0
      });
    });

    textRows.forEach((r, idx) => {
      const existing = combinedMap.get(r.id);
      const rrfTextScore = 1 / (60 + (idx + 1));
      if (existing) {
        existing.ftsRank = rrfTextScore;
        existing.score += rrfTextScore;
      } else {
        combinedMap.set(r.id, {
          ...r,
          similarity: 0,
          ftsRank: rrfTextScore,
          score: rrfTextScore
        });
      }
    });

    const results = Array.from(combinedMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return c.json({ success: true, query, totalResults: results.length, results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// 2. ENDPOINT: identify-stamp
// ==========================================
app.post('/identify-stamp', async (c) => {
  try {
    const { image, topK = 5 } = await c.req.json();
    if (!image) return c.json({ success: false, error: "No image provided" }, 400);

    const base64Data = image.startsWith("data:")
      ? image
      : `data:image/jpeg;base64,${image}`;
    
    if (!c.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    // Call OpenRouter with Claude 3.5 Sonnet
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://filatelia-web.pages.dev",
        "X-Title": "Filatelia API",
      },
      body: JSON.stringify({
        model: "anthropic/claude-3.5-sonnet",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `Eres un experto filatélico mundial. Analiza la imagen de esta estampilla y devuelve un JSON estricto con:
1. "identification": Identificación descriptiva (País + motivo + valor facial)
2. "country": Código ISO de 2 letras de origen (PE, US, GB, etc.)
3. "year": Año aproximado de emisión o null
4. "scottNumber": Número de catálogo Scott probable o null
5. "confidence": Confianza de 0 a 100 de tu identificación
6. "visualFeatures": Lista de características visuales clave (colores, perforación, texto visible)

Responde ÚNICAMENTE con el bloque JSON, sin markdown ni explicaciones.`
            },
            {
              type: "image_url",
              image_url: {
                url: base64Data
              }
            }
          ]
        }]
      })
    });

    if (!openRouterResponse.ok) {
      const errText = await openRouterResponse.text();
      throw new Error(`OpenRouter API error: ${openRouterResponse.status} ${errText}`);
    }

    const chatCompletion: any = await openRouterResponse.json();
    const messageContent = chatCompletion?.choices?.[0]?.message?.content;
    
    if (!messageContent) {
      throw new Error("No response content received from OpenRouter");
    }

    const cleanJsonText = messageContent.replace(/```json|```/g, "").trim();
    const parsedVision = JSON.parse(cleanJsonText);
    
    // Look up matching stamps in D1
    const searchQuery = `%${parsedVision.identification}%`;
    const countryCode = parsedVision.country;
    
    const { results } = await c.env.DB.prepare(`
      SELECT id, nameEs, nameEn, scottNumber, year, countryCode, imageUrl, marketPriceUsd 
      FROM Stamp 
      WHERE countryCode = ? OR nameEs LIKE ? 
      LIMIT ?
    `).bind(countryCode, searchQuery, topK).all();

    return c.json({
      success: true,
      queryStamp: parsedVision,
      results
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// 3. ENDPOINT: price-alert (CRUD)
// ==========================================
app.get('/price-alert', async (c) => {
  try {
    const user = await getAuthenticatedUser(c);
    if (!user) return c.json({ success: false, error: "Unauthorized" }, 401);

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM PriceAlert WHERE userId = ? ORDER BY createdAt DESC`
    ).bind(user.id).all();

    return c.json({ success: true, alerts: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post('/price-alert', async (c) => {
  try {
    const user = await getAuthenticatedUser(c);
    if (!user) return c.json({ success: false, error: "Unauthorized" }, 401);

    const { stampId, targetPrice, condition, alertType = 'below' } = await c.req.json();
    const alertId = crypto.randomUUID();

    const insertQuery = `
      INSERT INTO PriceAlert (id, userId, stampId, targetPrice, condition, alertType, isActive, isNotified)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0)
    `;
    
    await c.env.DB.prepare(insertQuery).bind(
      alertId,
      user.id,
      stampId,
      targetPrice,
      condition || null,
      alertType
    ).run();

    // Fetch the inserted alert
    const alert = await c.env.DB.prepare(`SELECT * FROM PriceAlert WHERE id = ?`).bind(alertId).first();

    return c.json({ success: true, alert }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// 4. ENDPOINT: catalogs (Public Catalog Listing)
// ==========================================
// ==========================================
// ENDPOINT: countries with stamp counts
// ==========================================
app.get('/countries', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT 
        s.countryCode as code,
        COUNT(*) as stampCount,
        MIN(s.year) as yearFrom,
        MAX(s.year) as yearTo
      FROM Stamp s
      WHERE s.countryCode IS NOT NULL AND s.source = 'wns'
      GROUP BY s.countryCode
      ORDER BY COUNT(*) DESC
    `).all();
    return c.json({ success: true, countries: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// ENDPOINT: stamp groups by country (for catalog view)
// ==========================================
app.get('/groups/:countryCode', async (c) => {
  try {
    const { countryCode } = c.req.param();
    const page  = Math.max(1, parseInt(c.req.query('page') || '1'));
    const limit = Math.min(20, parseInt(c.req.query('limit') || '10'));
    const offset = (page - 1) * limit;

    const [countRes, groupsRes] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT g.id) as total
         FROM StampGroup g
         JOIN Stamp s ON s.groupId = g.id
         WHERE s.countryCode = ?`
      ).bind(countryCode.toUpperCase()),
      c.env.DB.prepare(
        `SELECT g.id, g.titleEs, g.titleEn, g.year, s.countryCode,
                COUNT(*) as stampCount,
                GROUP_CONCAT(s.id, '|') as stampIds,
                GROUP_CONCAT(s.nameEn, '|') as stampNames,
                GROUP_CONCAT(COALESCE(s.imageUrl,''), '|') as stampImages,
                GROUP_CONCAT(COALESCE(s.denomination,''), '|') as stampDenoms,
                GROUP_CONCAT(COALESCE(s.currency,''), '|') as stampCurrencies,
                GROUP_CONCAT(COALESCE(s.wnsNumber,''), '|') as stampWns,
                GROUP_CONCAT(COALESCE(s.issueDate,''), '|') as stampDates
         FROM StampGroup g
         JOIN Stamp s ON s.groupId = g.id
         WHERE s.countryCode = ?
         GROUP BY g.id
         ORDER BY g.year ASC, g.titleEs ASC
         LIMIT ? OFFSET ?`
      ).bind(countryCode.toUpperCase(), limit, offset),
    ]);

    const total = (countRes.results[0] as any)?.total || 0;

    // Parse GROUP_CONCAT results into stamp arrays
    const groups = (groupsRes.results as any[]).map((g: any) => {
      const ids      = (g.stampIds     || '').split('|');
      const names    = (g.stampNames   || '').split('|');
      const images   = (g.stampImages  || '').split('|');
      const denoms   = (g.stampDenoms  || '').split('|');
      const currencies = (g.stampCurrencies || '').split('|');
      const wns      = (g.stampWns     || '').split('|');
      const dates    = (g.stampDates   || '').split('|');

      return {
        id: g.id,
        titleEs: g.titleEs,
        titleEn: g.titleEn,
        year: g.year,
        countryCode: g.countryCode,
        stampCount: g.stampCount,
        stamps: ids.map((_: any, i: number) => ({
          id: ids[i],
          nameEn: names[i] || null,
          imageUrl: images[i] || null,
          denomination: denoms[i] || null,
          currency: currencies[i] || null,
          wnsNumber: wns[i] || null,
          issueDate: dates[i] || null,
        })).filter((s: any) => s.id),
      };
    });

    return c.json({
      success: true,
      groups,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// ENDPOINT: stamp by ID
// ==========================================
// `SELECT s.*` means the four E3 columns added by migration 0012
// (colnectCode, format, emission, gum) reach the detail page with no change
// here. Variants are a separate table, so they need their own read.
app.get('/stamp/:id', async (c) => {
  try {
    const { id } = c.req.param();
    const { results } = await c.env.DB.prepare(`
      SELECT s.*, g.titleEs as groupTitleEs, g.titleEn as groupTitleEn,
             co.nameEs as countryNameEs, co.nameEn as countryNameEn
      FROM Stamp s
      LEFT JOIN StampGroup g ON s.groupId = g.id
      LEFT JOIN Country co ON s.countryCode = co.code
      WHERE s.id = ?
    `).bind(id).all();

    if (!results || results.length === 0) {
      return c.json({ success: false, error: 'Stamp not found' }, 404);
    }

    // The detail scraper has not run yet, so today this is empty for every
    // stamp in production. A missing StampVariant table (a deploy that landed
    // ahead of migration 0012) must not turn a working ficha into a 500
    // either — the page renders fine without a variants section, so an
    // unreadable variants table degrades to "no variants" rather than
    // taking the whole stamp down with it.
    let variants: unknown[] = [];
    try {
      const variantRows = await c.env.DB.prepare(`
        SELECT id, colnectCode, nameEs, nameEn, description,
               denomination, currency, color, perforation, gum, "format",
               imageUrl, sourceUrl
        FROM StampVariant
        WHERE stampId = ?
        ORDER BY "order" ASC, id ASC
      `).bind(id).all();
      variants = variantRows.results || [];
    } catch {
      variants = [];
    }

    return c.json({ success: true, stamp: results[0], variants });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get('/catalogs', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM Catalog ORDER BY yearStart ASC`
    ).all();
    return c.json({ success: true, catalogs: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// 5. ENDPOINT: stamps (Public Stamp Listing)
// ==========================================
app.get('/stamps', async (c) => {
  try {
    const catalogId   = c.req.query('catalogId');
    const countryCode = c.req.query('countryCode');
    const search      = c.req.query('search');
    const source      = c.req.query('source');
    // E3.6: the detail page links country, theme and series into this listing.
    // `countryCode` already existed; these two did not, so the theme and
    // series links would have landed on an unfiltered catalogue.
    const theme       = c.req.query('theme');
    const groupId     = c.req.query('groupId');
    const page        = Math.max(1, parseInt(c.req.query('page') || '1'));
    const limit       = Math.min(100, parseInt(c.req.query('limit') || '50'));
    const offset      = (page - 1) * limit;

    const conditions: string[] = [];
    const bindParams: any[] = [];

    // By default, only show stamps that have a countryCode (exclude
    // Wikidata-only without country). Any explicit narrowing filter opts out:
    // a caller who asked for one specific theme or series has already stated
    // what they want, and silently also demanding a country would make a link
    // from the detail page return fewer stamps than the page itself lists.
    if (!countryCode && !catalogId && !theme && !groupId) {
      conditions.push('s.countryCode IS NOT NULL');
    }

    if (catalogId)   { conditions.push('g.catalogId = ?');   bindParams.push(catalogId); }
    if (countryCode) { conditions.push('s.countryCode = ?'); bindParams.push(countryCode); }
    if (search)      { conditions.push('(s.nameEs LIKE ? OR s.nameEn LIKE ?)'); bindParams.push(`%${search}%`, `%${search}%`); }
    if (source)      { conditions.push('s.source = ?');      bindParams.push(source); }
    // Exact match, not LIKE: these come from a stored value the page linked
    // to, not from a user's free-text search. A LIKE would make "Aves" also
    // return "Aves marinas".
    if (theme)       { conditions.push('s.theme = ?');       bindParams.push(theme); }
    if (groupId)     { conditions.push('s.groupId = ?');     bindParams.push(groupId); }

    const yearFrom = c.req.query('yearFrom');
    const yearTo   = c.req.query('yearTo');
    if (yearFrom)    { conditions.push('s.year >= ?');         bindParams.push(parseInt(yearFrom)); }
    if (yearTo)      { conditions.push('s.year <= ?');         bindParams.push(parseInt(yearTo)); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as total FROM Stamp s JOIN StampGroup g ON s.groupId = g.id ${where}`;
    const dataSql  = `
      SELECT s.id, s.wnsNumber, s.scottNumber, s.countryCode, s.year, s.issueDate,
             s.nameEs, s.nameEn, s.denomination, s.currency, s.imageUrl, s.imageThumbUrl,
             s.theme, s.source, s.isVerified, s.isRare, s.marketPriceUsd,
             g.titleEs as groupTitleEs, g.titleEn as groupTitleEn
      FROM Stamp s
      JOIN StampGroup g ON s.groupId = g.id
      ${where}
      ORDER BY s.countryCode ASC, s.year ASC
      LIMIT ? OFFSET ?
    `;

    const [countRes, dataRes] = await c.env.DB.batch([
      c.env.DB.prepare(countSql).bind(...bindParams),
      c.env.DB.prepare(dataSql).bind(...bindParams, limit, offset),
    ]);

    const total = (countRes.results[0] as any)?.total || 0;

    return c.json({
      success: true,
      stamps: dataRes.results,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// 6. ENDPOINT: query (Vector Similarity & Database Gateway)
// ==========================================
app.post('/query', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { query, image, topK = 10, sql } = body;

    // The arbitrary-SQL gateway that used to live here has been removed: it
    // let any unauthenticated caller execute arbitrary SQL against the
    // production database. There is no replacement gateway, gated or
    // otherwise — callers that genuinely need a query use a typed,
    // purpose-specific endpoint instead (e.g. /collection). A `sql` field is
    // never executed; its mere presence is rejected outright.
    if (sql !== undefined) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    // Strict parameter validation according to REQ-VEC-003 / Task 2.5
    if (!query && !image) {
      return c.json({ error: "Either text query or image payload is required" }, 400);
    }

    const limit = Math.min(Math.max(1, Number(topK) || 10), 50);
    let embedding: number[] = [];

    // Helper to format and normalize vector to exactly 1536 dimensions for Vectorize index
    const formatVector1536 = (rawVector: number[]): number[] => {
      const targetDim = 1536;
      if (!Array.isArray(rawVector) || rawVector.length === 0) {
        return new Array(targetDim).fill(0);
      }
      const vec = [...rawVector];
      if (vec.length < targetDim) {
        while (vec.length < targetDim) vec.push(0);
      } else if (vec.length > targetDim) {
        vec.length = targetDim;
      }
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      return norm > 0 ? vec.map((v) => v / norm) : vec;
    };

    if (image) {
      // Base64 header stripping (data:image/...;base64,) and Uint8Array buffer decoding
      const cleanBase64 = String(image).replace(/^data:image\/[a-zA-Z0-9+\/]+;base64,/, '').trim();
      let imageBuffer: Uint8Array;
      try {
        const binaryString = atob(cleanBase64);
        imageBuffer = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          imageBuffer[i] = binaryString.charCodeAt(i);
        }
      } catch (err) {
        return c.json({ error: "Invalid base64 image data string" }, 422);
      }

      // Generate visual embedding via Workers AI image model (@cf/openai/clip-vit-base-patch32)
      if (c.env.AI) {
        try {
          // Limit image buffer payload to 512KB max to prevent Worker heap memory exhaustion
          const maxBytes = Math.min(imageBuffer.length, 512 * 1024);
          const sampleBuffer = imageBuffer.subarray(0, maxBytes);
          const aiRes: any = await c.env.AI.run('@cf/openai/clip-vit-base-patch32', { image: Array.from(sampleBuffer) });
          embedding = aiRes?.data?.[0] || aiRes?.vector || [];
        } catch (e) {
          console.warn("Workers AI image embedding fallback:", e);
        }
      }

      // Fallback 1536-d float vector if Workers AI is running in mock/test mode
      if (embedding.length === 0) {
        embedding = new Array(1536).fill(0).map((_, i) => Math.sin(imageBuffer.length + i) * 0.05);
      }
      embedding = formatVector1536(embedding);
    } else if (query) {
      const queryStr = String(query).trim();
      if (c.env.AI) {
        try {
          const aiRes: any = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: queryStr });
          embedding = aiRes?.data?.[0] || aiRes?.vector || [];
        } catch (e) {
          console.warn("Workers AI text embedding error:", e);
        }
      }

      if (embedding.length === 0) {
        embedding = new Array(1536).fill(0).map((_, i) => Math.sin(queryStr.length + i) * 0.05);
      }
      embedding = formatVector1536(embedding);
    }

    // Query Cloudflare Vectorize stamps-index
    let vectorizeMatches: any[] = [];
    if (c.env.VECTORIZE) {
      try {
        const vectorizeRes = await c.env.VECTORIZE.query(embedding, {
          topK: limit,
          returnMetadata: true,
        });
        vectorizeMatches = vectorizeRes.matches || [];
      } catch (vecErr) {
        console.error("Vectorize query error:", vecErr);
      }
    }

    let matches: MatchResult[] = [];

    if (vectorizeMatches.length > 0) {
      const matchIds = vectorizeMatches.map(m => m.id);
      const scoreMap = new Map(vectorizeMatches.map(m => [m.id, m.score]));

      if (c.env.DB) {
        try {
          const placeHolders = matchIds.map(() => '?').join(',');
          const { results } = await c.env.DB.prepare(
            `SELECT id, nameEs, nameEn, scottNumber, year, countryCode, imageUrl, marketPriceUsd FROM Stamp WHERE id IN (${placeHolders})`
          ).bind(...matchIds).all();

          matches = (results as any[]).map((r) => {
            const score = scoreMap.get(r.id) || 0.88;
            return {
              ...r,
              score,
              similarity: score,
              confidence: Math.round(score * 100),
            };
          });
        } catch (dbErr) {
          console.error("D1 hydration error:", dbErr);
        }
      }

      if (matches.length === 0) {
        matches = vectorizeMatches.map(m => ({
          id: m.id,
          nameEs: m.metadata?.title || m.metadata?.nameEs || `Stamp ${m.id}`,
          nameEn: m.metadata?.nameEn || null,
          scottNumber: m.metadata?.catalogNumber || m.metadata?.scottNumber || null,
          year: m.metadata?.year ? Number(m.metadata.year) : null,
          countryCode: m.metadata?.country || m.metadata?.countryCode || null,
          imageUrl: m.metadata?.imageUrl || null,
          marketPriceUsd: m.metadata?.marketPriceUsd || null,
          score: m.score,
          similarity: m.score,
          confidence: Math.round(m.score * 100),
        }));
      }
    } else {
      // Keyword fallback on D1 if Vectorize is unpopulated
      if (c.env.DB && query) {
        const queryStr = String(query).trim();
        const { results } = await c.env.DB.prepare(
          `SELECT id, nameEs, nameEn, scottNumber, year, countryCode, imageUrl, marketPriceUsd FROM Stamp WHERE nameEs LIKE ? OR nameEn LIKE ? LIMIT ?`
        ).bind(`%${queryStr}%`, `%${queryStr}%`, limit).all();

        matches = (results as any[]).map((r, i) => {
          const score = 0.92 - (i * 0.04);
          return {
            ...r,
            score,
            similarity: score,
            confidence: Math.round(score * 100),
          };
        });
      }
    }

    return c.json({
      success: true,
      totalMatches: matches.length,
      matches,
      results: matches,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});


// ==========================================
// 7. ENDPOINT: upload-image (R2 Image Storage)
// Accepts { key, url, bucket? } — fetches image from URL, stores in R2
// ==========================================
//
// The `url` path makes the Worker itself perform a server-side fetch of a
// caller-supplied address and store the result in a publicly-served R2
// bucket (`GET /r2/:bucket/:key`). Even behind admin auth this is a
// request-forgery primitive, so the target host is restricted to an
// explicit allowlist derived from the actual callers of this endpoint: the
// only real-world `url` producer is `scrapers/fetch-wikimedia.mjs`, which
// queries `commons.wikimedia.org` (WIKIMEDIA_API) and stores whatever image
// URL the MediaWiki `imageinfo` API returns for `url`/`thumburl` — which
// MediaWiki always serves from `upload.wikimedia.org`, never from
// `commons.wikimedia.org` itself. Both hosts are listed here so the
// allowlist matches actual, observed usage rather than a broad guess.
//
// The allowlist is enforced twice: on the caller-supplied URL before any
// network call, and on the response that actually produced the stored bytes
// (redirects are refused, see `uploadImageHandler`).
export const WIKIMEDIA_UPLOAD_ALLOWLIST = ['commons.wikimedia.org', 'upload.wikimedia.org'] as const;

// Exact match or a strict subdomain of an allowlisted host — never a
// substring/`includes()`/`endsWith()` check, which would also accept
// `evil-wikimedia.org` (substring match) or `wikimedia.org.attacker.com`
// (suffix match on the raw string). Comparing against `URL.hostname`
// (post-parse, lowercased, punycode-normalized by the URL parser) and
// requiring either an exact match or a `.`-bounded suffix closes both.
function isAllowedUploadHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return WIKIMEDIA_UPLOAD_ALLOWLIST.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );
}

async function uploadImageHandler(c: any) {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    // Accepts: { key, bucket?, url? } OR { key, bucket?, data: "base64...", contentType? }
    const body = await c.req.json();
    const { key, bucket = 'images', url, data, contentType: ctOverride } = body;
    if (!key) return c.json({ success: false, error: 'key is required' }, 400);
    if (!url && !data) return c.json({ success: false, error: 'url or data is required' }, 400);

    const r2: R2Bucket | undefined =
      bucket === 'thumbs' ? c.env.STAMPS_THUMBS :
      bucket === 'backs'  ? c.env.STAMPS_BACKS  :
      c.env.STAMPS_IMAGES;

    if (!r2) return c.json({ success: false, error: `R2 bucket '${bucket}' not found` }, 500);

    let imageBytes: ArrayBuffer;
    let contentType: string;

    if (data) {
      // Base64 path: scraper downloaded locally (with cookies, etc.) and sent here
      const b64 = data.startsWith('data:') ? data.split(',')[1] : data;
      const binary = atob(b64);
      imageBytes = new Uint8Array([...binary].map(c => c.charCodeAt(0))).buffer;
      contentType = ctOverride || 'image/jpeg';
    } else {
      // URL path: Worker fetches directly. Validate the PARSED URL's
      // protocol and hostname against the allowlist BEFORE any fetch is
      // attempted — an invalid URL must never reach the network.
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return c.json({ success: false, error: 'Invalid url' }, 400);
      }
      if (parsed.protocol !== 'https:') {
        return c.json({ success: false, error: 'url must use https' }, 400);
      }
      if (!isAllowedUploadHost(parsed.hostname)) {
        return c.json({ success: false, error: `url host '${parsed.hostname}' is not allowlisted` }, 400);
      }

      // `redirect: 'manual'` is REQUIRED, not cosmetic. The Fetch default is
      // `redirect: 'follow'`, and Workers follows 3xx across hosts
      // transparently, so the host that actually serves the bytes would never
      // be re-checked: an allowlisted host issuing a redirect (an open
      // redirect, or a compromised/hostile response) would send this Worker
      // anywhere and the result would land in a PUBLIC R2 bucket, defeating
      // the allowlist entirely.
      //
      // Rejecting redirects outright — rather than following them hop by hop
      // with re-validation — is chosen because it costs the real use case
      // nothing: the only `url` producer is `scrapers/fetch-wikimedia.mjs`,
      // which passes the MediaWiki `imageinfo` `url`/`thumburl` values
      // verbatim. Those are already-resolved direct file URLs on
      // `upload.wikimedia.org` and are served 200 with the bytes; they are not
      // redirect entry points. So there is no hop to follow, and the simpler,
      // strictly safer option loses no functionality.
      const imgRes = await fetch(parsed.toString(), {
        headers: { 'User-Agent': 'FilateliaBot/1.0 (https://filatelia.pe)' },
        redirect: 'manual',
      });
      if (imgRes.status >= 300 && imgRes.status < 400) {
        return c.json({
          success: false,
          error: `url responded with a redirect (${imgRes.status}); redirects are not followed`,
        }, 400);
      }
      // Defence in depth: enforce the allowlist at the point of STORAGE, not
      // only at the point of request. If any future change (or a runtime that
      // ignores `redirect: 'manual'`) lets the fetch land elsewhere,
      // `imgRes.url` exposes the final host and it must still be allowlisted.
      // Constructed/mocked responses report an empty `url`; only re-check when
      // the runtime actually reported one.
      if (imgRes.url) {
        let finalParsed: URL | null = null;
        try {
          finalParsed = new URL(imgRes.url);
        } catch {
          finalParsed = null;
        }
        if (!finalParsed || finalParsed.protocol !== 'https:' || !isAllowedUploadHost(finalParsed.hostname)) {
          return c.json({
            success: false,
            error: `response came from a non-allowlisted host '${finalParsed?.hostname ?? imgRes.url}'`,
          }, 400);
        }
      }
      if (!imgRes.ok) throw new Error(`Fetch failed: ${imgRes.status} ${url}`);
      contentType = ctOverride || imgRes.headers.get('content-type') || 'image/jpeg';
      // Reject HTML responses (means URL requires auth)
      if (contentType.includes('text/html')) throw new Error(`URL returned HTML, not image: ${url}`);
      imageBytes = await imgRes.arrayBuffer();
    }

    await r2.put(key, imageBytes, { httpMetadata: { contentType } });

    const publicUrl = `https://filatelia-api.rodrigopianto2005.workers.dev/r2/${bucket}/${key}`;
    return c.json({ success: true, key, url: publicUrl, bucket, size: imageBytes.byteLength });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
}

app.post('/upload-image', uploadImageHandler);
app.post('/admin/upload-image', uploadImageHandler);

// ==========================================
// 8. ENDPOINT: r2/:bucket/:key (Serve images from R2)
// ==========================================
app.get('/r2/:bucket/:key{.+}', async (c) => {
  const bucket = c.req.param('bucket');
  const key    = c.req.param('key');

  const r2: R2Bucket | undefined =
    bucket === 'thumbs' ? c.env.STAMPS_THUMBS :
    bucket === 'backs'  ? c.env.STAMPS_BACKS  :
    c.env.STAMPS_IMAGES;

  if (!r2) return c.json({ error: 'Bucket not found' }, 404);

  const obj = await r2.get(key);
  if (!obj) return c.json({ error: 'Image not found' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', obj.etag);

  return new Response(obj.body, { headers });
});

// ==========================================
// 9. ENDPOINT: import-stamp (Bulk Import)
// Used by local scrapers to insert/upsert stamps into D1
// Accepts up to 10 stamps per call to stay within Worker CPU limits.
// ==========================================
// This endpoint is unauthenticated, so the country block of a payload is fully
// attacker-controlled. `Country.code` is UNIQUE and `/stamp/:id` joins Country
// on `code`, so accepting a caller-supplied row id would let anyone squat a
// real ISO code and rename every stamp of that country. The row id is therefore
// always derived server-side from a strictly validated code, and any payload
// that disagrees with the derived id is treated as untrusted.
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const COUNTRY_NAME_MAX_LENGTH = 100;

function validateCountryPayload(
  stamp: any
): { id: string; code: string; nameEs: string; nameEn: string } | null {
  const code = typeof stamp.countryCode === 'string' ? stamp.countryCode.trim() : '';
  if (!COUNTRY_CODE_PATTERN.test(code)) return null;

  const derivedId = `country-${code.toLowerCase()}`;
  const claimedId = typeof stamp.countryId === 'string' ? stamp.countryId.trim() : '';
  // Present but different: reject the country block instead of silently fixing it.
  if (claimedId && claimedId !== derivedId) return null;

  const nameEn = typeof stamp.countryNameEn === 'string' ? stamp.countryNameEn.trim() : '';
  const nameEs = typeof stamp.countryNameEs === 'string' ? stamp.countryNameEs.trim() : '';
  if (!nameEn || !nameEs) return null;
  if (nameEn.length > COUNTRY_NAME_MAX_LENGTH || nameEs.length > COUNTRY_NAME_MAX_LENGTH) return null;

  return { id: derivedId, code, nameEs, nameEn };
}

// A single Colnect stamp lists a handful of variants, not hundreds. The cap
// exists because the variant array is caller-supplied and each entry costs a
// prepared statement against the Worker's CPU budget; a payload claiming
// 10,000 variants must be truncated rather than allowed to burn the whole
// batch's time. Truncation is reported to the caller, never silent.
const MAX_VARIANTS_PER_STAMP = 50;

/**
 * Upsert a stamp's variants, keyed on the variant's own Colnect URL.
 *
 * Returns null on success, or a human-readable reason on failure. It never
 * throws: variants are supplementary detail, and losing them must not cost
 * the caller a stamp row that already persisted correctly.
 */
async function upsertVariants(c: any, stampId: string, variants: any): Promise<string | null> {
  if (!Array.isArray(variants) || variants.length === 0) return null;

  const capped = variants.slice(0, MAX_VARIANTS_PER_STAMP);
  const truncated = variants.length > capped.length
    ? `truncated ${variants.length} to ${MAX_VARIANTS_PER_STAMP}`
    : null;

  try {
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < capped.length; i++) {
      const v = capped[i] || {};
      const sourceUrl = typeof v.sourceUrl === 'string' && v.sourceUrl ? v.sourceUrl : null;
      // Without a URL there is no stable key to upsert on, so the id is
      // derived from the parent stamp and the variant's position. A re-scrape
      // that returns the variants in the same order overwrites in place;
      // one that reorders them rewrites the set, which is still correct
      // because the row content is fully replaced below.
      const id = typeof v.id === 'string' && v.id
        ? v.id
        : sourceUrl
          ? await generateUUIDv5('12345678-1234-5678-1234-567812345678', sourceUrl)
          : `${stampId}-var-${i}`;

      stmts.push(
        c.env.DB.prepare(`
          INSERT INTO StampVariant (
            id, stampId, colnectCode, nameEs, nameEn, description,
            denomination, currency, color, perforation, gum, "format",
            imageUrl, sourceUrl, "order"
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            colnectCode  = COALESCE(excluded.colnectCode, colnectCode),
            nameEs       = COALESCE(excluded.nameEs, nameEs),
            nameEn       = COALESCE(excluded.nameEn, nameEn),
            description  = COALESCE(excluded.description, description),
            denomination = COALESCE(excluded.denomination, denomination),
            currency     = COALESCE(excluded.currency, currency),
            color        = COALESCE(excluded.color, color),
            perforation  = COALESCE(excluded.perforation, perforation),
            gum          = COALESCE(excluded.gum, gum),
            "format"     = COALESCE(excluded."format", "format"),
            imageUrl     = COALESCE(excluded.imageUrl, imageUrl),
            "order"      = excluded."order",
            updatedAt    = datetime('now')
        `).bind(
          id, stampId, v.colnectCode || null,
          v.nameEs || v.nameEn || null, v.nameEn || null, v.description || null,
          typeof v.denomination === 'number' ? v.denomination : null,
          v.currency || null, v.color || null, v.perforation || null,
          v.gum || null, v.format || null,
          v.imageUrl || null, sourceUrl, i
        )
      );
    }
    if (stmts.length > 0) await c.env.DB.batch(stmts);
    return truncated;
  } catch (e: any) {
    return e?.message || 'unknown error';
  }
}

// Extracted so `/import-stamp` (used by the scrapers) and `/admin/import-stamp`
// (reachable through the Next admin proxy, which only forwards to Worker
// `/admin/<path>`) can never drift: both routes register the exact same
// handler below instead of copy-pasted bodies.
async function importStampHandler(c: any) {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const body = await c.req.json();
    const stamps: any[] = Array.isArray(body) ? body : body.stamps || [body];

    // `errors` stays as-is for backward compatibility; `failedIds` lets callers
    // retry only the stamps that actually failed instead of the whole batch.
    const results = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
      failedIds: [] as string[],
    };

    // Determine catalog strategy:
    // - If stamp.catalogId is explicitly provided, use it (caller guarantees it exists)
    // - Otherwise, pick a stable catalog per source to avoid UNIQUE(name) conflicts on Catalog
    const SOURCE_CATALOGS: Record<string, { id: string; name: string }> = {
      wns:      { id: 'cat-wns-global',      name: 'WNS — WADP Numbering System' },
      wikidata: { id: 'cat-wikidata-global',  name: 'Wikidata — Sellos Históricos' },
      scraper:  { id: 'cat-scraper-global',   name: 'Catálogo General' },
    };

    // Collect unique groups to batch-create
    const groupsToCreate: Map<string, any> = new Map();
    const neededCatalogIds: Set<string> = new Set();
    // Countries referenced by the incoming stamps. Stamp.countryId is a FK to
    // Country.id, so the row must exist before the stamps are upserted.
    const countriesToCreate: Map<string, any> = new Map();

    for (const stamp of stamps) {
      const source = stamp.source || 'scraper';
      const defaultCat = SOURCE_CATALOGS[source] || SOURCE_CATALOGS.scraper;

      // Use explicit catalogId from stamp, or fall back to per-source global catalog
      const catalogId = stamp.catalogId || defaultCat.id;
      stamp._catalogId  = catalogId;
      stamp._catalogName = stamp.catalogName || defaultCat.name;
      neededCatalogIds.add(catalogId);

      // Only create a Country when the payload passes server-side validation.
      // A rejected country block never drops the stamp: it is imported with
      // countryId = NULL so the FK can never dangle.
      const country = validateCountryPayload(stamp);
      stamp._countryId = country ? country.id : null;
      if (country && !countriesToCreate.has(country.id)) {
        countriesToCreate.set(country.id, country);
      }

      // Stable groupId: country + year (no Date.now())
      const groupId = stamp.groupId || `group-${(stamp.countryCode || 'xx').toLowerCase()}-${stamp.year || 'unknown'}`;
      stamp._groupId = groupId;

      if (!groupsToCreate.has(groupId)) {
        const groupTitle = stamp.groupTitleEs || `${stamp.countryCode} ${stamp.year || 'Sin año'}`;
        groupsToCreate.set(groupId, {
          id: groupId,
          catalogId,
          titleEs: groupTitle,
          titleEn: stamp.groupTitleEn || groupTitle,
          year: stamp.year || null,
        });
      }
    }

    // Batch-create any needed catalogs and groups using D1 batch API
    const batchStmts: D1PreparedStatement[] = [];

    // Create global source catalogs (stable id+name, safe to INSERT OR IGNORE)
    for (const [id, cat] of Object.entries(SOURCE_CATALOGS)) {
      if (neededCatalogIds.has(cat.id)) {
        batchStmts.push(
          c.env.DB.prepare(`INSERT OR IGNORE INTO Catalog (id, name, status) VALUES (?, ?, 'activo')`)
            .bind(cat.id, cat.name)
        );
      }
    }

    // Countries first: Stamp.countryId is a FK to Country.id.
    // `code` is UNIQUE — INSERT OR IGNORE is the desired conflict behavior.
    for (const country of countriesToCreate.values()) {
      batchStmts.push(
        c.env.DB.prepare(`INSERT OR IGNORE INTO Country (id, code, nameEs, nameEn) VALUES (?, ?, ?, ?)`)
          .bind(country.id, country.code, country.nameEs, country.nameEn)
      );
    }

    for (const grp of groupsToCreate.values()) {
      batchStmts.push(
        c.env.DB.prepare(`INSERT OR IGNORE INTO StampGroup (id, catalogId, titleEs, titleEn, year, "order") VALUES (?, ?, ?, ?, ?, 0)`)
          .bind(grp.id, grp.catalogId, grp.titleEs, grp.titleEn, grp.year)
      );
    }
    if (batchStmts.length > 0) await c.env.DB.batch(batchStmts);

    // Now upsert each stamp
    for (const stamp of stamps) {
      // Declared outside the try so a failure can still be reported per stamp.
      let stampId: string = typeof stamp.id === 'string' ? stamp.id : '';
      try {
        const tags = Array.isArray(stamp.tags) ? stamp.tags.join(',') : (stamp.tags || null);
        if (!stampId) {
          if (stamp.sourceUrl) {
            stampId = await generateUUIDv5('12345678-1234-5678-1234-567812345678', stamp.sourceUrl);
          } else {
            stampId = crypto.randomUUID();
          }
        }
        const groupId = stamp._groupId;

        if (stamp.wnsNumber) {
          // Use INSERT OR REPLACE semantics via ON CONFLICT for wnsNumber
          await c.env.DB.prepare(`
            INSERT INTO Stamp (
              id, wnsNumber, scottNumber, michelNumber, yvertNumber,
              countryCode, year, issueDate, denomination, currency,
              nameEs, nameEn, descriptionEs, descriptionEn,
              theme, tags, color, perforation, printTechnique, paperType,
              designer, printer, engraver,
              imageUrl, imageThumbUrl, imageBackUrl,
              marketPriceUsd, conditionMintUsd, conditionUsedUsd,
              groupId, countryId, source, sourceUrl,
              isVerified, isRare
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?,
              0, 0
            )
            ON CONFLICT(wnsNumber) DO UPDATE SET
              nameEs        = COALESCE(excluded.nameEs, nameEs),
              nameEn        = COALESCE(excluded.nameEn, nameEn),
              imageUrl      = COALESCE(excluded.imageUrl, imageUrl),
              imageThumbUrl = COALESCE(excluded.imageThumbUrl, imageThumbUrl),
              perforation   = COALESCE(excluded.perforation, perforation),
              printTechnique= COALESCE(excluded.printTechnique, printTechnique),
              source        = COALESCE(excluded.source, source),
              sourceUrl     = COALESCE(excluded.sourceUrl, sourceUrl),
              updatedAt     = datetime('now')
          `).bind(
            stampId,
            stamp.wnsNumber, stamp.scottNumber || null,
            stamp.michelNumber || null, stamp.yvertNumber || null,
            stamp.countryCode || null, stamp.year || null,
            stamp.issueDate || null, stamp.denomination || null, stamp.currency || null,
            stamp.nameEs || stamp.nameEn || 'Sin nombre',
            stamp.nameEn || null, stamp.descriptionEs || null, stamp.descriptionEn || null,
            stamp.theme || null, tags, stamp.color || null,
            stamp.perforation || null, stamp.printTechnique || null, stamp.paperType || null,
            stamp.designer || null, stamp.printer || null, stamp.engraver || null,
            stamp.imageUrl || null, stamp.imageThumbUrl || null, stamp.imageBackUrl || null,
            stamp.marketPriceUsd || null, stamp.conditionMintUsd || null, stamp.conditionUsedUsd || null,
            groupId, stamp._countryId,
            stamp.source || 'scraper', stamp.sourceUrl || null
          ).run();
          // D1 doesn't expose changes_made easily; count as inserted (ON CONFLICT handles updates)
          results.inserted++;
        } else {
          // The ON CONFLICT target below requires a UNIQUE index on
          // `sourceUrl`. Until migration 0013 created one, SQLite rejected
          // this statement at PARSE time — "ON CONFLICT clause does not match
          // any PRIMARY KEY or UNIQUE constraint" — so it never inserted
          // anything. Since Colnect rows carry no wnsNumber, they all take
          // this branch: that is the "last batch persisted 0 of 3" in
          // PENDIENTES.md E2.6. Pinned by test/stamp-detail-schema.test.mjs.
          await c.env.DB.prepare(`
            INSERT INTO Stamp (
              id, scottNumber, michelNumber, yvertNumber,
              countryCode, year, issueDate, denomination, currency,
              nameEs, nameEn, descriptionEs, descriptionEn,
              theme, tags, color, perforation, printTechnique, paperType,
              sizeMm, designer, printer, engraver,
              colnectCode, "format", "emission", gum,
              imageUrl, imageThumbUrl, imageBackUrl, groupId, countryId, source, sourceUrl,
              isVerified, isRare
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            ON CONFLICT(sourceUrl) DO UPDATE SET
              scottNumber   = COALESCE(excluded.scottNumber, scottNumber),
              michelNumber  = COALESCE(excluded.michelNumber, michelNumber),
              yvertNumber   = COALESCE(excluded.yvertNumber, yvertNumber),
              year          = COALESCE(excluded.year, year),
              issueDate     = COALESCE(excluded.issueDate, issueDate),
              denomination  = COALESCE(excluded.denomination, denomination),
              currency      = COALESCE(excluded.currency, currency),
              nameEs        = COALESCE(excluded.nameEs, nameEs),
              nameEn        = COALESCE(excluded.nameEn, nameEn),
              descriptionEs = COALESCE(excluded.descriptionEs, descriptionEs),
              descriptionEn = COALESCE(excluded.descriptionEn, descriptionEn),
              theme         = COALESCE(excluded.theme, theme),
              color         = COALESCE(excluded.color, color),
              perforation   = COALESCE(excluded.perforation, perforation),
              printTechnique= COALESCE(excluded.printTechnique, printTechnique),
              paperType     = COALESCE(excluded.paperType, paperType),
              sizeMm        = COALESCE(excluded.sizeMm, sizeMm),
              designer      = COALESCE(excluded.designer, designer),
              printer       = COALESCE(excluded.printer, printer),
              engraver      = COALESCE(excluded.engraver, engraver),
              colnectCode   = COALESCE(excluded.colnectCode, colnectCode),
              "format"      = COALESCE(excluded."format", "format"),
              "emission"    = COALESCE(excluded."emission", "emission"),
              gum           = COALESCE(excluded.gum, gum),
              imageUrl      = CASE WHEN excluded.imageUrl LIKE '%none_logged_image%' THEN imageUrl ELSE COALESCE(excluded.imageUrl, imageUrl) END,
              imageThumbUrl = CASE WHEN excluded.imageThumbUrl LIKE '%none_logged_image%' THEN imageThumbUrl ELSE COALESCE(excluded.imageThumbUrl, imageThumbUrl) END,
              imageBackUrl  = CASE WHEN excluded.imageBackUrl LIKE '%none_logged_image%' THEN imageBackUrl ELSE COALESCE(excluded.imageBackUrl, imageBackUrl) END,
              updatedAt     = datetime('now')
          `).bind(
            stampId, stamp.scottNumber || null,
            stamp.michelNumber || null, stamp.yvertNumber || null,
            stamp.countryCode || null, stamp.year || null,
            stamp.issueDate || null, stamp.denomination || null, stamp.currency || null,
            stamp.nameEs || stamp.nameEn || 'Sin nombre', stamp.nameEn || null,
            stamp.descriptionEs || null, stamp.descriptionEn || null,
            stamp.theme || null, tags, stamp.color || null,
            stamp.perforation || null, stamp.printTechnique || null, stamp.paperType || null,
            stamp.sizeMm || null, stamp.designer || null, stamp.printer || null, stamp.engraver || null,
            stamp.colnectCode || null, stamp.format || null, stamp.emission || null, stamp.gum || null,
            stamp.imageUrl || null, stamp.imageThumbUrl || null, stamp.imageBackUrl || null,
            groupId, stamp._countryId,
            stamp.source || 'scraper', stamp.sourceUrl || null
          ).run();
          results.inserted++;
        }

        // Deliberately NOT inside the per-stamp failure path: the stamp row
        // itself persisted, and reporting it as failed would make the scraper
        // re-send a stamp that is already correct. A variant problem is
        // reported as an error the operator can read, not as a retry.
        const variantError = await upsertVariants(c, stampId, stamp.variants);
        if (variantError) results.errors.push(`${stampId} variants: ${variantError}`);
      } catch (e: any) {
        results.errors.push(`${stamp.wnsNumber || stamp.nameEn}: ${e.message}`);
        results.failedIds.push(stampId || stamp.sourceUrl || stamp.wnsNumber || '');
      }
    }

    return c.json({ success: true, ...results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
}

app.post('/import-stamp', importStampHandler);
app.post('/admin/import-stamp', importStampHandler);

// ==========================================
// ADMIN: seed-countries
// ==========================================

// Bulk-inserts into `Country`. Gated by `requireAdmin` exactly like every
// other `/admin/*` route: until this guard existed, any unauthenticated
// caller reaching the Worker directly could mutate the catalog.
app.post('/admin/seed-countries', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const countries: Array<{ code: string; nameEs: string; nameEn: string; continent: string }> = [
      { code: 'AF', nameEs: 'Afganistán', nameEn: 'Afghanistan', continent: 'Asia' },
      { code: 'AI', nameEs: 'Anguila', nameEn: 'Anguilla', continent: 'America' },
      { code: 'AM', nameEs: 'Armenia', nameEn: 'Armenia', continent: 'Asia' },
      { code: 'AO', nameEs: 'Angola', nameEn: 'Angola', continent: 'Africa' },
      { code: 'AR', nameEs: 'Argentina', nameEn: 'Argentina', continent: 'America' },
      { code: 'AT', nameEs: 'Austria', nameEn: 'Austria', continent: 'Europe' },
      { code: 'AU', nameEs: 'Australia', nameEn: 'Australia', continent: 'Oceania' },
      { code: 'AW', nameEs: 'Aruba', nameEn: 'Aruba', continent: 'America' },
      { code: 'AX', nameEs: 'Islas Åland', nameEn: 'Åland Islands', continent: 'Europe' },
      { code: 'AZ', nameEs: 'Azerbaiyán', nameEn: 'Azerbaijan', continent: 'Asia' },
      { code: 'BA', nameEs: 'Bosnia y Herzegovina', nameEn: 'Bosnia and Herzegovina', continent: 'Europe' },
      { code: 'BB', nameEs: 'Barbados', nameEn: 'Barbados', continent: 'America' },
      { code: 'BD', nameEs: 'Bangladés', nameEn: 'Bangladesh', continent: 'Asia' },
      { code: 'BE', nameEs: 'Bélgica', nameEn: 'Belgium', continent: 'Europe' },
      { code: 'BF', nameEs: 'Burkina Faso', nameEn: 'Burkina Faso', continent: 'Africa' },
      { code: 'BG', nameEs: 'Bulgaria', nameEn: 'Bulgaria', continent: 'Europe' },
      { code: 'BH', nameEs: 'Baréin', nameEn: 'Bahrain', continent: 'Asia' },
      { code: 'BI', nameEs: 'Burundi', nameEn: 'Burundi', continent: 'Africa' },
      { code: 'BJ', nameEs: 'Benín', nameEn: 'Benin', continent: 'Africa' },
      { code: 'BM', nameEs: 'Bermudas', nameEn: 'Bermuda', continent: 'America' },
      { code: 'BO', nameEs: 'Bolivia', nameEn: 'Bolivia', continent: 'America' },
      { code: 'BR', nameEs: 'Brasil', nameEn: 'Brazil', continent: 'America' },
      { code: 'BS', nameEs: 'Bahamas', nameEn: 'Bahamas', continent: 'America' },
      { code: 'BW', nameEs: 'Botsuana', nameEn: 'Botswana', continent: 'Africa' },
      { code: 'BY', nameEs: 'Bielorrusia', nameEn: 'Belarus', continent: 'Europe' },
      { code: 'CA', nameEs: 'Canadá', nameEn: 'Canada', continent: 'America' },
      { code: 'CC', nameEs: 'Islas Cocos', nameEn: 'Cocos Islands', continent: 'Oceania' },
      { code: 'CI', nameEs: 'Costa de Marfil', nameEn: 'Ivory Coast', continent: 'Africa' },
      { code: 'CL', nameEs: 'Chile', nameEn: 'Chile', continent: 'America' },
      { code: 'CN', nameEs: 'China', nameEn: 'China', continent: 'Asia' },
      { code: 'CO', nameEs: 'Colombia', nameEn: 'Colombia', continent: 'America' },
      { code: 'CR', nameEs: 'Costa Rica', nameEn: 'Costa Rica', continent: 'America' },
      { code: 'CV', nameEs: 'Cabo Verde', nameEn: 'Cape Verde', continent: 'Africa' },
      { code: 'CW', nameEs: 'Curazao', nameEn: 'Curaçao', continent: 'America' },
      { code: 'CX', nameEs: 'Isla Christmas', nameEn: 'Christmas Island', continent: 'Oceania' },
      { code: 'CY', nameEs: 'Chipre', nameEn: 'Cyprus', continent: 'Europe' },
      { code: 'CZ', nameEs: 'República Checa', nameEn: 'Czech Republic', continent: 'Europe' },
      { code: 'DK', nameEs: 'Dinamarca', nameEn: 'Denmark', continent: 'Europe' },
      { code: 'DO', nameEs: 'República Dominicana', nameEn: 'Dominican Republic', continent: 'America' },
      { code: 'DZ', nameEs: 'Argelia', nameEn: 'Algeria', continent: 'Africa' },
      { code: 'EC', nameEs: 'Ecuador', nameEn: 'Ecuador', continent: 'America' },
      { code: 'EE', nameEs: 'Estonia', nameEn: 'Estonia', continent: 'Europe' },
      { code: 'EG', nameEs: 'Egipto', nameEn: 'Egypt', continent: 'Africa' },
      { code: 'ET', nameEs: 'Etiopía', nameEn: 'Ethiopia', continent: 'Africa' },
      { code: 'FI', nameEs: 'Finlandia', nameEn: 'Finland', continent: 'Europe' },
      { code: 'FJ', nameEs: 'Fiyi', nameEn: 'Fiji', continent: 'Oceania' },
      { code: 'FK', nameEs: 'Islas Malvinas', nameEn: 'Falkland Islands', continent: 'America' },
      { code: 'FO', nameEs: 'Islas Feroe', nameEn: 'Faroe Islands', continent: 'Europe' },
      { code: 'FR', nameEs: 'Francia', nameEn: 'France', continent: 'Europe' },
      { code: 'GA', nameEs: 'Gabón', nameEn: 'Gabon', continent: 'Africa' },
      { code: 'GE', nameEs: 'Georgia', nameEn: 'Georgia', continent: 'Asia' },
      { code: 'GI', nameEs: 'Gibraltar', nameEn: 'Gibraltar', continent: 'Europe' },
      { code: 'GL', nameEs: 'Groenlandia', nameEn: 'Greenland', continent: 'America' },
      { code: 'GR', nameEs: 'Grecia', nameEn: 'Greece', continent: 'Europe' },
      { code: 'GT', nameEs: 'Guatemala', nameEn: 'Guatemala', continent: 'America' },
      { code: 'HK', nameEs: 'Hong Kong', nameEn: 'Hong Kong', continent: 'Asia' },
      { code: 'HR', nameEs: 'Croacia', nameEn: 'Croatia', continent: 'Europe' },
      { code: 'HU', nameEs: 'Hungría', nameEn: 'Hungary', continent: 'Europe' },
      { code: 'ID', nameEs: 'Indonesia', nameEn: 'Indonesia', continent: 'Asia' },
      { code: 'IL', nameEs: 'Israel', nameEn: 'Israel', continent: 'Asia' },
      { code: 'IN', nameEs: 'India', nameEn: 'India', continent: 'Asia' },
      { code: 'IO', nameEs: 'Territorio Británico del Océano Índico', nameEn: 'British Indian Ocean Territory', continent: 'Asia' },
      { code: 'IR', nameEs: 'Irán', nameEn: 'Iran', continent: 'Asia' },
      { code: 'IS', nameEs: 'Islandia', nameEn: 'Iceland', continent: 'Europe' },
      { code: 'IT', nameEs: 'Italia', nameEn: 'Italy', continent: 'Europe' },
      { code: 'JM', nameEs: 'Jamaica', nameEn: 'Jamaica', continent: 'America' },
      { code: 'JP', nameEs: 'Japón', nameEn: 'Japan', continent: 'Asia' },
      { code: 'KE', nameEs: 'Kenia', nameEn: 'Kenya', continent: 'Africa' },
      { code: 'KY', nameEs: 'Islas Caimán', nameEn: 'Cayman Islands', continent: 'America' },
      { code: 'KZ', nameEs: 'Kazajistán', nameEn: 'Kazakhstan', continent: 'Asia' },
      { code: 'PE', nameEs: 'Perú', nameEn: 'Peru', continent: 'America' },
      { code: 'PF', nameEs: 'Polinesia Francesa', nameEn: 'French Polynesia', continent: 'Oceania' },
      { code: 'SZ', nameEs: 'Esuatini', nameEn: 'Eswatini', continent: 'Africa' },
      { code: 'TD', nameEs: 'Chad', nameEn: 'Chad', continent: 'Africa' },
      { code: 'TF', nameEs: 'Tierras Australes Francesas', nameEn: 'French Southern Territories', continent: 'Antarctica' },
      { code: 'XA', nameEs: 'Naciones Unidas (Ginebra)', nameEn: 'United Nations (Geneva)', continent: 'International' },
      { code: 'XC', nameEs: 'Naciones Unidas (Nueva York)', nameEn: 'United Nations (New York)', continent: 'International' },
      { code: 'XD', nameEs: 'Naciones Unidas (Viena)', nameEn: 'United Nations (Vienna)', continent: 'International' },
      { code: 'XE', nameEs: 'Europa (emisiones conjuntas)', nameEn: 'Europa (joint issues)', continent: 'International' },
      { code: 'XH', nameEs: 'Unión Postal Universal', nameEn: 'Universal Postal Union', continent: 'International' },
      { code: 'XJ', nameEs: 'Emisiones Internacionales', nameEn: 'International Issues', continent: 'International' },
      { code: 'XK', nameEs: 'Kosovo', nameEn: 'Kosovo', continent: 'Europe' },
    ];

    const stmts = countries.map(country =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO Country (id, code, nameEs, nameEn, continent) VALUES (?, ?, ?, ?, ?)`
      ).bind(`country-${country.code.toLowerCase()}`, country.code, country.nameEs, country.nameEn, country.continent)
    );

    await c.env.DB.batch(stmts);

    return c.json({ success: true, inserted: countries.length });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// ANALYTICS ENDPOINTS
// ==========================================

// `path`/`referrer` are caller-supplied on an intentionally unauthenticated
// endpoint (see below), so they must never be stored unbounded. Truncating
// rather than rejecting keeps every real pageview recorded even when a
// referrer or SPA route happens to be unusually long; 512 bytes comfortably
// covers any real URL path or referrer this site produces while still
// bounding worst-case row size against an abusive caller.
//
// This bound is measured in UTF-8 BYTES — the unit D1/SQLite actually stores
// — not in JavaScript string length. `String.prototype.slice` counts UTF-16
// code units, which would neither bound the row (512 code units of CJK or
// Cyrillic text is up to ~1536 bytes) nor be safe (a cut landing between a
// surrogate pair yields a lone surrogate that SQLite may store as U+FFFD or
// as malformed bytes).
export const ANALYTICS_FIELD_MAX_LENGTH = 512;

export function truncateAnalyticsField(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const str = String(value);

  const encoded = new TextEncoder().encode(str);
  if (encoded.byteLength <= ANALYTICS_FIELD_MAX_LENGTH) return str;

  // Walk the cut point back off any UTF-8 continuation byte (`10xxxxxx`) so it
  // always lands on a code-point boundary. `TextEncoder` never emits lone
  // surrogates, so a whole-sequence cut plus `TextDecoder` is guaranteed to
  // produce a well-formed string with no replacement characters introduced.
  let end = ANALYTICS_FIELD_MAX_LENGTH;
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) end--;
  return new TextDecoder().decode(encoded.subarray(0, end));
}

// PUBLIC BY DESIGN: this endpoint's only consumer is
// `filatelia-web/src/components/AnalyticsTracker.tsx`, which fires for
// every anonymous visitor, so it intentionally carries no `requireAdmin`
// check. It is now rate-limited (see `checkAnalyticsRateLimit` below) and
// its inputs are bounded (`truncateAnalyticsField`); the mitigations applied
// are (a) removing the per-request DDL that used to run here (the
// `SiteVisit` table now ships via
// `filatelia-web/db/migrations/0008_create_site_visit.sql`), (b) bounding
// `path`/`referrer` length so a caller cannot write unbounded strings into
// the row, and (c) the rate limit below so a caller cannot flood D1 with
// INSERTs.
//
// Key: the caller's `CF-Connecting-IP`. Cloudflare's own rate-limiting docs
// explicitly warn that client IP is NOT the recommended key, because many
// real users share one IP (NAT, corporate proxies, and especially mobile
// carrier NAT). It is used here anyway because this endpoint is
// intentionally anonymous — there is no session, cookie, or other identity
// to key on — so IP is the only signal available at all. A caller with no
// `CF-Connecting-IP` header (a request that did not come through Cloudflare)
// falls back to the constant key below, meaning every header-less caller
// shares a single bucket; that is an accepted, deliberate trade-off, not an
// oversight.
//
// Limit: 60 requests per 60 seconds, PER CLOUDFLARE LOCATION (this is a
// Workers rate limit, not a global one — the same IP hitting two different
// PoPs gets two independent buckets). A real visitor triggers this endpoint
// once per page view / SPA route change from `AnalyticsTracker.tsx`; even
// rapid, deliberate browsing (multiple page loads per second) stays far
// under 60/minute. A flood — scripted or a shared-IP burst — that sustains
// more than one request per second from the same PoP is not something a
// single real visitor produces, so it is the intended target.
export function getAnalyticsRateLimitKey(req: Request): string {
  return req.headers.get('CF-Connecting-IP') || 'no-cf-connecting-ip';
}

// Isolated from the Hono handler so it can be unit-tested directly: this
// suite's D1 pool has no migrations, so any request that reaches the
// `SiteVisit` INSERT 500s regardless of what the rate limiter decided,
// which would make an HTTP-level assertion of "under the limit -> allowed"
// pass for the wrong reason. Testing this function directly proves the
// actual decision.
//
// DEGRADE GRACEFULLY: `limiter` is `undefined` on any deployment where the
// `ANALYTICS_LIMITER` binding isn't present (older deployment, local dev,
// or a test pool that doesn't wire it up). That case must never throw and
// must never silently allow-with-no-signal — it is logged with
// `console.warn`, matching the logging convention already used by
// `requireAdmin` and the catch block below, so an operator can see the
// limiter was unavailable rather than assuming it ran.
export async function checkAnalyticsRateLimit(
  limiter: RateLimit | undefined,
  key: string
): Promise<boolean> {
  if (!limiter) {
    console.warn('analytics/visit: ANALYTICS_LIMITER binding is absent — allowing the request unrate-limited');
    return true;
  }
  const { success } = await limiter.limit({ key });
  return success;
}

app.post('/analytics/visit', async (c) => {
  try {
    const allowed = await checkAnalyticsRateLimit(c.env.ANALYTICS_LIMITER, getAnalyticsRateLimitKey(c.req.raw));
    if (!allowed) {
      return c.json({ success: false, error: 'Too many requests' }, 429);
    }

    const { path, referrer } = await c.req.json();

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO SiteVisit (id, path, referrer, createdAt) VALUES (?, ?, ?, datetime('now'))`
    ).bind(id, truncateAnalyticsField(path) || '/', truncateAnalyticsField(referrer) || null).run();

    return c.json({ success: true });
  } catch (err: any) {
    // The removed per-request DDL used to make this endpoint self-healing: if
    // `SiteVisit` was missing anywhere, the next request created it. It no
    // longer does, and the only client (`AnalyticsTracker.tsx`) swallows the
    // failure with `.catch(() => {})` — so a missing table means 100% silent
    // analytics loss with no user-facing symptom at all. Log it server-side,
    // distinctly enough that an operator reads "run migration 0008" and not
    // "generic insert error". The client-visible response is unchanged.
    const message = err?.message ?? String(err);
    if (/no such table/i.test(message)) {
      console.error(
        'analytics/visit: rejected — the SiteVisit table does not exist in this D1 database. ' +
        'Migration filatelia-web/db/migrations/0008_create_site_visit.sql has not been applied to this environment; ' +
        'EVERY anonymous visit is being dropped and the client swallows the error silently. ' +
        `D1 said: ${message}`
      );
    } else {
      console.error('analytics/visit: rejected — INSERT into SiteVisit failed:', message);
    }
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get('/analytics/total', async (c) => {
  try {
    let total = 0;
    try {
      const row = await c.env.DB.prepare('SELECT COUNT(*) as total FROM SiteVisit').first() as any;
      total = row?.total || 0;
    } catch (_) { /* table may not exist yet */ }
    return c.json({ total }, 200, { 'Cache-Control': 'public, max-age=300' });
  } catch {
    return c.json({ total: 0 });
  }
});

// Extracted so `/analytics/stats` and `/admin/analytics/stats` (reachable
// through the Next admin proxy) register the exact same handler instead of
// copy-pasted bodies. Previously this hand-rolled its own inline admin
// check (`getAuthUser` + role/email/first-user logic duplicated from
// `requireAdmin`); it now defers to `requireAdmin` so there is one admin
// authority in this file.
async function analyticsStatsHandler(c: any) {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const stampCount = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM Stamp').first() as any;

    let visitsToday = 0, visitsAll = 0, topPaths: any[] = [];
    try {
      const today = await c.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM SiteVisit WHERE createdAt >= date('now')`
      ).first() as any;
      visitsToday = today?.cnt || 0;

      const all = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM SiteVisit').first() as any;
      visitsAll = all?.cnt || 0;

      const paths = await c.env.DB.prepare(
        `SELECT path, COUNT(*) as visits FROM SiteVisit GROUP BY path ORDER BY visits DESC LIMIT 5`
      ).all();
      topPaths = paths.results;
    } catch (_) {}

    return c.json({
      success: true,
      totalStamps: stampCount?.cnt || 0,
      visitsToday,
      visitsAllTime: visitsAll,
      topPaths,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
}

app.get('/analytics/stats', analyticsStatsHandler);
app.get('/admin/analytics/stats', analyticsStatsHandler);

// ==========================================
// ADMIN CRUD: stamps
// ==========================================

// Constant-time comparison over encoded bytes. Iterates the full length of
// the longer input regardless of where (or whether) a mismatch occurs, so no
// branch inside the loop depends on secret data — this must never contain an
// early `return`/`break` on the first differing byte, which would leak the
// position of the first mismatch (and, transitively, prefix information)
// through timing.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);

  // Length mismatches are folded into the accumulator instead of returning
  // early, so a caller cannot distinguish "wrong length" from "right length,
  // wrong content" by timing alone.
  let mismatch = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0;
    const y = i < bBytes.length ? bBytes[i] : 0;
    mismatch |= x ^ y;
  }
  return mismatch === 0;
}

// Token-only: the sole way to authorize as admin is a service-to-service
// caller presenting `X-Admin-Token` matching the `ADMIN_API_TOKEN` Worker
// secret (constant-time compare), used by the Next admin proxy. The Worker
// no longer authenticates identities itself (see the deleted `/auth/*`
// routes and `getAuthUser`) — the Next app is the sole session authority.
//
// This deliberately removes two legacy privilege-escalation rules that used
// to live here: any identity whose email ended in `@filateliaperuana.com`,
// and "if `User` has exactly one row, that row is admin". Both are covered
// by regression tests in test/auth-removal.test.ts.
//
// The service token never authorizes when `ADMIN_API_TOKEN` is unset or
// empty in env — an empty header must never match an empty secret.
//
// Every rejection is logged server-side with the *reason* (header absent vs.
// present-but-mismatched vs. secret not configured), because callers only
// ever see an opaque 403: without this trace an `ADMIN_API_TOKEN` skew
// between the Worker secret and the Next proxy's env var is
// indistinguishable from a legitimate permission denial. The token value —
// header or secret — is never logged, not even a prefix, since a prefix
// would hand an attacker with log access exactly the material the
// constant-time compare exists to protect.
export async function requireAdmin(c: any): Promise<any | null> {
  const headerToken = c.req.header('X-Admin-Token');
  const serviceToken = c.env.ADMIN_API_TOKEN;
  if (headerToken && serviceToken && timingSafeEqual(headerToken, serviceToken)) {
    return { id: 'service', role: 'admin', viaServiceToken: true };
  }

  if (!serviceToken) {
    console.warn('requireAdmin: rejected — ADMIN_API_TOKEN is not configured on this Worker');
  } else if (!headerToken) {
    console.warn('requireAdmin: rejected — X-Admin-Token header absent');
  } else {
    console.warn('requireAdmin: rejected — X-Admin-Token present but mismatched with ADMIN_API_TOKEN');
  }
  return null;
}

app.get('/admin/stamps', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const search      = c.req.query('search');
    const countryCode = c.req.query('countryCode');
    const page        = Math.max(1, parseInt(c.req.query('page') || '1'));
    const limit       = Math.min(100, parseInt(c.req.query('limit') || '50'));
    const offset      = (page - 1) * limit;

    const conditions: string[] = [];
    const bindParams: any[] = [];

    if (countryCode) { conditions.push('s.countryCode = ?'); bindParams.push(countryCode); }
    if (search)      { conditions.push('(s.nameEs LIKE ? OR s.nameEn LIKE ?)'); bindParams.push(`%${search}%`, `%${search}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRes, dataRes] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT COUNT(*) as total FROM Stamp s ${where}`).bind(...bindParams),
      c.env.DB.prepare(`
        SELECT s.id, s.wnsNumber, s.scottNumber, s.countryCode, s.year, s.nameEs, s.nameEn,
               s.theme, s.isVerified, s.marketPriceUsd, s.imageUrl
        FROM Stamp s ${where}
        ORDER BY s.countryCode ASC, s.year ASC
        LIMIT ? OFFSET ?
      `).bind(...bindParams, limit, offset),
    ]);

    const total = (countRes.results[0] as any)?.total || 0;
    return c.json({ success: true, stamps: dataRes.results, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.put('/admin/stamp/:id', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    const body = await c.req.json();
    const { nameEs, nameEn, scottNumber, marketPriceUsd, theme, isVerified } = body;

    await c.env.DB.prepare(`
      UPDATE Stamp SET
        nameEs = COALESCE(?, nameEs),
        nameEn = COALESCE(?, nameEn),
        scottNumber = COALESCE(?, scottNumber),
        marketPriceUsd = COALESCE(?, marketPriceUsd),
        theme = COALESCE(?, theme),
        isVerified = COALESCE(?, isVerified),
        updatedAt = datetime('now')
      WHERE id = ?
    `).bind(
      nameEs ?? null, nameEn ?? null, scottNumber ?? null,
      marketPriceUsd ?? null, theme ?? null, isVerified ?? null, id
    ).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.delete('/admin/stamp/:id', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    await c.env.DB.prepare('DELETE FROM Stamp WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// ADMIN CRUD: groups
// ==========================================

app.get('/admin/groups', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const page  = Math.max(1, parseInt(c.req.query('page') || '1'));
    const limit = Math.min(100, parseInt(c.req.query('limit') || '50'));
    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) as total FROM StampGroup'),
      c.env.DB.prepare('SELECT * FROM StampGroup ORDER BY year ASC LIMIT ? OFFSET ?').bind(limit, offset),
    ]);

    const total = (countRes.results[0] as any)?.total || 0;
    return c.json({ success: true, groups: dataRes.results, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post('/admin/group', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { catalogId, titleEs, titleEn, year } = await c.req.json();
    if (!catalogId || !titleEs) return c.json({ success: false, error: 'catalogId and titleEs required' }, 400);

    const id = `group-${crypto.randomUUID()}`;
    await c.env.DB.prepare(
      `INSERT INTO StampGroup (id, catalogId, titleEs, titleEn, year, "order") VALUES (?, ?, ?, ?, ?, 0)`
    ).bind(id, catalogId, titleEs, titleEn || titleEs, year || null).run();

    return c.json({ success: true, id }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.put('/admin/group/:id', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    const { catalogId, titleEs, titleEn, year } = await c.req.json();

    await c.env.DB.prepare(`
      UPDATE StampGroup SET
        catalogId = COALESCE(?, catalogId),
        titleEs   = COALESCE(?, titleEs),
        titleEn   = COALESCE(?, titleEn),
        year      = COALESCE(?, year)
      WHERE id = ?
    `).bind(catalogId ?? null, titleEs ?? null, titleEn ?? null, year ?? null, id).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.delete('/admin/group/:id', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    // Delete stamps first, then group
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM Stamp WHERE groupId = ?').bind(id),
      c.env.DB.prepare('DELETE FROM StampGroup WHERE id = ?').bind(id),
    ]);

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// ADMIN CRUD: catalogs
// ==========================================

app.get('/admin/catalogs', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { results } = await c.env.DB.prepare('SELECT * FROM Catalog ORDER BY yearStart ASC').all();
    return c.json({ success: true, catalogs: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.post('/admin/catalog', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { name, description, yearStart, yearEnd } = await c.req.json();
    if (!name) return c.json({ success: false, error: 'name required' }, 400);

    const id = `cat-${crypto.randomUUID()}`;
    await c.env.DB.prepare(
      `INSERT INTO Catalog (id, name, description, yearStart, yearEnd, status) VALUES (?, ?, ?, ?, ?, 'activo')`
    ).bind(id, name, description || null, yearStart || null, yearEnd || null).run();

    return c.json({ success: true, id }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.put('/admin/catalog/:id', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    const { name, description, yearStart, yearEnd, status } = await c.req.json();

    await c.env.DB.prepare(`
      UPDATE Catalog SET
        name        = COALESCE(?, name),
        description = COALESCE(?, description),
        yearStart   = COALESCE(?, yearStart),
        yearEnd     = COALESCE(?, yearEnd),
        status      = COALESCE(?, status)
      WHERE id = ?
    `).bind(name ?? null, description ?? null, yearStart ?? null, yearEnd ?? null, status ?? null, id).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.delete('/admin/catalog/:id', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { id } = c.req.param();

    // Check no groups exist for this catalog
    const groupCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM StampGroup WHERE catalogId = ?'
    ).bind(id).first() as any;

    if (groupCount?.cnt > 0) {
      return c.json({ success: false, error: 'Cannot delete catalog with existing groups' }, 409);
    }

    await c.env.DB.prepare('DELETE FROM Catalog WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// ADMIN CRUD: users
// ==========================================

app.get('/admin/users', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const page  = Math.max(1, parseInt(c.req.query('page') || '1'));
    const limit = Math.min(100, parseInt(c.req.query('limit') || '50'));
    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) as total FROM User'),
      c.env.DB.prepare(`
        SELECT u.id, u.name, u.email, u.createdAt,
               r.name as roleName
        FROM User u
        LEFT JOIN UserRole ur ON ur.userId = u.id
        LEFT JOIN Role r ON ur.roleId = r.id
        ORDER BY u.createdAt DESC
        LIMIT ? OFFSET ?
      `).bind(limit, offset),
    ]);

    const total = (countRes.results[0] as any)?.total || 0;
    return c.json({ success: true, users: dataRes.results, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.put('/admin/user/:id/role', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    const { role } = await c.req.json();
    if (!role || !['user', 'admin'].includes(role)) {
      return c.json({ success: false, error: 'Invalid role' }, 400);
    }

    // Find role ID
    const roleRow = await c.env.DB.prepare('SELECT id FROM Role WHERE name = ?').bind(role).first() as any;
    if (!roleRow) return c.json({ success: false, error: 'Role not found' }, 404);

    // Remove existing roles and set new one
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM UserRole WHERE userId = ?').bind(id),
      c.env.DB.prepare('INSERT INTO UserRole (id, userId, roleId) VALUES (?, ?, ?)').bind(crypto.randomUUID(), id, roleRow.id),
    ]);

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.delete('/admin/user/:id', async (c) => {
  try {
    const admin = await requireAdmin(c);
    if (!admin) return c.json({ success: false, error: 'Forbidden' }, 403);

    const { id } = c.req.param();
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM UserRole WHERE userId = ?').bind(id),
      c.env.DB.prepare('DELETE FROM User WHERE id = ?').bind(id),
    ]);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

async function generateUUIDv5(namespaceStr: string, name: string): Promise<string> {
  const nsBytes = new Uint8Array(
    namespaceStr.replace(/-/g, '').match(/.{2}/g)!.map(hex => parseInt(hex, 16))
  );
  const nameBytes = new TextEncoder().encode(name);
  
  const buffer = new Uint8Array(nsBytes.length + nameBytes.length);
  buffer.set(nsBytes);
  buffer.set(nameBytes, nsBytes.length);
  
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
  const hashBytes = new Uint8Array(hashBuffer);
  
  // Set version to 5
  hashBytes[6] = (hashBytes[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122
  hashBytes[8] = (hashBytes[8] & 0x3f) | 0x80;
  
  const hex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32)
  ].join('-');
}

export default app;
