// Edge Function: price-alert
// Manages price alerts for users:
// - POST: Create a new price alert for a stamp
// - GET: List alerts for current user
// - PUT: Update alert (e.g., mark as notified)
// - DELETE: Remove an alert
// N8N workflow monitors alerts and sends notifications.

import "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

interface PriceAlertRequest {
  stampId: string;
  targetPrice: number; // In USD
  condition?: string; // 'mint', 'used', etc.
  alertType?: "below" | "above"; // Alert when price goes below or above target
}

interface PriceAlert {
  id: string;
  userId: string;
  stampId: string;
  stampName?: string;
  scottNumber?: string | null;
  targetPrice: number;
  currentPrice: number | null;
  condition: string | null;
  alertType: string;
  isActive: boolean;
  isNotified: boolean;
  createdAt: string;
  triggeredAt: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // GET: List user's alerts
    if (req.method === "GET") {
      const url = new URL(req.url);
      const alertId = url.searchParams.get("id");
      const activeOnly = url.searchParams.get("active") === "true";

      let query = supabase
        .from("PriceAlert")
        .select(`
          id, userId, stampId, targetPrice, currentPrice,
          condition, alertType, isActive, isNotified,
          createdAt, triggeredAt,
          stamp:stampId (nameEs, nameEn, scottNumber, marketPriceUsd, imageUrl)
        `)
        .eq("userId", userId);

      if (alertId) {
        query = query.eq("id", alertId).single();
      }
      if (activeOnly) {
        query = query.eq("isActive", true).eq("isNotified", false);
      }

      const { data, error } = alertId
        ? await query
        : await query.order("createdAt", { ascending: false });

      if (error) throw error;

      const alerts: PriceAlert[] = Array.isArray(data) ? data.map(formatAlert) : [formatAlert(data)];

      return new Response(
        JSON.stringify({ success: true, alerts }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST: Create new alert
    if (req.method === "POST") {
      const body: PriceAlertRequest = await req.json();
      const { stampId, targetPrice, condition, alertType = "below" } = body;

      if (!stampId || !targetPrice) {
        return new Response(
          JSON.stringify({ success: false, error: "stampId and targetPrice are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify stamp exists and get current price
      const { data: stamp } = await supabase
        .from("Stamp")
        .select("id, marketPriceUsd, nameEs")
        .eq("id", stampId)
        .single();

      if (!stamp) {
        return new Response(
          JSON.stringify({ success: false, error: "Stamp not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check for existing active alert
      const { data: existing } = await supabase
        .from("PriceAlert")
        .select("id")
        .eq("userId", userId)
        .eq("stampId", stampId)
        .eq("isActive", true)
        .eq("isNotified", false)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ success: false, error: "Active alert already exists for this stamp" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: newAlert, error } = await supabase
        .from("PriceAlert")
        .insert({
          userId,
          stampId,
          targetPrice,
          currentPrice: stamp.marketPriceUsd,
          condition: condition || null,
          alertType,
          isActive: true,
          isNotified: false,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, alert: formatAlert(newAlert) }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PUT: Update alert (e.g., mark as notified or change target)
    if (req.method === "PUT") {
      const url = new URL(req.url);
      const alertId = url.searchParams.get("id");
      if (!alertId) {
        return new Response(
          JSON.stringify({ success: false, error: "Alert ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body = await req.json();
      const { targetPrice, isActive, isNotified } = body;

      const updates: any = {};
      if (targetPrice !== undefined) updates.targetPrice = targetPrice;
      if (isActive !== undefined) updates.isActive = isActive;
      if (isNotified !== undefined) {
        updates.isNotified = isNotified;
        if (isNotified) updates.triggeredAt = new Date().toISOString();
      }

      const { data: updated, error } = await supabase
        .from("PriceAlert")
        .update(updates)
        .eq("id", alertId)
        .eq("userId", userId) // Security: only own alerts
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, alert: formatAlert(updated) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE: Remove alert
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const alertId = url.searchParams.get("id");
      if (!alertId) {
        return new Response(
          JSON.stringify({ success: false, error: "Alert ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabase
        .from("PriceAlert")
        .delete()
        .eq("id", alertId)
        .eq("userId", userId); // Security: only own alerts

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: "Alert deleted" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("price-alert error:", error);
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

function formatAlert(row: any): PriceAlert {
  return {
    id: row.id,
    userId: row.userId,
    stampId: row.stampId,
    stampName: row.stamp?.nameEs || undefined,
    scottNumber: row.stamp?.scottNumber || undefined,
    targetPrice: row.targetPrice,
    currentPrice: row.currentPrice || row.stamp?.marketPriceUsd || null,
    condition: row.condition,
    alertType: row.alertType,
    isActive: row.isActive,
    isNotified: row.isNotified,
    createdAt: row.createdAt,
    triggeredAt: row.triggeredAt,
  };
}
