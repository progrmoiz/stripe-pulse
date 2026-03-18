# stripe-pulse

```
  ╭─╮
──╯ ╰──╮ ╭──   stripe-pulse v0.1.0
       ╰─╯
```

**Your Stripe metrics in one command. Vital signs for your SaaS.**

MRR · ARR · Churn · LTV · NRR · Quick Ratio · MRR Movements — straight from Stripe. No dashboard. No $129/mo. No data exports.

[![npm](https://img.shields.io/npm/v/stripe-pulse)](https://www.npmjs.com/package/stripe-pulse)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Why

Stripe has no MRR endpoint. Baremetrics costs $129/mo. ChartMogul starts at $199/mo. ProfitWell requires an integration.

stripe-pulse calculates everything locally from your Stripe subscriptions — in seconds, from the command line, for free.

---

## Install

**Instant (no install):**
```bash
npx stripe-pulse
```

**Global install:**
```bash
npm install -g stripe-pulse
stripe-pulse --version
```

> Requires Node.js >= 20

---

## Quick Start

```bash
# 1. Authenticate
stripe-pulse login

# 2. Check your MRR
stripe-pulse mrr

# 3. Full dashboard
stripe-pulse dashboard
```

That's it. Your SaaS metrics are live.

---

## All Commands

### Auth

| Command | Description |
|---------|-------------|
| `login` | Save a Stripe API key (interactive) |
| `logout` | Remove saved credentials |
| `switch <profile>` | Switch the active profile |
| `whoami` | Show current profile and account |
| `doctor` | Run diagnostic checks |

### Core Metrics

| Command | Description |
|---------|-------------|
| `mrr` | Monthly Recurring Revenue |
| `arr` | Annual Recurring Revenue |
| `customers` | Customer count by status |
| `arpu` | Average Revenue Per User |
| `ltv` | Customer Lifetime Value |
| `plans` | Revenue breakdown by plan |
| `trials` | Trial conversion metrics |

### Period-Based Metrics

These accept `--from` and `--to` (ISO 8601 dates). Default: last 30 days.

| Command | Description |
|---------|-------------|
| `churn` | Customer churn rate |
| `revenue-churn` | MRR churn rate |
| `nrr` | Net Revenue Retention |
| `quick-ratio` | SaaS Quick Ratio |
| `movements` | MRR movement breakdown |

### Customer Lists

| Command | Description |
|---------|-------------|
| `new-customers` | New customers in a period |
| `churned` | Recently churned customers |
| `active` | All active customers |

### Dashboard

| Command | Description |
|---------|-------------|
| `dashboard` | Full metrics dashboard (all of the above in one command) |

---

## Output Modes

Every command supports multiple output formats:

| Flag | Output |
|------|--------|
| *(default)* | Human-readable, colored terminal output |
| `--json` | Machine-readable JSON (pretty-printed) |
| `--format csv` | CSV (pipe-friendly) |
| `--format markdown` | Markdown table |
| `--verbose` | Extended output with additional context |
| `--chart` | MRR trend line chart + movements waterfall, plan breakdown bars |

**Auto-JSON:** When stdout is piped (not a TTY), JSON mode is automatic. No flag needed.

**`--chart` example:**
```bash
stripe-pulse mrr --chart
# Shows: 6-month MRR trend line, sparkline, movements waterfall with growth %

stripe-pulse plans --chart
# Shows: horizontal bar chart of revenue by plan
```

```bash
# These all output JSON
stripe-pulse mrr --json
stripe-pulse mrr --quiet
stripe-pulse mrr | jq .mrr
```

---

## Multi-Account

stripe-pulse supports named profiles for managing multiple Stripe accounts:

```bash
# Login to each account with a profile name
stripe-pulse login --profile personal
stripe-pulse login --profile company

# Switch the active profile
stripe-pulse switch personal
stripe-pulse switch company

# Query a specific account (without switching)
stripe-pulse mrr --profile personal
stripe-pulse dashboard --profile company

# Use env var for scripts
STRIPE_PULSE_PROFILE=company stripe-pulse mrr --json
```

Profiles are stored in `~/.config/stripe-pulse/credentials.json` with permissions `0600`.

---

## Benchmarks

The human output includes benchmark context next to some metrics:

```
Churn      5.2%   ⚠ High (>5%)
NRR       104.2%  ✓ Good (>100%)
Quick      2.8    ✓ Healthy (>1)
```

These are reference strings only. They don't appear in `--json` output. The raw numbers are always in the JSON for you to interpret.

Benchmark ranges used:
- **Churn**: Excellent <3% · Good 3-5% · Median 5-7% · Above average 7-10% · High >10%
- **NRR**: Best-in-class >130% · Strong 110-130% · Healthy ≥100% · Shrinking <100% · Critical <90%
- **Quick Ratio**: Very healthy >4 · Good 2-4 · Fragile 1-2 · Losing <1
- **Revenue Churn**: Excellent <2% · Average 2-5% · Needs attention >5%

---

## Configuration

Config lives at `~/.config/stripe-pulse/` (Linux/macOS) or `%APPDATA%\stripe-pulse\` (Windows).

| File | Contents |
|------|----------|
| `credentials.json` | API keys and profiles (mode 0600) |

Auth chain (highest priority first):
1. `--api-key <key>` flag
2. `STRIPE_API_KEY` environment variable
3. Saved profile in credentials file

Supports both full API keys (`sk_live_*`, `sk_test_*`) and restricted keys (`rk_live_*`, `rk_test_*`).

---

## Performance

stripe-pulse fetches subscription data directly from Stripe's API on every run. There's no local database — metrics are always real-time.

- **< 500 subscriptions:** ~2-3 seconds (most indie SaaS)
- **500-2,000 subscriptions:** ~5-10 seconds
- **2,000-10,000 subscriptions:** ~15-30 seconds
- **> 10,000 subscriptions:** Not recommended — consider a dedicated analytics platform

The `dashboard` command is the most efficient call — it batches all API requests in parallel.

---

## AI Agent Integration

stripe-pulse is designed for AI agent use. Every command outputs clean JSON, every error has a structured format, and exit codes are consistent.

**Install the agent skill:**
```bash
npx skills add progrmoiz/stripe-pulse
```

This installs the [SKILL.md](SKILL.md) into your AI agent (Claude Code, Cursor, etc.) so it knows how to use stripe-pulse automatically.

```bash
# Check MRR in a script or AI workflow
stripe-pulse mrr --json | jq .mrr

# Get all metrics in one call
stripe-pulse dashboard --json

# Diagnose setup issues
stripe-pulse doctor --json
```

---

## vs. Alternatives

| | stripe-pulse | Baremetrics | ChartMogul | ProfitWell |
|--|--|--|--|--|
| **Price** | Free | $129/mo | $199/mo | Free (limited) |
| **Open source** | Yes | No | No | No |
| **Privacy** | Local only | Your data on their servers | Your data on their servers | Your data on their servers |
| **CLI** | Yes | No | No | No |
| **Multi-account** | Yes (profiles) | No | Paid | No |
| **AI agent ready** | Yes (JSON + SKILL.md) | No | No | No |
| **Setup** | 30 seconds | Integration + wait | Integration + wait | Integration |

---

## Contributing

1. Fork the repo
2. `npm install`
3. `npm run dev -- mrr` to run in dev mode
4. `npm run build` to build

Bug reports and PRs welcome at [github.com/progrmoiz/stripe-pulse/issues](https://github.com/progrmoiz/stripe-pulse/issues).

---

## License

MIT — see [LICENSE](LICENSE)
