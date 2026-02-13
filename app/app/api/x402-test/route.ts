/**
 * x402 Test Endpoint
 *
 * Tests the x402 payment flow using Thirdweb's settlePayment.
 * Supports dynamic price and recipient to test operator-to-agent flow.
 *
 * GET /api/x402-test - Default: $0.001 to cost sink wallet
 * GET /api/x402-test?price=0.067&recipient=0xAgentWallet - Custom params
 */

import { NextRequest, NextResponse } from "next/server";
import { handleX402Payment, COST_SINK_WALLET } from "@/lib/x402";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const price = parseFloat(searchParams.get("price") || "0.001");
  const recipient = searchParams.get("recipient") ||
    process.env.THIRDWEB_WALLET_ADDRESS ||
    COST_SINK_WALLET;

  if (isNaN(price) || price <= 0) {
    return NextResponse.json(
      { error: "Invalid price parameter" },
      { status: 400 }
    );
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    return NextResponse.json(
      { error: "Invalid recipient address" },
      { status: 400 }
    );
  }

  const paymentResult = await handleX402Payment(
    request,
    recipient,
    price,
    `x402 Test - $${price} USDC to ${recipient.slice(0, 10)}...`
  );

  if (!paymentResult.paid) {
    return new Response(JSON.stringify(paymentResult.body), {
      status: paymentResult.status,
      headers: {
        "Content-Type": "application/json",
        ...(paymentResult.headers || {}),
      },
    });
  }

  return NextResponse.json({
    success: true,
    message: "Payment verified! Service delivered.",
    testData: {
      timestamp: new Date().toISOString(),
      recipient,
      price: `$${price}`,
      currency: "USDC",
      service: "x402 Test Service",
    },
  });
}
