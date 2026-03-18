# stripe-pulse — AI Agent Skill

## Tool Overview

`stripe-pulse` is a CLI that turns your Stripe account into a real-time SaaS metrics dashboard. It calculates MRR, ARR, churn, LTV, NRR, quick ratio, MRR movements, and more — directly from your Stripe subscriptions.

- **npm**: `npx stripe-pulse` (no install) or `npm install -g stripe-pulse`
- **Node.js**: >= 20 required
- **Config directory**: `~/.config/stripe-pulse/`

---

## Authentication

stripe-pulse uses a three-tier auth chain (highest priority wins):

1. `--api-key <key>` flag on any command
2. `STRIPE_API_KEY` environment variable
3. Credentials file at `~/.config/stripe-pulse/credentials.json` (set via `stripe-pulse login`)

For multi-account setups, use named profiles:
- `stripe-pulse login --profile production`
- `stripe-pulse mrr --profile production`
- `STRIPE_PULSE_PROFILE=production stripe-pulse mrr`

The active profile is stored in the credentials file and can be switched per-command with `--profile`.

---

## All Commands

### Auth Commands

| Command | Description |
|---------|-------------|
| `login` | Authenticate with a Stripe API key (interactive prompt) |
| `logout` | Remove saved credentials for the active profile |
| `whoami` | Show the current profile and Stripe account info |
| `doctor` | Run diagnostic checks on the CLI setup |

### Core Metric Commands

| Command | Description |
|---------|-------------|
| `mrr` | Monthly Recurring Revenue |
| `arr` | Annual Recurring Revenue |
| `customers` | Customer count by status (active, trialing, past due) |
| `arpu` | Average Revenue Per User |
| `ltv` | Customer Lifetime Value |
| `plans` | Revenue breakdown by plan |
| `trials` | Trial conversion metrics |

### Period-Based Commands (support `--from` / `--to`)

| Command | Description |
|---------|-------------|
| `churn` | Customer churn rate for a period |
| `revenue-churn` | Revenue (MRR) churn rate for a period |
| `nrr` | Net Revenue Retention |
| `quick-ratio` | SaaS Quick Ratio (growth quality) |
| `movements` | MRR movement breakdown (new, expansion, contraction, churned, reactivation) |

### Customer List Commands

| Command | Description |
|---------|-------------|
| `new-customers` | List new customers in a period |
| `churned` | List recently churned customers |
| `active` | List all active customers |

### Dashboard

| Command | Description |
|---------|-------------|
| `dashboard` | Full SaaS metrics dashboard — all metrics in one command |

---

## Global Flags

These flags work on every command:

| Flag | Description |
|------|-------------|
| `--api-key <key>` | Override API key for this request |
| `-p, --profile <name>` | Select credentials profile |
| `--json` | Force JSON output (machine-readable) |
| `-q, --quiet` | Suppress all stderr output, implies `--json` |
| `--from <date>` | Start date for period queries (ISO 8601: YYYY-MM-DD) |
| `--to <date>` | End date for period queries (ISO 8601: YYYY-MM-DD) |
| `--format <type>` | Output format: `json`, `csv`, or `markdown` |
| `--verbose` | Extended output with additional context |
| `--chart` | Show ASCII chart where available |
| `-v, --version` | Show version number |

---

## JSON Output Schemas

**Best practice: always use `--json` for machine consumption.** When stdout is piped (not a TTY), JSON mode is automatic.

### `mrr --json`
```json
{
  "mrr": 2900.00,
  "arr": 34800.00,
  "currency": "usd",
  "activeSubscriptions": 100,
  "breakdown": [
    {
      "productId": "prod_xxx",
      "productName": "Pro",
      "priceId": "price_xxx",
      "nickname": "Pro Monthly",
      "interval": "month",
      "mrr": 2900.00,
      "subscriptionCount": 100
    }
  ]
}
```

### `arr --json`
```json
{
  "arr": 34800.00,
  "mrr": 2900.00,
  "currency": "usd",
  "activeSubscriptions": 100
}
```

### `customers --json`
```json
{
  "totalCustomers": 120,
  "activeSubscribers": 100,
  "trialingCustomers": 15,
  "pastDueCustomers": 5
}
```

### `arpu --json`
```json
{
  "arpu": 29.00,
  "mrr": 2900.00,
  "activeSubscribers": 100,
  "currency": "usd"
}
```

### `ltv --json`
```json
{
  "ltv": 290.00,
  "arpu": 29.00,
  "monthlyChurnRate": 10.0,
  "avgLifespanMonths": 10.0,
  "currency": "usd"
}
```

### `plans --json`
```json
[
  {
    "productId": "prod_xxx",
    "productName": "Pro",
    "priceId": "price_xxx",
    "nickname": "Pro Monthly",
    "interval": "month",
    "mrr": 2900.00,
    "subscriptionCount": 100
  }
]
```

### `trials --json`
```json
{
  "period": { "start": "2026-01-01", "end": "2026-03-18" },
  "conversionRate": 72.5,
  "trialsStarted": 40,
  "trialsConverted": 29
}
```

### `churn --json`
```json
{
  "period": { "start": "2026-02-16", "end": "2026-03-18" },
  "customerChurnRate": 5.2,
  "customersAtStart": 96,
  "customersLost": 5,
  "currency": "usd"
}
```

### `revenue-churn --json`
```json
{
  "period": { "start": "2026-02-16", "end": "2026-03-18" },
  "revenueChurnRate": 3.4,
  "mrrAtStart": 2784.00,
  "mrrLost": 94.00,
  "currency": "usd"
}
```

### `nrr --json`
```json
{
  "period": { "start": "2026-02-16", "end": "2026-03-18" },
  "nrr": 104.2,
  "startingMrr": 2784.00,
  "expansionMrr": 290.00,
  "contractionMrr": 58.00,
  "churnedMrr": 94.00,
  "currency": "usd"
}
```

### `quick-ratio --json`
```json
{
  "quickRatio": 2.8,
  "newMrr": 290.00,
  "expansionMrr": 87.00,
  "churnedMrr": 94.00,
  "contractionMrr": 58.00,
  "currency": "usd"
}
```

### `movements --json`
```json
{
  "period": { "start": "2026-02-16", "end": "2026-03-18" },
  "newMrr": 290.00,
  "expansionMrr": 87.00,
  "contractionMrr": 58.00,
  "churnedMrr": 94.00,
  "reactivationMrr": 29.00,
  "netNewMrr": 254.00,
  "currency": "usd"
}
```

### `new-customers --json` / `churned --json` / `active --json`
```json
{
  "period": { "start": "2026-02-16", "end": "2026-03-18" },
  "count": 10,
  "totalMrr": 290.00,
  "customers": [
    {
      "customerId": "cus_xxx",
      "email": "user@example.com",
      "name": "Jane Smith",
      "subscriptionId": "sub_xxx",
      "status": "active",
      "plan": "Pro",
      "interval": "month",
      "mrr": 29.00,
      "created": "2026-03-01",
      "canceledAt": null,
      "currency": "usd"
    }
  ]
}
```

### `dashboard --json`
```json
{
  "mrr": 2900.00,
  "arr": 34800.00,
  "activeSubscribers": 100,
  "arpu": 29.00,
  "customerChurnRate": 5.2,
  "revenueChurnRate": 3.4,
  "ltv": 290.00,
  "nrr": 104.2,
  "quickRatio": 2.8,
  "trialConversionRate": 72.5,
  "mrrByPlan": [
    {
      "productId": "prod_xxx",
      "productName": "Pro",
      "priceId": "price_xxx",
      "nickname": "Pro Monthly",
      "interval": "month",
      "mrr": 2900.00,
      "subscriptionCount": 100
    }
  ],
  "currency": "usd",
  "dataAsOf": "2026-03-18T12:00:00.000Z"
}
```

### `doctor --json`
```json
{
  "ok": true,
  "checks": [
    {
      "name": "CLI Version",
      "status": "pass",
      "message": "v0.1.0"
    },
    {
      "name": "Node.js",
      "status": "pass",
      "message": "v22.0.0",
      "detail": "Meets minimum requirement (>=20)"
    },
    {
      "name": "Config File",
      "status": "pass",
      "message": "Found",
      "detail": "Active profile: default"
    },
    {
      "name": "API Key",
      "status": "pass",
      "message": "Configured (sk_liv...wxyz)",
      "detail": "Source: credentials file · Profile: default"
    },
    {
      "name": "Stripe Connection",
      "status": "pass",
      "message": "Connected (312ms)",
      "detail": "Account ID: acct_xxx"
    },
    {
      "name": "Account Info",
      "status": "pass",
      "message": "Acme Corp",
      "detail": "ID: acct_xxx"
    }
  ]
}
```

---

## Exit Codes

| Code | Meaning | When |
|------|---------|------|
| `0` | Success | Command completed normally |
| `1` | API error | Stripe API call failed, network error, calculation error |
| `2` | Auth error | No API key configured, key invalid |
| `3` | Validation error | Invalid date format, bad option value |

---

## Common Workflows

### Check MRR
```bash
stripe-pulse mrr --json
# Returns: { "mrr": 2900.00, "arr": 34800.00, ... }

stripe-pulse mrr --json | jq .mrr
# Returns: 2900
```

### Get Full Dashboard
```bash
stripe-pulse dashboard --json
# Returns: complete SaasDashboard object with all metrics
```

### Check Churn for a Specific Period
```bash
stripe-pulse churn --from 2026-01-01 --to 2026-01-31 --json
# Returns: { "customerChurnRate": 4.2, "customersLost": 4, ... }
```

### Check Revenue Churn
```bash
stripe-pulse revenue-churn --from 2026-01-01 --to 2026-01-31 --json
```

### List Churned Customers
```bash
stripe-pulse churned --from 2026-01-01 --to 2026-01-31 --json
# Returns: { "count": 4, "customers": [...] }
```

### List New Customers
```bash
stripe-pulse new-customers --from 2026-01-01 --to 2026-01-31 --json
```

### Compare Plans
```bash
stripe-pulse plans --json
# Returns: array of MrrByPlan objects sorted by MRR
```

### Check NRR
```bash
stripe-pulse nrr --from 2026-01-01 --to 2026-03-31 --json
# Returns: { "nrr": 104.2, ... } — above 100 means expansion revenue
```

### Check Quick Ratio
```bash
stripe-pulse quick-ratio --json
# Returns: { "quickRatio": 2.8, ... } — >4 is excellent, >1 is healthy
```

### Check MRR Movements
```bash
stripe-pulse movements --from 2026-02-01 --to 2026-02-28 --json
# Returns: new/expansion/contraction/churn/reactivation breakdown
```

### Use with Multiple Accounts
```bash
# Login to two accounts
stripe-pulse login --profile personal
stripe-pulse login --profile company

# Query each account
stripe-pulse mrr --profile personal --json
stripe-pulse mrr --profile company --json

# Switch the default
stripe-pulse login  # re-run to update default profile
```

### Pipe into jq
```bash
# Get just the MRR value
stripe-pulse mrr --json | jq .mrr

# Get dashboard and extract churn rate
stripe-pulse dashboard --json | jq .customerChurnRate

# Get customer list and filter by MRR
stripe-pulse active --json | jq '.customers[] | select(.mrr > 100)'
```

### Diagnose Setup Issues
```bash
stripe-pulse doctor --json
# Returns: { "ok": true/false, "checks": [...] }
```

---

## Best Practices for AI Agents

1. **Always use `--json`** for programmatic output. When stdout is piped (non-TTY), JSON mode is automatic.
2. **Use `--quiet` (`-q`)** to suppress spinner/status output on stderr when you don't want any noise.
3. **Use `--from` / `--to`** for period-based metrics. Default is the last 30 days.
4. **Use `--profile`** to query a specific Stripe account without modifying the active profile.
5. **Check exit codes** — non-zero exit means something went wrong; parse `stderr` for the error JSON when `--json` is set.
6. **`doctor --json`** is the right first step when diagnosing auth or connectivity issues — it returns structured check results.
7. **`dashboard --json`** is the single most efficient call — it fetches all data in one parallel batch and returns every metric.

---

## Notes on Metric Calculations

- **MRR**: Sum of monthly-normalized revenue from all active subscriptions. Annual subscriptions divided by 12.
- **Churn rate**: `customersLost / customersAtStart * 100`. Period defaults to last 30 days.
- **NRR**: `(startMRR + expansion - contraction - churn) / startMRR * 100`. Above 100% means growth.
- **Quick Ratio**: `(newMRR + expansionMRR) / (churnedMRR + contractionMRR)`. Above 4 = excellent growth efficiency.
- **LTV**: `ARPU / monthlyChurnRate`. Returns `null` if churn rate is 0 (infinite LTV).
- **Benchmarks** shown in human output are context strings only (e.g., "Good (2-8%)") — they are NOT included in JSON output.
- All currency values are in the account's primary currency (usually USD). `currency` field is always lowercase (e.g., `"usd"`).
