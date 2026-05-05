# Lumidian

A SaaS dashboard that helps brands track and improve their visibility in AI-generated responses.

## Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, Recharts
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy (async), SQLite
- **LLMs tracked**: ChatGPT (`gpt-4o-mini-search-preview`, paid tiers), Claude (`claude-haiku-4-5` + web search, Pro tier), Perplexity (`sonar` free / `sonar-pro` paid), Gemini (`gemini-2.5-flash` with Google Search grounding)

## Features

- **Visibility Tracker**: Enter a brand name + prompts, run against the LLM platforms enabled for your tier
- **Tier-gated model coverage**: Free runs Perplexity + Gemini; paid tiers unlock ChatGPT search and (Pro only) Claude with live web search
- **Visibility Score**: % of total queries where the brand was mentioned
- **Per-model breakdown**: Score per platform with trend data
- **Historical trends**: Score tracked over time with a line chart
- **Full response viewer**: See every raw LLM response, expandable
- **Scheduled runs**: Automatic daily tracking
- **Manual runs**: "Run Report Now" button with real-time status polling
- **Content Hub**: AI-generated drafts to close visibility gaps
- **Live Opportunities**: Find Reddit, Quora, LinkedIn, and X threads where your brand can contribute

---

## Setup

### 1. Backend

```bash
cd backend

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
cd frontend

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
score = (queries with mention) / (total queries run) × 100
```

Mention detection is a case-insensitive substring check OR a fuzzy match (lowercased + non-alphanumeric stripped). Errored queries are excluded from the denominator.

Example for a Pro brand with 3 prompts, one run:
- 3 prompts × 4 models × 3 runs = **36 total queries**
- If brand appears in 25 of them → **~69% visibility score**

---

## Tier Configuration

All tiers run **3 queries per prompt per model** (`RUNS_PER_PROMPT = 3` in `llm_service.py`). Tiers differ in which models they query:

| Internal key | UI name  | Models queried                                                         |
|--------------|----------|------------------------------------------------------------------------|
| `None`       | Free     | Perplexity (`sonar`), Gemini                                           |
| `basic`      | Starter  | ChatGPT search, Perplexity (`sonar`), Gemini                           |
| `starter`    | Growth   | ChatGPT search, Perplexity (`sonar-pro`), Gemini                       |
| `pro`        | Pro      | ChatGPT search, Claude + web search, Perplexity (`sonar-pro`), Gemini  |

Pitch brands (`brand_type='pitch'`) always use the Free model list regardless of subscription.
