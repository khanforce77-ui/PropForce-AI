# 10 · Estimated Monthly Operating Costs

**Version:** 0.1 · **Date:** 2026-11-20

> ⚠️ **All figures are rough planning estimates in USD and need verification** against current vendor pricing pages and quotes before any pricing or budget decision. Cloud prices in `me-central-1` are typically higher than US regions. WhatsApp, OpenAI, voice and telecom prices change often and vary by country and category. No regulatory fees are included here.

## 1. Fixed platform costs

| Item | Staging | Production @ 100 agencies | Production @ 1,000 agencies | Notes |
|---|---|---|---|---|
| ECS Fargate (API + workers) | 60–100 | 250–450 | 1,200–2,500 | autoscaled on load |
| RDS PostgreSQL (Multi-AZ in prod) + storage + backups | 60–120 | 400–700 | 1,500–3,500 | add read replica at scale |
| ElastiCache Redis | 25–50 | 100–250 | 400–900 | |
| ALB + WAF | 30–40 | 50–90 | 120–250 | |
| NAT Gateway + data transfer | 40–60 | 80–200 | 300–800 | NAT is a notable fixed cost |
| S3 storage + requests (media) | 5–10 | 30–80 | 250–700 | assumes ~5–15 GB per agency |
| Secrets Manager, KMS, CloudWatch | 10–20 | 40–100 | 150–400 | |
| Vercel (Pro team) | 20–40 | 40–150 | 150–600 | depends on seats and bandwidth |
| Observability (Sentry, Grafana/Datadog) | 0–50 | 100–300 | 500–1,500 | Datadog grows fast with hosts/logs |
| Transactional email | 0–20 | 20–50 | 80–200 | |
| GitHub (Team + Actions minutes) | 20–50 | 20–80 | 50–150 | |
| **Subtotal (infra & tooling)** | **~270–560** | **~1,130–2,450** | **~4,700–11,500** | |

PaaS alternative for MVP/staging (Render/Railway + Neon/Supabase): roughly 100–400/month at 100 agencies, without UAE data residency.

## 2. Variable (usage) costs — usually passed through via metering

Assumptions per *active* agency per month (to be replaced with pilot data): 1,500 inbound WhatsApp conversations' worth of messages, 3,000 AI replies, 500 business-initiated template messages, 300 voice minutes (Agency/Enterprise only).

| Meter | Unit cost assumption (verify) | Per agency/month | @100 agencies | @1,000 agencies |
|---|---|---|---|---|
| OpenAI chat (AI replies) | ~4k input + 400 output tokens/reply on a small/mid model; ~$0.002–0.01 per reply | $6–30 | $600–3,000 | $6,000–30,000 |
| OpenAI embeddings | negligible (cents per thousand listings) | < $1 | < $50 | < $300 |
| WhatsApp service (user-initiated) replies | Meta has made service conversations free in many markets; verify current UAE rules | ~$0 | ~$0 | ~$0 |
| WhatsApp utility/marketing templates | ~$0.01–0.05 per message for UAE depending on category; verify Meta rate card | $5–25 | $500–2,500 | $5,000–25,000 |
| Voice AI orchestration (Vapi or similar) | ~$0.05–0.15/min platform + LLM + TTS/STT | $15–45 | depends on plan mix | |
| UAE telecom minutes / numbers | Carrier quote required (licensed provider) | TBD | TBD | TBD |
| Malware scanning | in-house ClamAV, compute only | – | – | – |

Typical model: AI replies and WhatsApp templates are included up to plan limits and then metered with a margin, with spending caps per tenant.

## 3. Rough unit economics (illustrative only)

| | @100 agencies | @1,000 agencies |
|---|---|---|
| Infra & tooling | $1.1k–2.5k | $4.7k–11.5k |
| AI + WhatsApp (if fully absorbed) | $1.1k–5.5k | $11k–55k |
| **Total cost / agency / month** | **~$22–80** | **~$16–67** |

Plan prices should be set so that included usage at the plan's limit stays below ~30% of plan revenue. That needs real usage data from pilots.

## 4. One-off / annual costs to budget

| Item | Estimate | Notes |
|---|---|---|
| Penetration test before GA | $5k–20k | scope dependent |
| Google OAuth app verification (sensitive Calendar scopes) | security assessment may be required; cost varies | verify current Google requirements |
| Meta Business verification / Tech Provider | free, time cost | |
| Legal review (PDPL, terms, DPA, telemarketing, RERA advertising) | quote required | |
| Domain, SSL, trademark | small | |
| UAE company/licensing for the SaaS entity | outside this estimate | |

## 5. How we will replace estimates with real numbers

1. Tag all cloud resources by environment and module; enable cost explorer reports.
2. `usage_record` captures every AI run, WhatsApp message and voice minute with unit cost.
3. Super Admin dashboard shows cost per tenant per meter weekly.
4. Re-baseline this document after the first 10 pilot agencies have run for 30 days.
