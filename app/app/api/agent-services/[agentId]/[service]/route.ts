/**
 * Agent Services API - x402 Payment Endpoint
 *
 * @deprecated Use POST /api/task-delivery/[taskId] instead.
 * This endpoint is kept for backwards compatibility with existing test scripts.
 *
 * Handles agent-to-agent service requests with x402 payments via Thirdweb.
 *
 * Routes:
 * - GET /api/agent-services/[agentId]/catalog-extract
 * - GET /api/agent-services/[agentId]/review-analyze
 * - GET /api/agent-services/[agentId]/curation-rank
 * - etc.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  handleX402Payment,
  createPaymentRecord,
} from "@/lib/x402";
import { createEvent } from "@/lib/api-helpers";
import { createClient } from "@supabase/supabase-js";

// Fixed service prices (legacy, replaced by bid-based pricing in /api/task-delivery)
const LEGACY_SERVICE_PRICES: Record<string, number> = {
  CATALOG_EXTRACT: 0.001,
  CATALOG_ENRICH: 0.002,
  REVIEW_ANALYZE: 0.002,
  REVIEW_SUMMARIZE: 0.001,
  CURATION_RANK: 0.001,
  CURATION_RECOMMEND: 0.003,
  SELLER_QUOTE: 0.0005,
  SELLER_NEGOTIATE: 0.002,
};

// Service type mapping from URL slug to enum
const SERVICE_MAP: Record<string, string> = {
  "catalog-extract": "CATALOG_EXTRACT",
  "catalog-enrich": "CATALOG_ENRICH",
  "review-analyze": "REVIEW_ANALYZE",
  "review-summarize": "REVIEW_SUMMARIZE",
  "curation-rank": "CURATION_RANK",
  "curation-recommend": "CURATION_RECOMMEND",
  "seller-quote": "SELLER_QUOTE",
  "seller-negotiate": "SELLER_NEGOTIATE",
};

// Valid services per agent type
const AGENT_TYPE_SERVICES: Record<string, string[]> = {
  CATALOG: ["CATALOG_EXTRACT", "CATALOG_ENRICH"],
  REVIEW: ["REVIEW_ANALYZE", "REVIEW_SUMMARIZE"],
  CURATION: ["CURATION_RANK", "CURATION_RECOMMEND"],
  SELLER: ["SELLER_QUOTE", "SELLER_NEGOTIATE"],
};

interface RouteParams {
  params: Promise<{
    agentId: string;
    service: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  console.warn("[DEPRECATED] /api/agent-services/* - Use /api/task-delivery/[taskId] instead");

  const { agentId, service } = await params;

  // Validate service type
  const serviceType = SERVICE_MAP[service];
  if (!serviceType) {
    return NextResponse.json(
      { error: "Unknown service", validServices: Object.keys(SERVICE_MAP) },
      { status: 400 }
    );
  }

  // Get agent details
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: agent, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Verify agent type can provide this service
  const validServices = AGENT_TYPE_SERVICES[agent.type] || [];
  if (!validServices.includes(serviceType)) {
    return NextResponse.json(
      { error: `Agent type ${agent.type} cannot provide ${serviceType}`, validServices },
      { status: 400 }
    );
  }

  if (!agent.wallet_address) {
    return NextResponse.json(
      { error: "Agent has no wallet configured" },
      { status: 503 }
    );
  }

  // Handle x402 payment via Thirdweb
  const price = LEGACY_SERVICE_PRICES[serviceType] || 0.001;
  const description = `${agent.name} - ${service.replace(/-/g, " ")}`;

  const paymentResult = await handleX402Payment(
    request,
    agent.wallet_address,
    price,
    description
  );

  if (!paymentResult.paid) {
    // Return 402 or error from payment handler
    return new Response(JSON.stringify(paymentResult.body), {
      status: paymentResult.status,
      headers: {
        "Content-Type": "application/json",
        ...(paymentResult.headers || {}),
      },
    });
  }

  // Payment verified - execute the service
  const result = await executeService(serviceType, request);

  // Log the payment
  const callerAgentId = request.headers.get("X-Caller-Agent-Id") || "unknown";
  const callerWallet = request.headers.get("X-Caller-Wallet") || "unknown";

  const payment = createPaymentRecord(
    callerAgentId,
    agentId,
    callerWallet,
    agent.wallet_address,
    "task_payment",
    price,
    { taskType: serviceType }
  );

  // Log to activity feed
  await createEvent({
    event_type: "x402_payment",
    description: `${callerAgentId} paid ${agent.name} $${price} USDC via x402 for ${service}`,
    agent_wallets: [agent.wallet_address, callerWallet].filter(w => w !== "unknown"),
    amount: price,
    metadata: {
      service: serviceType,
      from_agent: callerAgentId,
      to_agent: agentId,
      payment_id: payment.id,
    },
  });

  console.log(
    `[x402] Payment: ${callerAgentId} -> ${agentId} | $${price} USDC | ${serviceType}`
  );

  return NextResponse.json({
    success: true,
    agentId: agent.id,
    agentName: agent.name,
    service: serviceType,
    price,
    result,
    payment: { id: payment.id, status: payment.status },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Execute the requested service
 * In production, this calls the agent's AI model
 */
async function executeService(
  serviceType: string,
  request: NextRequest
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { searchParams } = new URL(request.url);
  const input = searchParams.get("input") || searchParams.get("product") || "";

  switch (serviceType) {
    case "CATALOG_EXTRACT":
      return {
        action: "extract",
        input,
        extracted: {
          title: `Product: ${input}`,
          category: "Electronics",
          attributes: ["attribute1", "attribute2"],
          description: `Extracted product data for ${input}`,
        },
        confidence: 0.95,
      };

    case "CATALOG_ENRICH":
      return {
        action: "enrich",
        input,
        enriched: {
          originalData: input,
          addedMetadata: {
            marketSegment: "Consumer",
            priceRange: "Mid-range",
            targetAudience: "General",
          },
        },
      };

    case "REVIEW_ANALYZE":
      return {
        action: "analyze",
        input,
        analysis: {
          sentiment: "positive",
          score: 4.2,
          topPros: ["Good quality", "Fast delivery"],
          topCons: ["Price could be lower"],
          reviewCount: 150,
        },
      };

    case "REVIEW_SUMMARIZE":
      return {
        action: "summarize",
        input,
        summary: `Based on 150 reviews, ${input} receives mostly positive feedback with an average rating of 4.2/5.`,
      };

    case "CURATION_RANK":
      return {
        action: "rank",
        input,
        rankings: [
          { product: input, rank: 1, score: 92 },
          { product: "Alternative A", rank: 2, score: 88 },
          { product: "Alternative B", rank: 3, score: 85 },
        ],
        criteria: ["quality", "price", "reviews"],
      };

    case "CURATION_RECOMMEND":
      return {
        action: "recommend",
        input,
        recommendations: [
          { product: input, relevance: 0.95, reason: "Best match for criteria" },
          { product: "Similar Product", relevance: 0.82, reason: "Good alternative" },
        ],
      };

    case "SELLER_QUOTE":
      return {
        action: "quote",
        input,
        quote: {
          product: input,
          price: 99.99,
          currency: "USDC",
          availability: "In Stock",
          deliveryDays: 3,
          validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      };

    case "SELLER_NEGOTIATE":
      return {
        action: "negotiate",
        input,
        offer: {
          originalPrice: 99.99,
          negotiatedPrice: 89.99,
          discount: "10%",
          terms: "Final offer, valid for 1 hour",
        },
      };

    default:
      return { error: "Service not implemented" };
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  console.warn("[DEPRECATED] /api/agent-services/* - Use /api/task-delivery/[taskId] instead");
  return GET(request, { params });
}
