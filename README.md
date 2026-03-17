# ClarityAI

A SaaS dashboard that helps brands track and improve their visibility in AI-generated responses.

## Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, Recharts
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy (async), SQLite
- **LLMs tracked**: ChatGPT (gpt-4o-mini), Claude (claude-haiku-4-5), Perplexity (sonar), Gemini (gemini-1.5-flash)

## Features

- **Visibility Tracker**: Enter a brand name + prompts, run against all 4 LLM platforms
- **Configurable query depth**: Basic (5×), Standard (10×), Premium (20×) per prompt per model
- **Visibility Score**: % of total queries where the brand was mentioned
- **Per-model breakdown**: Score per platform with trend data
- **Historical trends**: Score tracked over time with a line chart
- **Full response viewer**: See every raw LLM response, expandable
- **Scheduled runs**: Automatic morning (8 AM UTC) and evening (8 PM UTC) tracking
- **Manual runs**: "Run Report Now" button with real-time status polling

---

## Setup

### 1. Backend

```bash
cd clarity-ai/backend

# Create and activate virtualenv
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure API keys
cp .env.example .env
# Edit .env and add your API keys

# Start the server
uvicorn app.main:app --reload --port 8000
```

Swagger docs available at: http://localhost:8000/api/docs

### 2. Frontend

```bash
cd clarity-ai/frontend

npm install
npm run dev
```

Open: http://localhost:3000

---

## API Keys Required

| Service | Env Var | Get it at |
|---------|---------|-----------|
| OpenAI (ChatGPT) | `OPENAI_API_KEY` | https://platform.openai.com |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| Perplexity | `PERPLEXITY_API_KEY` | https://www.perplexity.ai/settings/api |
| Google (Gemini) | `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |

> **Note**: The app gracefully skips any model whose API key is missing. You can start with just 1–2 keys.

---

## Visibility Score

```
score = (total queries where brand was mentioned) / (total queries run) × 100
```

Example for a Standard tier brand with 3 prompts, one run:
- 3 prompts × 4 models × 10 queries = **120 total queries**
- If brand appears in 84 of them → **70% visibility score**

---

## Tier Configuration

| Tier | Queries per prompt per model |
|------|------------------------------|
| Basic | 5 |
| Standard | 10 |
| Premium | 20 |

---

## Project Structure

```
clarity-ai/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + lifespan
│   │   ├── database.py          # Async SQLAlchemy setup
│   │   ├── models.py            # DB models
│   │   ├── schemas.py           # Pydantic schemas
│   │   ├── scheduler.py         # APScheduler (twice-daily runs)
│   │   ├── routers/
│   │   │   ├── brands.py        # Brand + prompt CRUD
│   │   │   ├── tracking.py      # Trigger runs, check status
│   │   │   └── results.py       # Scores, trends, responses
│   │   └── services/
│   │       ├── llm_service.py   # LLM API integrations
│   │       └── tracking_service.py  # Run orchestration
│   └── requirements.txt
└── frontend/
    ├── app/
    │   ├── dashboard/           # Overview: all brands + stats
    │   ├── tracker/             # Brand management + config
    │   │   ├── [brandId]/       # Edit brand, prompts, run now
    │   │   └── new/             # New brand wizard
    │   └── results/
    │       └── [brandId]/       # Full results: score, chart, responses
    ├── components/
    │   ├── Sidebar.tsx
    │   ├── VisibilityGauge.tsx  # Circular SVG score gauge
    │   ├── ModelBreakdown.tsx   # Per-model bar chart
    │   ├── TrendChart.tsx       # Score over time (Recharts)
    │   ├── ResponsesTable.tsx   # Expandable response viewer
    │   └── ...
    └── lib/api.ts               # Typed API client
```
