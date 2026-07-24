// Edge Function: identify-stamp
// Receives a base64 image, identifies the stamp using Claude Vision,
// then finds similar stamps via embedding similarity in pgvector.

import { createClient } from "@supabase/supabase-js";
import { Anthropic } from "anthropic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface IdentifyRequest {
  image: string; // base64 encoded image (with or without data:image/... prefix)
  topK?: number; // number of results to return (default 5)
}

interface StampResult {
  id: string;
  nameEs: string;
  nameEn: string | null;
  scottNumber: string | null;
  year: number | null;
  countryCode: string | null;
  imageUrl: string | null;
  similarity: number;
  confidence: number; // 0-100 confidence score from Claude Vision
  marketPriceUsd: number | null;
}

interface IdentifyResponse {
  success: boolean;
  queryStamp?: {
    identification: string;
    country: string | null;
    year: string | null;
    scottNumber: string | null;
    confidence: number;
    visualFeatures: string[];
  };
  results: StampResult[];
  error?: string;
}

// Claude Vision identification
async function identifyWithVision(
  base64Image: string,
  apiKey: string
): Promise<{
  identification: string;
  country: string | null;
  year: string | null;
  scottNumber: string | null;
  confidence: number;
  visualFeatures: string[];
}> {
  const anthropic = new Anthropic({ apiKey });

  // Ensure proper data URI format
  const imageData = base64Image.startsWith("data:")
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: base64Image.replace(/^data:image\/\w+;base64,/, ""),
            },
          },
          {
            type: "text",
            text: `You are a world-class philatelic expert. Analyze this stamp image and provide a JSON response with:
1. "identification": The most likely catalog identification (country + description)
2. "country": 2-letter ISO country code (PE, US, GB, etc.)
3. "year": approximate issue year as string, or null if unknown
4. "scottNumber": most likely Scott catalog number, or null
5. "confidence": your confidence 0-100 that this is a real postage stamp and you can identify it
6. "visualFeatures": array of key visual features (colors, motif, text visible, perforation style)

Respond ONLY with valid JSON, no markdown formatting.`,
          },
        ],
      },
    ],
  });

  const textContent = msg.content.find((c) => c.type === "text");
  if (!textContent) {
    throw new Error("No text response from Claude Vision");
  }

  try {
    const parsed = JSON.parse(textContent.text);
    return {
      identification: parsed.identification || "Unknown stamp",
      country: parsed.country || null,
      year: parsed.year || null,
      scottNumber: parsed.scottNumber || null,
      confidence: Math.min(100, Math.max(0, parsed.confidence || 50)),
      visualFeatures: parsed.visualFeatures || [],
    };
  } catch {
    // Fallback: extract what we can
    return {
      identification: textContent.text.slice(0, 200),
      country: null,
      year: null,
      scottNumber: null,
      confidence: 30,
      visualFeatures: [],
    };
  }
}

// Generate embedding for text query using OpenAI-compatible API
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
    throw new Error(`Embedding API error: ${err}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Search stamps by vector similarity
async function searchByEmbedding(
  supabase: SupabaseClient,
  embedding: number[],
  topK: number,
  countryFilter?: string | null
): Promise<StampResult[]> {
  const { data, error } = await supabase.rpc("match_stamps_by_embedding", {
    query_embedding: embedding,
    match_count: topK,
    filter_country: countryFilter || null,
  });

  if (error) {
    console.error("Embedding search error:", error);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    nameEs: row.name_es,
    nameEn: row.name_en,
    scottNumber: row.scott_number,
    year: row.year,
    countryCode: row.country_code,
    imageUrl: row.image_url,
    similarity: row.similarity,
    confidence: Math.round(row.similarity * 100),
    marketPriceUsd: row.market_price_usd,
  }));
}

// Text-based search fallback
async function searchByText(
  supabase: SupabaseClient,
  query: string,
  topK: number,
  countryFilter?: string | null
): Promise<StampResult[]> {
  let queryBuilder = supabase
    .from("Stamp")
    .select(
      `
      id, nameEs, nameEn, scottNumber, year, countryCode,
      imageUrl, marketPriceUsd
    `
    )
    .textSearch("searchVector", query, {
      type: "websearch",
      config: "spanish",
    })
    .limit(topK);

  if (countryFilter) {
    queryBuilder = queryBuilder.eq("countryCode", countryFilter);
  }

  const { data, error } = await queryBuilder;

  if (error || !data) {
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    nameEs: row.nameEs,
    nameEn: row.nameEn,
    scottNumber: row.scottNumber,
    year: row.year,
    countryCode: row.countryCode,
    imageUrl: row.imageUrl,
    similarity: 0.85, // Default for text search
    confidence: 85,
    marketPriceUsd: row.marketPriceUsd,
  }));
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: IdentifyRequest = await req.json();
    const { image, topK = 5 } = body;

    if (!image) {
      return new Response(
        JSON.stringify({ success: false, error: "No image provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Identify stamp with Claude Vision
    const visionResult = await identifyWithVision(image, ANTHROPIC_API_KEY);

    // Step 2: Build search query from vision result
    const searchQuery = [
      visionResult.identification,
      visionResult.country,
      visionResult.year,
      visionResult.scottNumber,
      ...visionResult.visualFeatures,
    ]
      .filter(Boolean)
      .join(" ");

    let results: StampResult[] = [];

    // Step 3: Try vector similarity search if OpenAI key available
    if (OPENAI_API_KEY) {
      try {
        const embedding = await generateEmbedding(searchQuery, OPENAI_API_KEY);
        results = await searchByEmbedding(
          supabase,
          embedding,
          topK,
          visionResult.country
        );
      } catch (e) {
        console.error("Vector search failed, falling back to text search:", e);
      }
    }

    // Step 4: Fallback to text search if no vector results
    if (results.length === 0) {
      results = await searchByText(
        supabase,
        searchQuery,
        topK,
        visionResult.country
      );
    }

    // Step 5: Update embeddings for matched stamps if missing
    if (OPENAI_API_KEY) {
      for (const result of results) {
        // Check if stamp has embedding, if not, generate one in background
        const { data: stampWithEmbedding } = await supabase
          .from("Stamp")
          .select("embedding")
          .eq("id", result.id)
          .single();

        if (!stampWithEmbedding?.embedding && result.nameEs) {
          // Generate embedding for this stamp (fire and forget)
          generateEmbedding(
            `${result.nameEs} ${result.year || ""} ${result.countryCode || ""}`,
            OPENAI_API_KEY
          )
            .then((emb) =>
              supabase
                .from("Stamp")
                .update({ embedding: emb })
                .eq("id", result.id)
            )
            .catch((e) => console.error("Background embedding update failed:", e));
        }
      }
    }

    const response: IdentifyResponse = {
      success: true,
      queryStamp: visionResult,
      results: results.slice(0, topK),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("identify-stamp error:", error);
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
