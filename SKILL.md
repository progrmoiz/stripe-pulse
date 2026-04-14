---
name: stripe-pulse
description: "Check Stripe SaaS metrics from the terminal. Use when you need MRR, churn, LTV, NRR, ARPU, customer counts, MRR movements, reactivations, or a full dashboard. Triggers on 'check MRR', 'what's our churn', 'stripe metrics', 'how many customers', 'revenue breakdown', 'returning customers', 'reactivations', 'export metrics', or any Stripe analytics question. Runs `stripe-pulse` CLI commands and parses JSON output."
---

# stripe-pulse — Stripe SaaS Metrics CLI

Get MRR, ARR, churn, LTV, NRR, quick ratio, MRR movements, reactivations — directly from Stripe subscriptions.

**Install:** `npm install -g stripe-pulse`
**Quick check:** `stripe-pulse mrr --json`
**Everything at once:** `stripe-pulse dashboard --json`

## When to Use

- User asks about MRR, revenue, churn, customers, or any SaaS metric
- User asks about returning customers, reactivations, or win-backs
- Updating pulse.md or state files that track MRR
- Running freshness guards that check Stripe data
- User wants to export metrics (CSV, markdown, JSON)
- Comparing metrics across profiles/accounts

## Quick Start

```bash
# First time: authenticate
stripe-pulse login

# Check MRR
stripe-pulse mrr --json
# → { "mrr": 392, "arr": 4704, "currency": "usd", "activeSubscriptions": 18 }

# Full dashboard (one call, all metrics — most efficient)
stripe-pulse dashboard --json
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
| `churn --json` | Customer churn % | `customerChurnRate`, `customersLost`, `reactivatedCustomers` |
| `revenue-churn --json` | Revenue churn % | `revenueChurnRate`, `mrrLost` |
| `nrr --json` | Net revenue retention | `nrr`, `expansionMrr`, `churnedMrr` |
| `quick-ratio --json` | Growth efficiency | `quickRatio`, `reactivationMrr` (>4 excellent, >1 healthy) |
| `movements --json` | MRR waterfall | `newMrr`, `expansionMrr`, `contractionMrr`, `churnedMrr`, `reactivationMrr`, `netNewMrr`, `reactivations[]` |

Period flags: `--from 2026-01-01 --to 2026-01-31`

### Customer Lists
| Command | Returns | Key Fields |
|---------|---------|------------|
| `new-customers --json` | New in period | `count`, `reactivatedCount`, `reactivations[]`, `customers[].email`, `.mrr` |
| `churned --json` | Churned in period | `count`, `customers[].email`, `.canceledAt` |
| `active --json` | All active (by MRR desc) | `count`, `customers[].email`, `.mrr` |

### Dashboard (All-in-One)

```bash
stripe-pulse dashboard --json
```

Returns every metric in one call: `mrr`, `arr`, `activeSubscribers`, `arpu`, `customerChurnRate`, `revenueChurnRate`, `ltv`, `nrr`, `quickRatio`, `reactivatedCustomers`, `reactivations[]`, `trialConversionRate`, `mrrByPlan[]`, `currency`, `dataAsOf`.

**Use `dashboard --json` when you need 2+ metrics** — one parallel batch instead of many sequential calls.

### Auth & Diagnostics
| Command | Purpose |
|---------|---------|
| `login` | Save Stripe API key (interactive) |
| `login --key sk_xxx --profile name` | Non-interactive login |
| `logout` | Remove credentials |
| `switch <profile>` | Switch active profile |
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
| `--verbose` | Extended output (reactivation details, extra context) |
| `--chart` | ASCII chart (MRR trend, plan bars) |
| `--quiet` | Suppress stderr, implies --json |

**Auto-JSON:** When stdout is piped (non-TTY), JSON is automatic. No `--json` needed.

## Reactivation Tracking

stripe-pulse detects win-backs by matching customer IDs across canceled and new subscriptions.

**Classification rules:**
- Matches at the **customer ID level** (same as Baremetrics, ChartMogul, ProfitWell)
- Only **paid** reactivations count — free-tier returns excluded (`mrrCents > 0`)
- **24h minimum gap** — cancel/resub within 24h treated as a plan switch
- **One per customer** — only the most recent new sub counts
- Churn still counts — reactivation is a separate positive MRR movement

**Quick Ratio formula:** `(New + Expansion + Reactivation) / (Churn + Contraction)`

**Where reactivation data appears:**
| Command | Fields |
|---------|--------|
| `dashboard --json` | `reactivatedCustomers`, `reactivations[]` |
| `movements --json` | `reactivationMrr`, `reactivations[]` |
| `churn --json` | `reactivatedCustomers` (netted from `customersLost` for same-period) |
| `new-customers --json` | `reactivatedCount`, `reactivations[]` |
| `quick-ratio --json` | `reactivationMrr` (in numerator) |

## Common Patterns

```bash
# Get a single number
stripe-pulse mrr --json | jq .mrr
# → 392

# Check if churn is concerning
stripe-pulse churn --json | jq '.customerChurnRate > 10'

# Get churned customer emails
stripe-pulse churned --json | jq -r '.customers[].email'

# Check for reactivations
stripe-pulse dashboard --json | jq '.reactivatedCustomers'

# Compare two accounts
stripe-pulse mrr --profile activecalculator --json | jq .mrr
stripe-pulse mrr --profile teamai --json | jq .mrr

# Diagnose connection issues
stripe-pulse doctor --json | jq '.checks[] | select(.status == "fail")'

# Export formats
stripe-pulse active --format csv > customers.csv
stripe-pulse dashboard --format markdown
stripe-pulse mrr --chart
```

## Gotchas

- **Always use `--json` when parsing output** — human output has ANSI colors that break parsing. Piped stdout auto-switches to JSON.
- **`dashboard --json` is more efficient than individual commands** — one parallel batch vs many sequential calls.
- **`customers` counts unique customers, `mrr` counts subscriptions** — a customer with 2 subscriptions = 1 customer but 2 in `activeSubscriptions`.
- **Historical MRR (`--chart`) is approximate** — reconstructed from subscription timestamps using current pricing; doesn't reflect past price changes.
- **Period defaults to last 30 days** — always pass `--from`/`--to` for specific periods.
- **Restricted keys show less info** — product names may show as price IDs if product read permission is missing.
- **MRR breakdown is coupon-aware** — forever-duration discounts distributed proportionally across plan items.
- **`new-customers` totalMrr vs `movements` newMrr can differ** — `new-customers` counts all subs created in period (including canceled); `movements` only counts currently active ones.
- **Designed for early-stage SaaS (up to ~10,000 subscriptions)** — under 500 subs: 2-3s; 2,000+ subs: 15-30s; no caching between commands.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | API error (Stripe call failed) |
| `2` | Auth error (no key, invalid key) |
| `3` | Validation error (bad date, bad option) |

See [reference/mrr-calculation.md](reference/mrr-calculation.md) for MRR methodology, discount handling, tiered pricing, and known divergences from Stripe's dashboard.
