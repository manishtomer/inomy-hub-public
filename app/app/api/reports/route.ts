import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/reports
 * Returns paginated list of industry reports (newest first).
 * Query params: limit (default 10), offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Fetch reports
    const { data: reports, error } = await supabase
      .from('industry_reports')
      .select('*')
      .order('report_number', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[/api/reports] DB error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // Get total count
    const { count, error: countError } = await supabase
      .from('industry_reports')
      .select('id', { count: 'exact', head: true });

    if (countError) {
      console.error('[/api/reports] Count error:', countError);
    }

    return NextResponse.json({
      success: true,
      reports: reports || [],
      total: count || (reports?.length ?? 0),
    });
  } catch (err) {
    console.error('[/api/reports] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
