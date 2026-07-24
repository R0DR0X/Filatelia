// Edge Function: search-semantic
// Receives a text query, generates embedding, searches by cosine similarity
// in pgvector, and combines with full-text search (RRF fusion).
// Returns ranked results.

import "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface SearchRequest {
  query: string;
  topK?: number;
  filters?: {
    countryCode?: string;
    yearMin?: number;
    yearMax?: number;
    minPrice?: number;
    maxPrice?: number;
    theme?: string;
  };
}

interface StampResult {
  id: string;
  nameEs: string;
  nameEn: string | null;
  scottNumber: string | null;
  year: number | null;
  countryCode: string | null;
  imageUrl: string | null;
  marketPriceUsd: number | null;
  similarity: number;
  ftsRank: number;
  combinedScore: number;
  countryNameEs?: string;
}

interface SearchResponse {
  success: boolean;
  query: string;
  totalResults: number;
  results: StampResult[];
  error?: string;
}

// Generate embedding using OpenAI API
async function generateEmbedding(
  text: string,
  apiKey: string
): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Vector similarity search via pgvector
async function vectorSearch(
  supabase: SupabaseClient,
  embedding: number[],
  topK: number,
  filters?: SearchRequest["filters"]
): Promise<Map<string, { similarity: number }>> {
  const { data, error } = await supabase.rpc("match_stamps_by_embedding", {
    query_embedding: embedding,
    match_count: topK * 2, // Fetch more for reranking
    filter_country: filters?.countryCode || null,
  });

  if (error) {
    console.error("Vector search error:", error);
    return new Map();
  }

  const results = new Map<string, { similarity: number }>();
  for (const row of data || []) {
    results.set(row.id, { similarity: row.similarity });
  }
  return results;
}

// Full-text search with ranking
async function textSearch(
  supabase: SupabaseClient,
  query: string,
  topK: number,
  filters?: SearchRequest["filters"]
): Promise<Map<string, { rank: number; row: any }>> {
  // Build tsquery from search terms
  const tsQuery = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t + ":*")
    .join(" & ");

  let queryBuilder = supabase
    .from("Stamp")
    .select(`
      id, nameEs, nameEn, scottNumber, year, countryCode,
      imageUrl, marketPriceUsd, theme,
      searchVector
    `)
    .textSearch("searchVector", tsQuery, {
      type: "websearch",
      config: "spanish",
    })
    .limit(topK * 2);

  if (filters?.countryCode) {
    queryBuilder = queryBuilder.eq("countryCode", filters.countryCode);
  }
  if (filters?.yearMin) {
    queryBuilder = queryBuilder.gte("year", filters.yearMin);
  }
  if (filters?.yearMax) {
    queryBuilder = queryBuilder.lte("year", filters.yearMax);
  }
  if (filters?.minPrice) {
    queryBuilder = queryBuilder.gte("marketPriceUsd", filters.minPrice);
  }
  if (filters?.maxPrice) {
    queryBuilder = queryBuilder.lte("marketPriceUsd", filters.maxPrice);
  }
  if (filters?.theme) {
    queryBuilder = queryBuilder.eq("theme", filters.theme);
  }

  const { data, error } = await queryBuilder;

  if (error || !data) {
    console.error("Text search error:", error);
    return new Map();
  }

  const results = new Map<string, { rank: number; row: any }>();
  data.forEach((row: any, idx: number) => {
    results.set(row.id, { rank: 1 / (idx + 1), row }); // RRF: 1/(rank+1)
  });
  return results;
}

// Get country name for results
async function enrichWithCountryNames(
  supabase: SupabaseClient,
  results: StampResult[]
): Promise<StampResult[]> {
  const countryCodes = [...new Set(results.map((r) => r.countryCode).filter(Boolean))];
  if (countryCodes.length === 0) return results;

  const { data: countries } = await supabase
    .from("Country")
    .select("code, nameEs")
    .in("code", countryCodes as string[]);

  const nameMap = new Map(countries?.map((c: any) => [c.code, c.nameEs]) || []);

  return results.map((r) => ({
    ...r,
    countryNameEs: r.countryCode ? nameMap.get(r.countryCode) : undefined,
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query: string;
    let topK = 20;
    let filters: SearchRequest["filters"] | undefined;

    if (req.method === "GET") {
      const url = new URL(req.url);
      query = url.searchParams.get("q") || "";
      topK = parseInt(url.searchParams.get("topK") || "20");
      filters = {
        countryCode: url.searchParams.get("country") || undefined,
        yearMin: url.searchParams.get("yearMin")
          ? parseInt(url.searchParams.get("yearMin")!)
          : undefined,
        yearMax: url.searchParams.get("yearMax")
          ? parseInt(url.searchParams.get("yearMax")!)
          : undefined,
      };
    } else {
      const body: SearchRequest = await req.json();
      query = body.query;
      topK = body.topK || 20;
      filters = body.filters;
    }

    if (!query || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No query provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanQuery = query.trim();
    let vectorResults = new Map<string, { similarity: number }>();
    let textResults = new Map<string, { rank: number; row: any }>();

    // Try vector search if OpenAI key available
    if (OPENAI_API_KEY) {
      try {
        const embedding = await generateEmbedding(cleanQuery, OPENAI_API_KEY);
        vectorResults = await vectorSearch(supabase, embedding, topK, filters);
      } catch (e) {
        console.error("Vector search failed:", e);
      }
    }

    // Always try text search as complement
    try {
      textResults = await textSearch(supabase, cleanQuery, topK, filters);
    } catch (e) {
      console.error("Text search failed:", e);
    }

    // RRF (Reciprocal Rank Fusion) combining
    const allIds = new Set<string>([
      ...vectorResults.keys(),
      ...textResults.keys(),
    ]);

    const combined: StampResult[] = [];

    for (const id of allIds) {
      const vr = vectorResults.get(id);
      const tr = textResults.get(id);

      // RRF formula: sum of 1/(k + rank_i) with k=60
      const k = 60;
      let combinedScore = 0;

      if (vr) {
        combinedScore += vr.similarity; // Vector similarity already 0-1
      }
      if (tr) {
        combinedScore += tr.rank; // Text search rank
      }

      const row = tr?.row;
      if (row || vr) {
        combined.push({
          id,
          nameEs: row?.nameEs || "",
          nameEn: row?.nameEn || null,
          scottNumber: row?.scottNumber || null,
          year: row?.year || null,
          countryCode: row?.countryCode || null,
          imageUrl: row?.imageUrl || null,
          marketPriceUsd: row?.marketPriceUsd || null,
          similarity: vr?.similarity || 0,
          ftsRank: tr?.rank || 0,
          combinedScore,
        });
      }
    }

    // Sort by combined score and limit
    combined.sort((a, b) => b.combinedScore - a.combinedScore);
    const topResults = combined.slice(0, topK);

    // Enrich with country names
    const enriched = await enrichWithCountryNames(supabase, topResults);

    const response: SearchResponse = {
      success: true,
      query: cleanQuery,
      totalResults: enriched.length,
      results: enriched,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("search-semantic error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
