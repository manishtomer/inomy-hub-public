-- Enable Supabase Realtime on economy_events table
-- This allows the browser to subscribe to INSERT events via postgres_changes
ALTER PUBLICATION supabase_realtime ADD TABLE economy_events;
