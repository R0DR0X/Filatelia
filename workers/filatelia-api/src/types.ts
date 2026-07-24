export interface QueryRequest {
  query?: string;
  image?: string;
  topK?: number;
  filters?: {
    countryCode?: string;
    yearFrom?: number;
    yearTo?: number;
  };
}

export interface MatchResult {
  id: string;
  nameEs: string;
  nameEn?: string | null;
  scottNumber?: string | null;
  year?: number | null;
  countryCode?: string | null;
  imageUrl?: string | null;
  marketPriceUsd?: number | null;
  score: number;
  similarity: number;
  confidence: number;
}

export interface QueryResponse {
  success: boolean;
  totalMatches: number;
  matches: MatchResult[];
  results: MatchResult[];
  error?: string;
  queryTimeMs?: number;
}
