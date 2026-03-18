---
name: stripe-pulse
description: "Check Stripe SaaS metrics from the terminal. Use when you need MRR, churn, LTV, NRR, ARPU, customer counts, MRR movements, or a full dashboard. Triggers on 'check MRR', 'what's our churn', 'stripe metrics', 'how many customers', 'revenue breakdown', 'export metrics', or any Stripe analytics question. Runs `stripe-pulse` CLI commands and parses JSON output."
---

# stripe-pulse — Stripe SaaS Metrics CLI

Get MRR, ARR, churn, LTV, NRR, quick ratio, MRR movements, and more — directly from Stripe subscriptions.

**Install:** `npm install -g stripe-pulse`
**Quick check:** `stripe-pulse mrr --json`
**Everything at once:** `stripe-pulse dashboard --json`

## When to Use

- User asks about MRR, revenue, churn, customers, or any SaaS metric
- Updating pulse.md or state files that track MRR
- Running freshness guards that check Stripe data
- User wants to export metrics (CSV, markdown, JSON)
- User says "check stripe", "what's our MRR", "how's churn looking"
- Comparing metrics across profiles/accounts

## Quick Start

```bash
# First time: authenticate
stripe-pulse login

# Check MRR
stripe-pulse mrr --json
# → { "mrr": 392, "arr": 4704, "currency": "usd", "activeSubscriptions": 18, "breakdown": [...] }

# Full dashboard (most efficient — one call, all metrics)
stripe-pulse dashboard --json
# → { "mrr": ..., "arr": ..., "churn": ..., "ltv": ..., "nrr": ..., ... }
```

## Authentication

Three-tier auth chain (highest priority wins):

1. `--api-key <key>` flag on any command
2. `STRIPE_API_KEY` environment variable
3. Credentials file at `~/.config/stripe-pulse/credentials.json`

Multi-account: `stripe-pulse mrr --profile activecalculator --json`

Supports full keys (`sk_live_*`, `sk_test_*`) and restricted keys (`rk_live_*`, `rk_test_*`).

## Commands

### Single Metrics
| Command | Returns | Key Fields |
|---------|---------|------------|
| `mrr --json` | MRR + breakdown | `mrr`, `arr`, `activeSubscriptions`, `breakdown[]` |
| `arr --json` | Annual run rate | `arr`, `mrr` |
| `customers --json` | Count by status | `activeSubscribers`, `trialingCustomers`, `pastDueCustomers` |
| `arpu --json` | Avg revenue/user | `arpu` |
| `ltv --json` | Lifetime value | `ltv`, `avgLifespanMonths`, `monthlyChurnRate` |
| `plans --json` | Revenue by plan | `[{ productName, mrr, subscriptionCount, interval }]` |
| `trials --json` | Trial conversion | `conversionRate`, `trialsStarted`, `trialsConverted` |

### Period Metrics (default: last 30 days)
| Command | Returns | Key Fields |
|---------|---------|------------|
| `churn --json` | Customer churn % | `customerChurnRate`, `customersLost` |
| `revenue-churn --json` | Revenue churn % | `revenueChurnRate`, `mrrLost` |
| `nrr --json` | Net revenue retention | `nrr`, `expansionMrr`, `churnedMrr` |
| `quick-ratio --json` | Growth efficiency | `quickRatio` (>4 excellent, >1 healthy) |
| `movements --json` | MRR waterfall | `newMrr`, `expansionMrr`, `contractionMrr`, `churnedMrr`, `netNewMrr` |

Period flags: `--from 2026-01-01 --to 2026-01-31`

### Customer Lists
| Command | Returns | Key Fields |
|---------|---------|------------|
| `new-customers --json` | New in period | `count`, `customers[].email`, `.mrr` |
| `churned --json` | Churned in period | `count`, `customers[].email`, `.canceledAt` |
| `active --json` | All active (by MRR desc) | `count`, `customers[].email`, `.mrr` |

### Dashboard (All-in-One)
```bash
stripe-pulse dashboard --json
```
Returns every metric in one call: `mrr`, `arr`, `activeSubscribers`, `arpu`, `customerChurnRate`, `revenueChurnRate`, `ltv`, `nrr`, `quickRatio`, `trialConversionRate`, `mrrByPlan[]`, `currency`, `dataAsOf`.

**This is the most efficient call.** Use it when you need multiple metrics — one API batch instead of many.

### Auth & Diagnostics
| Command | Purpose |
|---------|---------|
| `login` | Save Stripe API key (interactive) |
| `login --key sk_xxx --profile name` | Non-interactive login |
| `logout` | Remove credentials |
| `whoami --json` | Show profile, masked key, mode |
| `doctor --json` | Diagnostic checks (version, node, API key, connection) |

## Global Flags

| Flag | Effect |
|------|--------|
| `--json` | Force JSON output |
| `--profile <name>` | Use specific Stripe account |
| `--api-key <key>` | Override API key for this request |
| `--from <date>` | Period start (YYYY-MM-DD) |
| `--to <date>` | Period end (YYYY-MM-DD) |
| `--format csv` | CSV output (for export) |
| `--format markdown` | Markdown table (for docs/updates) |
| `--verbose` | Extended output |
| `--chart` | ASCII chart (MRR trend, plan bars) |
| `--quiet` | Suppress stderr, implies --json |

**Auto-JSON:** When stdout is piped (non-TTY), JSON is automatic. No `--json` needed.

## Output Formats

```bash
# JSON (for parsing)
stripe-pulse mrr --json

# CSV (for spreadsheets)
stripe-pulse active --format csv > customers.csv

# Markdown (for investor updates)
stripe-pulse dashboard --format markdown

# Chart (MRR trend + movements waterfall)
stripe-pulse mrr --chart

# Plan breakdown chart
stripe-pulse plans --chart
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | API error (Stripe call failed) |
| `2` | Auth error (no key, invalid key) |
| `3` | Validation error (bad date, bad option) |

## Gotchas

- **Always use `--json` when parsing output.** Human output has ANSI colors and formatting that will break parsing. `--json` or piped stdout gives clean JSON.
- **`dashboard --json` is more efficient than calling individual commands.** It fetches all data in one parallel batch. Don't call `mrr` + `churn` + `nrr` separately when `dashboard` gives all three.
- **`customers` counts unique customers, `mrr` counts subscriptions.** A customer with 2 subscriptions = 1 customer but 2 in `activeSubscriptions`. Both correct, different measures.
- **Historical MRR (`--chart`) is approximate.** Reconstructed from subscription timestamps using current pricing. Doesn't reflect past price changes or mid-cycle upgrades.
- **Period defaults to last 30 days.** If you need a specific period, always pass `--from` and `--to` explicitly.
- **Restricted keys work but show less info.** Account name shows as "restricted key", product names resolve via separate API call. If product read permission is missing, price IDs are shown instead.
- **Benchmark strings only appear in human output.** JSON output has raw numbers only — no "⚠ High" or "✓ Good" strings.
- **MRR breakdown is coupon-aware.** Discounts are distributed proportionally across plan items. Breakdown total matches top-level MRR exactly.
- **Designed for early-stage SaaS (up to ~10,000 subscriptions).** Each command fetches live data from Stripe — no local database. Under 500 subs: 2-3 seconds. 2,000+ subs: 15-30 seconds. No caching between commands.

## Common Patterns

### Get a single number
```bash
stripe-pulse mrr --json | jq .mrr
# → 392
```

### Check if churn is concerning
```bash
stripe-pulse churn --json | jq '.customerChurnRate > 10'
# → true/false
```

### Get churned customer emails
```bash
stripe-pulse churned --json | jq -r '.customers[].email'
```

### Compare two accounts
```bash
stripe-pulse mrr --profile activecalculator --json | jq .mrr
stripe-pulse mrr --profile teamai --json | jq .mrr
```

### Diagnose connection issues
```bash
stripe-pulse doctor --json | jq '.checks[] | select(.status == "fail")'
```
