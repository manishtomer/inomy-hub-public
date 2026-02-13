import { NextResponse, NextRequest } from "next/server";
import { deleteHolding } from "@/lib/api-helpers";

/**
 * DELETE /api/holdings/[id]
 * Exit an investment (delete holding)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { error } = await deleteHolding(id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Investment exited successfully"
    });
  } catch (err) {
    console.error("Error deleting holding:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
