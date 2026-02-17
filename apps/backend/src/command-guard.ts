/**
 * Command Guard — Security layer for sandbox command execution.
 *
 * Validates, sanitises, and optionally AI-reviews every command before it runs
 * in the sandbox. Prevents:
 *
 * - Destructive commands   (rm -rf /, mkfs, dd, format, etc.)
 * - Shell injection         (back-ticks, $(), eval, etc.)
 * - Hanging commands        (long-running servers without `background` flag)
 * - Network exfiltration    (curl to external IPs, wget, nc, etc.)
 * - Privilege escalation    (sudo, su, chown root, chmod 777, etc.)
 * - Resource exhaustion     (fork bombs, yes | ..., etc.)
 *
 * The guard is configurable via the `execution.commandGuard` settings key.
 */

import type { Application } from './declarations'
import { parseMaybeJson } from './utils'

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type GuardVerdict = {
  allowed: boolean
  /** Human-readable reason when blocked. */
  reason?: string
  /** Original command, potentially rewritten by the sanitiser. */
  sanitised: string
  /** Which rule triggered the block, if any. */
  rule?: string
  /** When true the guard auto-promoted this command to background execution. */
  promotedToBackground?: boolean
  /** Suggested readyPattern when auto-promoting to background. */
  suggestedReadyPattern?: string
}

export type CommandGuardSettings = {
  /** Master-switch. When false the guard is completely skipped. Default true. */
  enabled?: boolean
  /** Block known-dangerous commands (rm -rf /, mkfs …). Default true. */
  blockDestructive?: boolean
  /** Block hanging commands (node server.js w/o background). Default true. */
  blockHanging?: boolean
  /** Block network exfiltration patterns. Default true. */
  blockNetworkExfil?: boolean
  /** Block privilege escalation patterns. Default true. */
  blockPrivilegeEsc?: boolean
  /** Block shell injection vectors. Default true. */
  blockShellInjection?: boolean
  /** User-defined deny-list (regex strings). */
  customDenyPatterns?: string[]
  /** User-defined allow-list — matching commands bypass deny checks. */
  customAllowPatterns?: string[]
  /** Optional: use AI provider to validate command before execution. */
  aiReview?: boolean
}

/* -------------------------------------------------------------------------- */
/*  Built-in deny rules                                                       */
/* -------------------------------------------------------------------------- */

interface DenyRule {
  id: string
  /** Which setting flag enables this rule. */
  category: keyof Pick<
    CommandGuardSettings,
    'blockDestructive' | 'blockHanging' | 'blockNetworkExfil' | 'blockPrivilegeEsc' | 'blockShellInjection'
  >
  pattern: RegExp
  reason: string
}

const DENY_RULES: DenyRule[] = [
  /* ── Destructive ────────────────────────────────────────────────────── */
  {
    id: 'rm-rf-root',
    category: 'blockDestructive',
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force\s+--recursive|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|~\/?\s|\.\.\/)/i,
    reason: 'Recursive forced delete targeting root, home, or parent directory'
  },
  {
    id: 'rm-rf-wildcard',
    category: 'blockDestructive',
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force\s+--recursive)\s+\*/i,
    reason: 'Recursive forced delete with glob wildcard'
  },
  {
    id: 'mkfs',
    category: 'blockDestructive',
    pattern: /\bmkfs\b/i,
    reason: 'Filesystem formatting command'
  },
  {
    id: 'dd-of',
    category: 'blockDestructive',
    pattern: /\bdd\b.*\bof=\/dev\//i,
    reason: 'Low-level disk write via dd'
  },
  {
    id: 'shred',
    category: 'blockDestructive',
    pattern: /\bshred\b/i,
    reason: 'File shredding command'
  },
  {
    id: 'wipefs',
    category: 'blockDestructive',
    pattern: /\bwipefs\b/i,
    reason: 'Filesystem metadata wipe'
  },

  /* ── Hanging / long-running ─────────────────────────────────────────── */
  {
    id: 'node-server-file',
    category: 'blockHanging',
    pattern: /\bnode\s+(?!.*--eval)(?!.*-e\b)\S+\.(js|ts|mjs|cjs)\b/i,
    reason: 'Running a Node.js file directly often starts a long-running server. Use background=true with a readyPattern if intentional.'
  },
  {
    id: 'npm-start',
    category: 'blockHanging',
    pattern: /\bnpm\s+start\b/i,
    reason: '`npm start` typically starts a long-running server. Mark the step as background=true with an appropriate readyPattern.'
  },
  {
    id: 'npm-run-dev',
    category: 'blockHanging',
    pattern: /\bnpm\s+run\s+(dev|serve|watch)\b/i,
    reason: 'Dev/serve/watch scripts are long-running. Mark the step as background=true with a readyPattern.'
  },
  {
    id: 'yarn-start-dev',
    category: 'blockHanging',
    pattern: /\byarn\s+(start|dev|serve)\b/i,
    reason: 'yarn start/dev/serve are long-running. Mark the step as background=true with a readyPattern.'
  },
  {
    id: 'pnpm-start-dev',
    category: 'blockHanging',
    pattern: /\bpnpm\s+(start|dev|serve)\b/i,
    reason: 'pnpm start/dev/serve are long-running. Mark the step as background=true with a readyPattern.'
  },
  {
    id: 'python-server',
    category: 'blockHanging',
    pattern: /\bpython[23]?\s+.*\b(server|app|manage\.py\s+runserver)\b/i,
    reason: 'Python server command detected. Mark the step as background=true if intentional.'
  },
  {
    id: 'tail-f',
    category: 'blockHanging',
    pattern: /\btail\s+(-[a-zA-Z]*f|--follow)\b/i,
    reason: 'tail -f never terminates. Use `tail -n` to get last N lines instead.'
  },
  {
    id: 'sleep-large',
    category: 'blockHanging',
    pattern: /\bsleep\s+(\d{4,}|infinity)\b/i,
    reason: 'Excessive sleep duration detected'
  },
  {
    id: 'yes-pipe',
    category: 'blockHanging',
    pattern: /\byes\b/i,
    reason: '`yes` produces infinite output and can exhaust resources'
  },
  {
    id: 'cat-no-file',
    category: 'blockHanging',
    pattern: /^\s*cat\s*$/i,
    reason: 'Bare `cat` reads from stdin and will hang indefinitely'
  },

  /* ── Network exfiltration ───────────────────────────────────────────── */
  {
    id: 'curl-upload',
    category: 'blockNetworkExfil',
    pattern: /\bcurl\b.*(-F\b|--upload-file|-T\b|--data.*@)/i,
    reason: 'curl with file upload detected — potential data exfiltration'
  },
  {
    id: 'nc-listen',
    category: 'blockNetworkExfil',
    pattern: /\b(nc|ncat|netcat)\b.*(-l|-e|-c)/i,
    reason: 'Netcat with listen/exec mode — potential reverse shell'
  },
  {
    id: 'wget-post',
    category: 'blockNetworkExfil',
    pattern: /\bwget\b.*--post/i,
    reason: 'wget with POST data — potential data exfiltration'
  },
  {
    id: 'scp-rsync-ext',
    category: 'blockNetworkExfil',
    pattern: /\b(scp|rsync)\b.*@/i,
    reason: 'Remote copy commands targeting external hosts'
  },

  /* ── Privilege escalation ───────────────────────────────────────────── */
  {
    id: 'sudo',
    category: 'blockPrivilegeEsc',
    pattern: /\bsudo\b/i,
    reason: 'sudo — privilege escalation not allowed in sandbox'
  },
  {
    id: 'su-root',
    category: 'blockPrivilegeEsc',
    pattern: /\bsu\s+(root|-)\b/i,
    reason: 'su to root — privilege escalation not allowed'
  },
  {
    id: 'chmod-dangerous',
    category: 'blockPrivilegeEsc',
    pattern: /\bchmod\s+([0-7]*7[0-7]{2}|[augo]*\+[rwxst]*s)/i,
    reason: 'Dangerous chmod (world-writable or setuid/setgid)'
  },
  {
    id: 'chown-root',
    category: 'blockPrivilegeEsc',
    pattern: /\bchown\s+(root|0)\b/i,
    reason: 'chown to root — not allowed in sandbox'
  },

  /* ── Shell injection ────────────────────────────────────────────────── */
  {
    id: 'eval-exec',
    category: 'blockShellInjection',
    pattern: /\beval\s/i,
    reason: 'eval can execute arbitrary injected code'
  },
  {
    id: 'backtick-injection',
    category: 'blockShellInjection',
    pattern: /`[^`]*`/,
    reason: 'Back-tick command substitution — use $() instead or avoid injection vectors'
  },
  {
    id: 'fork-bomb',
    category: 'blockShellInjection',
    pattern: /:\(\)\s*\{\s*:\|:&\s*\}/,
    reason: 'Fork bomb detected'
  },
  {
    id: 'base64-decode-pipe',
    category: 'blockShellInjection',
    pattern: /\bbase64\s+(-d|--decode)\b.*\|\s*(sh|bash|zsh)/i,
    reason: 'base64-decoded payload piped to shell — obfuscated code execution'
  },
  {
    id: 'curl-pipe-shell',
    category: 'blockShellInjection',
    pattern: /\bcurl\b[^|]*\|\s*(sh|bash|zsh|source)\b/i,
    reason: 'Piping remote content directly to shell'
  },
  {
    id: 'wget-pipe-shell',
    category: 'blockShellInjection',
    pattern: /\bwget\b[^|]*\|\s*(sh|bash|zsh|source)\b/i,
    reason: 'Piping remote download directly to shell'
  }
]

/* -------------------------------------------------------------------------- */
/*  Settings resolver                                                         */
/* -------------------------------------------------------------------------- */

const DEFAULT_GUARD_SETTINGS: Required<
  Omit<CommandGuardSettings, 'customDenyPatterns' | 'customAllowPatterns' | 'aiReview'>
> & { customDenyPatterns: string[]; customAllowPatterns: string[]; aiReview: boolean } = {
  enabled: true,
  blockDestructive: true,
  blockHanging: true,
  blockNetworkExfil: true,
  blockPrivilegeEsc: true,
  blockShellInjection: true,
  customDenyPatterns: [],
  customAllowPatterns: [],
  aiReview: false
}

export const resolveGuardSettings = async (
  app: Application,
  projectId: number
): Promise<Required<CommandGuardSettings>> => {
  try {
    const rows = await app.service('settings').find({
      query: { key: 'execution', projectId, $limit: 1 },
      paginate: false
    })
    const row = Array.isArray(rows) ? rows[0] : (rows as any)?.data?.[0]
    const execution = parseMaybeJson(row?.value)

    if (execution && typeof execution === 'object' && (execution as any).commandGuard) {
      const cg = (execution as any).commandGuard as CommandGuardSettings
      return {
        enabled: cg.enabled ?? DEFAULT_GUARD_SETTINGS.enabled,
        blockDestructive: cg.blockDestructive ?? DEFAULT_GUARD_SETTINGS.blockDestructive,
        blockHanging: cg.blockHanging ?? DEFAULT_GUARD_SETTINGS.blockHanging,
        blockNetworkExfil: cg.blockNetworkExfil ?? DEFAULT_GUARD_SETTINGS.blockNetworkExfil,
        blockPrivilegeEsc: cg.blockPrivilegeEsc ?? DEFAULT_GUARD_SETTINGS.blockPrivilegeEsc,
        blockShellInjection: cg.blockShellInjection ?? DEFAULT_GUARD_SETTINGS.blockShellInjection,
        customDenyPatterns: cg.customDenyPatterns ?? DEFAULT_GUARD_SETTINGS.customDenyPatterns,
        customAllowPatterns: cg.customAllowPatterns ?? DEFAULT_GUARD_SETTINGS.customAllowPatterns,
        aiReview: cg.aiReview ?? DEFAULT_GUARD_SETTINGS.aiReview
      }
    }
  } catch {
    /* fallback to defaults */
  }

  return { ...DEFAULT_GUARD_SETTINGS }
}

/* -------------------------------------------------------------------------- */
/*  AI review (optional second-opinion from a model)                          */
/* -------------------------------------------------------------------------- */

const AI_REVIEW_SYSTEM_PROMPT = `You are a security reviewer for an autonomous coding agent sandbox.
You will receive a shell command that the agent wants to execute inside a sandboxed workspace.
Evaluate it for safety and respond with JSON only:

{
  "safe": true/false,
  "reason": "Brief explanation"
}

Rules:
- Commands that read/write within the project directory are usually safe.
- Commands that install packages (npm install, pip install) are usually safe.
- Commands that run tests, linters, or build tools are safe.
- Commands that start long-running processes (servers) are dangerous unless proven background-aware.
- Commands that delete files outside the project, access /etc, /root, system binaries are dangerous.
- Commands that open network connections to external IPs for uploading data are dangerous.
- Commands that escalate privileges (sudo, su) are dangerous.
- Any obfuscated command (base64 decode to shell) is dangerous.
- Be conservative: if unsure, mark as unsafe.
`

const aiReviewCommand = async (
  app: Application,
  projectId: number,
  command: string,
  isBackground: boolean
): Promise<{ safe: boolean; reason: string }> => {
  try {
    const { getAIProviderForRole } = await import('./ai-provider')
    const provider = await getAIProviderForRole(app, projectId, 'guard')

    const result = await provider.chat(
      [
        { role: 'system', content: AI_REVIEW_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Command: ${command}\nBackground: ${isBackground}\n\nIs this command safe to execute in the sandbox?`
        }
      ],
      { temperature: 0, maxTokens: 256, jsonMode: true }
    )

    const parsed = parseMaybeJson(result.content)
    if (parsed && typeof parsed === 'object' && 'safe' in (parsed as any)) {
      return { safe: !!(parsed as any).safe, reason: String((parsed as any).reason || '') }
    }

    return { safe: false, reason: 'AI review response could not be parsed — blocking by default' }
  } catch (error: any) {
    return { safe: true, reason: `AI review failed (${error?.message || 'unknown error'}) — allowing by default` }
  }
}

/* -------------------------------------------------------------------------- */
/*  Ready-pattern heuristic for auto-promoted background commands             */
/* -------------------------------------------------------------------------- */

const guessReadyPattern = (command: string): string => {
  if (/\bnext\b/i.test(command)) return 'ready on|started server'
  if (/\bvite\b|vue-cli-service\b/i.test(command)) return 'ready in|Local:'
  if (/\bnuxt\b/i.test(command)) return 'Listening on|Nitro started'
  if (/\bangular\b|ng\s+serve/i.test(command)) return 'compiled successfully|listening on'
  if (/\bdjango\b|manage\.py\s+runserver/i.test(command)) return 'Starting development server'
  if (/\bflask\b/i.test(command)) return 'Running on'
  if (/\brails\b/i.test(command)) return 'Listening on'
  if (/\btail\b.*-f/i.test(command)) return '.*' // any output = ready
  return 'listening on|ready|started|running'
}

/* -------------------------------------------------------------------------- */
/*  Heredoc-aware command sanitisation                                         */
/* -------------------------------------------------------------------------- */

/**
 * Strip heredoc bodies from a command string before running injection checks.
 * Quoted heredocs (<<'EOF', <<"EOF") don't perform shell expansion, so their
 * content is literal text — backticks, $(), etc. inside are NOT injection.
 * Unquoted heredocs DO expand, so we keep those for checking.
 */
const stripHeredocBodies = (cmd: string): string => {
  // Match  <<'DELIM'  or  <<"DELIM"  or <<-'DELIM' — quoted → safe, strip body
  // Also match  <<DELIM  (unquoted) — unsafe, keep body
  const lines = cmd.split('\n')
  const result: string[] = []
  let insideQuotedHeredoc = false
  let heredocDelimiter = ''

  for (const line of lines) {
    if (insideQuotedHeredoc) {
      if (line.trim() === heredocDelimiter) {
        insideQuotedHeredoc = false
        heredocDelimiter = ''
      }
      // Skip lines inside quoted heredoc body
      continue
    }

    // Detect heredoc start: <<'DELIM', <<"DELIM", <<-'DELIM', <<-"DELIM"
    const heredocMatch = line.match(/<<-?\s*['"]([^'"]+)['"]\s*$/)
    if (heredocMatch) {
      insideQuotedHeredoc = true
      heredocDelimiter = heredocMatch[1]!
      result.push(line) // keep the shell line itself (cat > file <<'EOF')
      continue
    }

    result.push(line)
  }

  return result.join('\n')
}

/**
 * Strip the content of quoted strings (single and double) so that
 * hanging-rule patterns don't false-match on string literals.
 * e.g. `node -e "...start:'node src/server.js'..."` → the inner `node src/server.js`
 * is just a JS string, not an actual command invocation.
 */
const stripQuotedStrings = (cmd: string): string => {
  // Double-quoted strings (respects backslash escapes): "..." → ""
  let result = cmd.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  // Single-quoted strings (no escaping in shell): '...' → ''
  result = result.replace(/'[^']*'/g, "''")
  return result
}

/* -------------------------------------------------------------------------- */
/*  Core guard function                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Validate a shell command against the security rules.
 *
 * @param command  The raw command string the AI agent wants to execute.
 * @param opts.isBackground  Whether the step is marked as background.
 * @param opts.app  Feathers application (for settings + AI review).
 * @param opts.projectId  Project context for settings resolution.
 */
export const guardCommand = async (
  command: string,
  opts: {
    isBackground?: boolean
    app: Application
    projectId: number
  }
): Promise<GuardVerdict> => {
  const settings = await resolveGuardSettings(opts.app, opts.projectId)

  if (!settings.enabled) {
    return { allowed: true, sanitised: command }
  }

  const trimmed = command.trim()

  // ── Allow-list takes precedence ──────────────────────────────────────
  if (settings.customAllowPatterns.length > 0) {
    for (const raw of settings.customAllowPatterns) {
      try {
        if (new RegExp(raw, 'i').test(trimmed)) {
          return { allowed: true, sanitised: trimmed, rule: `allow:${raw}` }
        }
      } catch {
        /* invalid regex — skip */
      }
    }
  }

  // ── Built-in deny rules ──────────────────────────────────────────────
  // For shell injection checks, strip heredoc bodies to avoid false positives
  const strippedForInjection = stripHeredocBodies(trimmed)
  // For hanging checks, strip quoted string content to avoid false matches
  // e.g. node -e "...start:'node src/server.js'..." should NOT trigger node-server-file
  const strippedForHanging = stripQuotedStrings(trimmed)

  for (const rule of DENY_RULES) {
    // Skip categories that are disabled
    if (!settings[rule.category]) continue

    // Hanging rules don't apply when step is marked as background
    if (rule.category === 'blockHanging' && opts.isBackground) continue

    // Use appropriately stripped text per category to avoid false positives
    const textToCheck =
      rule.category === 'blockShellInjection' ? strippedForInjection :
        rule.category === 'blockHanging' ? stripQuotedStrings(strippedForInjection) :
          trimmed

    if (rule.pattern.test(textToCheck)) {
      // Auto-promote hanging commands to background instead of blocking
      if (rule.category === 'blockHanging') {
        return {
          allowed: true,
          sanitised: trimmed,
          rule: rule.id,
          reason: `[${rule.id}] Auto-promoted to background: ${rule.reason}`,
          promotedToBackground: true,
          suggestedReadyPattern: guessReadyPattern(trimmed)
        }
      }

      return {
        allowed: false,
        sanitised: trimmed,
        reason: `[${rule.id}] ${rule.reason}`,
        rule: rule.id
      }
    }
  }

  // ── Custom deny patterns ─────────────────────────────────────────────
  for (const raw of settings.customDenyPatterns) {
    try {
      if (new RegExp(raw, 'i').test(trimmed)) {
        return {
          allowed: false,
          sanitised: trimmed,
          reason: `[custom] Blocked by custom deny pattern: ${raw}`,
          rule: `custom:${raw}`
        }
      }
    } catch {
      /* invalid regex — skip */
    }
  }

  // ── Optional AI review ───────────────────────────────────────────────
  if (settings.aiReview) {
    const review = await aiReviewCommand(opts.app, opts.projectId, trimmed, !!opts.isBackground)
    if (!review.safe) {
      return {
        allowed: false,
        sanitised: trimmed,
        reason: `[ai-review] ${review.reason}`,
        rule: 'ai-review'
      }
    }
  }

  return { allowed: true, sanitised: trimmed }
}
