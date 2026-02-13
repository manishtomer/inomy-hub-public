# Inomy Hackathon - Next.js + Supabase

A Next.js application with Supabase backend integration for the Inomy Hackathon project.

## Project Structure

```
app/
├── app/
│   ├── api/                 # API routes
│   │   ├── health/          # Health check endpoint
│   │   └── agents/          # Agent endpoints
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Home page
│   └── globals.css          # Global styles
├── lib/
│   └── supabase.ts          # Supabase client initialization
├── public/                  # Static assets
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── next.config.ts           # Next.js config
├── tailwind.config.ts       # Tailwind CSS config
└── postcss.config.mjs       # PostCSS config
```

## Getting Started

### 1. Install Dependencies

```bash
cd app
npm install
```

### 2. Set Up Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.local.example .env.local
```

Then add your Supabase URL and Anon Key:
- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anon key

You can find these in your Supabase dashboard under **Settings > API**.

### 3. Run the Development Server

```bash
npm run dev
```

The app will start on **http://localhost:4000**

## Available Endpoints

### Health Check
- **GET** `/api/health` - Check if the API is running

### Agents
- **GET** `/api/agents` - Fetch all agents from Supabase
- **POST** `/api/agents` - Create a new agent

Example POST request:
```bash
curl -X POST http://localhost:4000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DataHarvest Prime",
    "type": "CATALOG",
    "status": "ACTIVE"
  }'
```

## Supabase Setup

1. Create a Supabase project at https://supabase.com
2. Create tables for your data (agents, tasks, intents, etc.)
3. Copy your project URL and anon key to `.env.local`

Example table schema for agents:
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR NOT NULL,
  type VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  balance NUMERIC DEFAULT 0,
  reputation NUMERIC DEFAULT 3.0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Adding More API Routes

Create files in `app/api/` following the Next.js app router convention:

```typescript
// app/api/tasks/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("tasks")
    .select("*");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
```

## Building for Production

```bash
npm run build
npm start
```

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase
- **Port**: 4000

## Notes

- All Supabase keys prefixed with `NEXT_PUBLIC_` are safe to expose in the browser
- Keep your `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (not committed to git)
- API routes are server-side only, so use them for sensitive operations
