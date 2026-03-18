import { Command } from '@commander-js/extra-typings'
import { VERSION, CLI_NAME } from './lib/constants.js'
import type { GlobalOpts } from './lib/config.js'
import { banner } from './lib/banner.js'
import { makeLoginCommand } from './commands/login.js'
import { makeLogoutCommand } from './commands/logout.js'
import { makeWhoamiCommand } from './commands/whoami.js'
import { makeDoctorCommand } from './commands/doctor.js'
import { makeMrrCommand } from './commands/mrr.js'
import { makeArrCommand } from './commands/arr.js'
import { makeCustomersCommand } from './commands/customers.js'
import { makeArpuCommand } from './commands/arpu.js'
import { makeLtvCommand } from './commands/ltv.js'
import { makePlansCommand } from './commands/plans.js'
import { makeTrialsCommand } from './commands/trials.js'
import { makeChurnCommand } from './commands/churn.js'
import { makeRevenueChurnCommand } from './commands/revenue-churn.js'
import { makeNrrCommand } from './commands/nrr.js'
import { makeQuickRatioCommand } from './commands/quick-ratio.js'
import { makeMovementsCommand } from './commands/movements.js'
import { makeNewCustomersCommand } from './commands/new-customers.js'
import { makeChurnedCommand } from './commands/churned.js'
import { makeActiveCommand } from './commands/active.js'
import { makeDashboardCommand } from './commands/dashboard.js'
import { makeSwitchCommand } from './commands/switch.js'

const program = new Command()
  .name(CLI_NAME)
  .version(VERSION, '-v, --version', 'Output the current version')
  .description('Your Stripe metrics in one command. Vital signs for your SaaS.')
  .addHelpText(
    'after',
    `
Examples:
  stripe-pulse login                  Authenticate with your Stripe API key
  stripe-pulse whoami                 Show current profile and account info
  stripe-pulse doctor                 Run diagnostic checks
  stripe-pulse mrr                    Show Monthly Recurring Revenue
  stripe-pulse arr                    Show Annual Recurring Revenue
  stripe-pulse customers              Show customer metrics
`
  )
  .option('--api-key <key>', 'Override API key for this request')
  .option('-p, --profile <name>', 'Select credentials profile')
  .option('--json', 'Force JSON output (machine-readable)')
  .option('-q, --quiet', 'Suppress all stderr output, implies --json')
  .option('--from <date>', 'Start date for range queries (ISO 8601)')
  .option('--to <date>', 'End date for range queries (ISO 8601)')
  .option('--format <type>', 'Output format: json, csv, or markdown')
  .option('--verbose', 'Show extended output with additional metrics')
  .option('--chart', 'Show ASCII chart where available')

// Helper to read global opts from the root program at action time.
function getGlobalOpts(): GlobalOpts {
  const opts = program.opts() as {
    apiKey?: string
    profile?: string
    json?: boolean
    quiet?: boolean
    from?: string
    to?: string
    format?: string
    verbose?: boolean
    chart?: boolean
  }
  return {
    apiKey: opts.apiKey,
    profile: opts.profile,
    json: opts.json,
    quiet: opts.quiet,
    from: opts.from,
    to: opts.to,
    format: opts.format as GlobalOpts['format'],
    verbose: opts.verbose,
    chart: opts.chart,
  }
}

// Auth commands
program.addCommand(makeLoginCommand(getGlobalOpts))
program.addCommand(makeLogoutCommand(getGlobalOpts))
program.addCommand(makeSwitchCommand(getGlobalOpts))

// Utility commands
program.addCommand(makeWhoamiCommand(getGlobalOpts))
program.addCommand(makeDoctorCommand(getGlobalOpts))

// Metric commands — core 8
program.addCommand(makeMrrCommand(getGlobalOpts))
program.addCommand(makeArrCommand(getGlobalOpts))
program.addCommand(makeCustomersCommand(getGlobalOpts))
program.addCommand(makeArpuCommand(getGlobalOpts))
program.addCommand(makeLtvCommand(getGlobalOpts))
program.addCommand(makePlansCommand(getGlobalOpts))
program.addCommand(makeTrialsCommand(getGlobalOpts))

// Metric commands — period-based 5
program.addCommand(makeChurnCommand(getGlobalOpts))
program.addCommand(makeRevenueChurnCommand(getGlobalOpts))
program.addCommand(makeNrrCommand(getGlobalOpts))
program.addCommand(makeQuickRatioCommand(getGlobalOpts))
program.addCommand(makeMovementsCommand(getGlobalOpts))

// Customer list commands
program.addCommand(makeNewCustomersCommand(getGlobalOpts))
program.addCommand(makeChurnedCommand(getGlobalOpts))
program.addCommand(makeActiveCommand(getGlobalOpts))

// Hero dashboard command
program.addCommand(makeDashboardCommand(getGlobalOpts))

// Default action: show banner + help when run with no args
if (process.argv.length <= 2) {
  process.stderr.write(banner() + '\n\n')
  program.help()
} else {
  program.parse(process.argv)
}
