import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create a mock/placeholder client that always returns errors
// This allows the app to gracefully fall back to mock data
function createMockClient(): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { message: "Supabase not configured" } }),
          limit: () => ({
            order: () => Promise.resolve({ data: null, error: { message: "Supabase not configured" } }),
            then: (resolve: (value: { data: null; error: { message: string } }) => void) =>
              resolve({ data: null, error: { message: "Supabase not configured" } }),
          }),
          then: (resolve: (value: { data: null; error: { message: string } }) => void) =>
            resolve({ data: null, error: { message: "Supabase not configured" } }),
        }),
        order: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: null, error: { message: "Supabase not configured" } }),
            then: (resolve: (value: { data: null; error: { message: string } }) => void) =>
              resolve({ data: null, error: { message: "Supabase not configured" } }),
          }),
          limit: () => ({
            then: (resolve: (value: { data: null; error: { message: string } }) => void) =>
              resolve({ data: null, error: { message: "Supabase not configured" } }),
          }),
          then: (resolve: (value: { data: null; error: { message: string } }) => void) =>
            resolve({ data: null, error: { message: "Supabase not configured" } }),
        }),
        limit: () => ({
          order: () => ({
            then: (resolve: (value: { data: null; error: { message: string } }) => void) =>
              resolve({ data: null, error: { message: "Supabase not configured" } }),
          }),
          then: (resolve: (value: { data: null; error: { message: string } }) => void) =>
            resolve({ data: null, error: { message: "Supabase not configured" } }),
        }),
        then: (resolve: (value: { data: null; error: { message: string } }) => void) =>
          resolve({ data: null, error: { message: "Supabase not configured" } }),
      }),
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: null, error: { message: "Supabase not configured" } }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: "Supabase not configured" } }),
          }),
        }),
      }),
      delete: () => ({
        eq: () => Promise.resolve({ data: null, error: { message: "Supabase not configured" } }),
      }),
    }),
  } as unknown as SupabaseClient;
}

// Check if Supabase is properly configured
const isConfigured = supabaseUrl && supabaseKey && supabaseKey.length > 20;

// Export real client if configured, mock client otherwise
export const supabase: SupabaseClient = isConfigured
  ? createClient(supabaseUrl!, supabaseKey!)
  : createMockClient();

export const isSupabaseConfigured = isConfigured;
