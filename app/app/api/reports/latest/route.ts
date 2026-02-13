import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/reports/latest
 * Returns the most recent industry report, or null if none exist.
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('industry_reports')
      .select('*')
      .order('report_number', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is fine
      console.error('[/api/reports/latest] DB error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      report: data || null,
    });
  } catch (err) {
    console.error('[/api/reports/latest] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
