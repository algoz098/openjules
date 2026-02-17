/**
 * AI Provider abstraction layer.
 *
 * Provides a uniform interface for interacting with multiple LLM providers
 * (OpenAI, Anthropic, Google Gemini, Groq).
 *
 * Each provider is accessed via native `fetch` — no heavy SDK dependencies.
 */

import type { Application } from './declarations'
import { parseMaybeJson } from './utils'

/* -------------------------------------------------------------------------- */
/*  Public types                                                              */
/* -------------------------------------------------------------------------- */

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
}

export interface ChatResult {
  content: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  model: string
  provider: string
}

export interface PlanStep {
  description: string
  /** Shell command — filled by the coder role AFTER plan approval. */
  command?: string
  timeoutMs?: number
  retryable?: boolean
  /** If true, the command is a long-running process (e.g. a server). */
  background?: boolean
  /** Regex pattern to match in stdout/stderr that indicates the service is ready. */
  readyPattern?: string
}

export interface PlanResult {
  steps: PlanStep[]
  reasoning: string
  tokenUsage: { prompt: number; completion: number; total: number }
}

export interface AIProvider {
  readonly name: string
  readonly modelName: string
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>
  generatePlan(context: PlanContext): Promise<PlanResult>
}

export interface PlanContext {
  goal: string
  fileTree?: string
  packageJson?: string
  readme?: string
  existingSteps?: PlanStep[]
  customPrompt?: string
  hasSourceRepository: boolean
}

/* -------------------------------------------------------------------------- */
/*  Provider settings resolution                                              */
/* -------------------------------------------------------------------------- */

/** Known AI roles that can each have a distinct provider + model. */
export type AIRole = 'planner' | 'coder' | 'reviewer' | 'thinker' | 'guard' | 'troubleshooter'

/** Per-role override: which provider + model to use for this role. */
export interface RoleOverride {
  /** Provider name (openai, anthropic, google, groq). Empty = use default. */
  provider?: string
  /** Model to use. Empty = use that provider's default model. */
  model?: string
}

interface AISettings {
  provider: string
  openai?: { apiKey?: string; model?: string }
  anthropic?: { apiKey?: string; model?: string }
  google?: { apiKey?: string; model?: string }
  groq?: { apiKey?: string; model?: string }
  /** Per-role overrides. Each role can point to a different provider+model. */
  roles?: Partial<Record<AIRole, RoleOverride>>
}

interface PromptSettings {
  planner?: { content?: string }
  coder?: { content?: string }
  reviewer?: { content?: string }
}

const readAISettings = async (app: Application, projectId: number): Promise<AISettings> => {
  try {
    const rows = await app.service('settings').find({
      query: { key: 'ai', projectId, $limit: 1 },
      paginate: false
    })
    const row = Array.isArray(rows) ? rows[0] : (rows as any)?.data?.[0]
    const value = parseMaybeJson(row?.value)
    if (value && typeof value === 'object') return value as AISettings
  } catch {
    /* fallback */
  }
  return { provider: 'openai' }
}

const readPromptSettings = async (app: Application, projectId: number): Promise<PromptSettings> => {
  try {
    const rows = await app.service('settings').find({
      query: { key: 'prompts', projectId, $limit: 1 },
      paginate: false
    })
    const row = Array.isArray(rows) ? rows[0] : (rows as any)?.data?.[0]
    const value = parseMaybeJson(row?.value)
    if (value && typeof value === 'object') return value as PromptSettings
  } catch {
    /* fallback */
  }
  return {}
}

/* -------------------------------------------------------------------------- */
/*  Plan prompt builder                                                       */
/* -------------------------------------------------------------------------- */

const PLAN_SYSTEM_PROMPT = `You are an expert software engineering planner for the OpenJules autonomous coding platform.
Your task is to analyse a mission goal and produce a HIGH-LEVEL step-by-step execution plan.

IMPORTANT: Do NOT include shell commands or code in the plan.
The actual commands will be generated later by a coder agent after the user approves this plan.

Each step must have:
- "description": a clear, high-level description of WHAT should be done (not HOW)
- "timeoutMs": estimated timeout in ms (default 300000 = 5 min)
- "retryable": whether the step can be retried on failure (default false)
- "background": (optional, default false) set to true ONLY for steps that will start a long-running service (HTTP servers, watchers, daemons).
- "readyPattern": (optional) a regex pattern that signals the background service is ready. Required when background=true.

Rules:
1. Always start with an inspection step so the coder agent has context about the workspace.
2. READ THE README.md (if provided) to understand the project architecture, scripts, and guidelines.
3. If a package.json exists with scripts, mention the relevant scripts the coder should use.
4. Include explicit VERIFICATION steps (e.g., "Run tests to verify fix", "Curl localhost to verify server").
5. End with a validation step (tests, build, lint) if applicable.
6. End with a "produce final diff" step when a repo is provided.
7. Keep the plan concise — only essential steps. Typically 3-8 steps.
8. CRITICAL: If the goal requires starting a long-running service, mark that step as background=true.
9. If a step needs to verify a running service, place it AFTER the background step.
10. Respond ONLY with valid JSON matching this schema:
{
  "reasoning": "Brief explanation of your plan strategy",
  "steps": [
    { "description": "...", "timeoutMs": 300000, "retryable": false, "background": false, "readyPattern": "" }
  ]
}
11. CRITICAL: NEVER ask the user for clarification about a missing repository. If no repository is provided, you MUST proceed assuming a new project creation in an empty workspace.
`

const buildPlanUserPrompt = (ctx: PlanContext): string => {
  const parts: string[] = []

  parts.push(`## Mission Goal\n${ctx.goal}`)
  if (ctx.hasSourceRepository) {
    parts.push(`## Repository\nThe user has provided a source repository. It has been cloned to the workspace.`)
    parts.push(`You should inspect the file tree, package.json, and README below to understand the project structure.`)
  } else {
    parts.push(`## Repository\nNo repository provided. You are working in a fresh, empty workspace. Do not ask for a repo URL.`)
  }

  if (ctx.fileTree) {
    parts.push(`## File Tree (top-level)\n\`\`\`\n${ctx.fileTree}\n\`\`\``)
  }

  if (ctx.packageJson) {
    parts.push(`## package.json\n\`\`\`json\n${ctx.packageJson}\n\`\`\``)
  }

  if (ctx.readme) {
    parts.push(`## README.md\n\`\`\`markdown\n${ctx.readme.slice(0, 8000)}\n\`\`\``)
  }

  if (ctx.customPrompt) {
    parts.push(`## Additional Instructions\n${ctx.customPrompt}`)
  }

  return parts.join('\n\n')
}

/* -------------------------------------------------------------------------- */
/*  OpenAI-compatible provider                                                */
/* -------------------------------------------------------------------------- */

class OpenAIProvider implements AIProvider {
  readonly name: string = 'openai'
  readonly modelName: string
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(apiKey: string, model: string, baseUrl = 'https://api.openai.com/v1') {
    this.apiKey = apiKey
    this.model = model
    this.modelName = model
    this.baseUrl = baseUrl
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_completion_tokens: options.maxTokens ?? 4096
    }

    if (options.jsonMode) {
      body.response_format = { type: 'json_object' }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${text}`)
    }

    const data = (await response.json()) as any
    const choice = data.choices?.[0]
    const usage = data.usage ?? {}

    return {
      content: choice?.message?.content ?? '',
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
      model: data.model ?? this.model,
      provider: this.name
    }
  }

  async generatePlan(context: PlanContext): Promise<PlanResult> {
    const systemPrompt = context.customPrompt
      ? `${PLAN_SYSTEM_PROMPT}\n\n## Custom Instructions\n${context.customPrompt}`
      : PLAN_SYSTEM_PROMPT

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildPlanUserPrompt(context) }
      ],
      { jsonMode: true, temperature: 0.1, maxTokens: 4096 }
    )

    const parsed = JSON.parse(result.content) as { reasoning?: string; steps?: PlanStep[] }

    return {
      steps: (parsed.steps ?? []).map((s) => ({
        description: s.description ?? 'Step',
        timeoutMs: s.timeoutMs ?? 300_000,
        retryable: s.retryable ?? false,
        background: s.background ?? false,
        readyPattern: s.readyPattern
      })),
      reasoning: parsed.reasoning ?? '',
      tokenUsage: {
        prompt: result.promptTokens,
        completion: result.completionTokens,
        total: result.totalTokens
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Anthropic provider                                                        */
/* -------------------------------------------------------------------------- */

class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic'
  readonly modelName: string
  private readonly apiKey: string
  private readonly model: string

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey
    this.model = model
    this.modelName = model
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const systemMessages = messages.filter((m) => m.role === 'system')
    const nonSystemMessages = messages.filter((m) => m.role !== 'system')

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 4096,
      messages: nonSystemMessages.map((m) => ({ role: m.role, content: m.content }))
    }

    if (systemMessages.length) {
      body.system = systemMessages.map((m) => m.content).join('\n\n')
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Anthropic API error ${response.status}: ${text}`)
    }

    const data = (await response.json()) as any
    const content = data.content?.map((c: any) => c.text).join('') ?? ''
    const usage = data.usage ?? {}

    return {
      content,
      promptTokens: usage.input_tokens ?? 0,
      completionTokens: usage.output_tokens ?? 0,
      totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      model: data.model ?? this.model,
      provider: this.name
    }
  }

  async generatePlan(context: PlanContext): Promise<PlanResult> {
    const systemPrompt = context.customPrompt
      ? `${PLAN_SYSTEM_PROMPT}\n\n## Custom Instructions\n${context.customPrompt}`
      : PLAN_SYSTEM_PROMPT

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildPlanUserPrompt(context) }
      ],
      { temperature: 0.1, maxTokens: 4096 }
    )

    // Anthropic doesn't have JSON mode — extract JSON from content
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as { reasoning?: string; steps?: PlanStep[] }) : { steps: [] }

    return {
      steps: (parsed.steps ?? []).map((s) => ({
        description: s.description ?? 'Step',
        timeoutMs: s.timeoutMs ?? 300_000,
        retryable: s.retryable ?? false,
        background: s.background ?? false,
        readyPattern: s.readyPattern
      })),
      reasoning: parsed.reasoning ?? '',
      tokenUsage: {
        prompt: result.promptTokens,
        completion: result.completionTokens,
        total: result.totalTokens
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Google Gemini provider                                                    */
/* -------------------------------------------------------------------------- */

class GoogleProvider implements AIProvider {
  readonly name = 'google'
  readonly modelName: string
  private readonly apiKey: string
  private readonly model: string

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey
    this.model = model
    this.modelName = model
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const systemInstruction = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxTokens ?? 4096,
        ...(options.jsonMode ? { responseMimeType: 'application/json' } : {})
      }
    }

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Google AI API error ${response.status}: ${text}`)
    }

    const data = (await response.json()) as any
    const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
    const usage = data.usageMetadata ?? {}

    return {
      content: text,
      promptTokens: usage.promptTokenCount ?? 0,
      completionTokens: usage.candidatesTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? 0,
      model: this.model,
      provider: this.name
    }
  }

  async generatePlan(context: PlanContext): Promise<PlanResult> {
    const systemPrompt = context.customPrompt
      ? `${PLAN_SYSTEM_PROMPT}\n\n## Custom Instructions\n${context.customPrompt}`
      : PLAN_SYSTEM_PROMPT

    const result = await this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildPlanUserPrompt(context) }
      ],
      { jsonMode: true, temperature: 0.1, maxTokens: 4096 }
    )

    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as { reasoning?: string; steps?: PlanStep[] }) : { steps: [] }

    return {
      steps: (parsed.steps ?? []).map((s) => ({
        description: s.description ?? 'Step',
        timeoutMs: s.timeoutMs ?? 300_000,
        retryable: s.retryable ?? false,
        background: s.background ?? false,
        readyPattern: s.readyPattern
      })),
      reasoning: parsed.reasoning ?? '',
      tokenUsage: {
        prompt: result.promptTokens,
        completion: result.completionTokens,
        total: result.totalTokens
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Groq provider (OpenAI-compatible API)                                     */
/* -------------------------------------------------------------------------- */

class GroqProvider extends OpenAIProvider {
  override readonly name = 'groq'

  constructor(apiKey: string, model: string) {
    super(apiKey, model, 'https://api.groq.com/openai/v1')
  }
}

/* -------------------------------------------------------------------------- */
/*  Static fallback planner (no AI key)                                       */
/* -------------------------------------------------------------------------- */

class StaticFallbackProvider implements AIProvider {
  readonly name = 'static'
  readonly modelName = 'none'

  async chat(): Promise<ChatResult> {
    return {
      content: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model: 'none',
      provider: 'static'
    }
  }

  async generatePlan(context: PlanContext): Promise<PlanResult> {
    const steps: PlanStep[] = []

    if (context.hasSourceRepository) {
      steps.push({
        description: 'Inspect initial repository state',
        command: 'git status --short && git branch --show-current',
        timeoutMs: 30_000
      })
    } else {
      steps.push({
        description: 'Inspect empty workspace',
        command: 'pwd && ls -la',
        timeoutMs: 30_000
      })
    }

    // Try to detect package.json scripts from context
    if (context.packageJson) {
      try {
        const parsed = JSON.parse(context.packageJson) as { scripts?: Record<string, string> }
        const scripts = parsed?.scripts ?? {}

        if (scripts.lint) {
          steps.push({ description: 'Run linter', command: 'npm run lint --if-present', timeoutMs: 120_000 })
        }
        if (scripts.test && context.hasSourceRepository) {
          steps.push({ description: 'Run tests', command: 'npm run test --if-present', timeoutMs: 300_000, retryable: true })
        }
        if (scripts.build) {
          steps.push({ description: 'Run build validation', command: 'npm run build --if-present', timeoutMs: 300_000 })
        }
      } catch {
        steps.push({ description: 'List workspace files', command: 'ls -la', timeoutMs: 30_000 })
      }
    }

    if (context.hasSourceRepository) {
      steps.push({ description: 'Generate final patch', command: 'git diff --no-color -- .', timeoutMs: 60_000 })
    }

    return {
      steps,
      reasoning: 'Static fallback plan — no AI provider configured. Configure an API key in Settings → AI Provider for intelligent planning.',
      tokenUsage: { prompt: 0, completion: 0, total: 0 }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Coder prompt — generates concrete commands per step (after plan approval)  */
/* -------------------------------------------------------------------------- */

const CODER_SYSTEM_PROMPT = `You are an expert software engineering coder for the OpenJules autonomous coding platform.
You are given a HIGH-LEVEL step description from an approved plan and context about the workspace.
Your job is to produce the EXACT shell command(s) that accomplish the step.

Rules:
1. Return ONLY valid JSON with this schema:
{
  "command": "the exact shell command to run",
  "reasoning": "brief explanation of why you chose this command",
  "background": false,
  "readyPattern": ""
}
2. If the step requires multiple commands, chain them with && or use a subshell.
3. Never use interactive commands (e.g. vim, nano, less). Use non-interactive alternatives (sed, echo, tee, cat).
4. Use the workspace context (file tree, package.json) to pick the right tools and paths.
5. Prefer the project's own scripts (npm run ...) over raw commands when available.
6. Be precise — the command will be executed verbatim in a sandbox shell.

CRITICAL — Error Recovery:
If "TROUBLESHOOTER ANALYSIS" is provided in the context, it means the previous attempt failed.
You MUST follow the troubleshooter's advice to fix the command.
Do NOT repeat the exact same command that failed.

CRITICAL — Long-running commands:
Commands that start servers, watchers, or daemons (node server.js, npm start, npm run dev/serve/watch, python manage.py runserver, etc.) MUST be marked as background=true with an appropriate readyPattern.
The readyPattern is a regex string matched against stdout/stderr to detect when the service is ready (e.g. "listening on", "Server running", "ready on port", "compiled successfully").
If you do NOT set background=true for a long-running command, the security guard will BLOCK it.
Only set background=true when the command genuinely starts a persistent service — NOT for builds, tests, or one-shot scripts.

CRITICAL — Writing files:
When creating or overwriting files, use ONE of these safe methods (in order of preference):
1. **Quoted heredoc**: cat > file <<'FILEOF'\n…content…\nFILEOF  — use a UNIQUE delimiter with SINGLE QUOTES around it. Content inside is literal text and will NOT be interpreted by the shell.
2. **tee with single-quoted string**: printf '%s' '…content…' | tee path/to/file
3. **python -c**: python3 -c "open('file.py','w').write('''…content…''')"

ABSOLUTELY NEVER use back-ticks (\`) anywhere in a shell command — not even inside double-quoted strings.
Back-ticks are shell command substitution and WILL be blocked by the security guard.
If you need JavaScript template literals, write the file using a quoted heredoc (method 1) where back-ticks are 100% safe because the shell does NOT interpret content inside <<'DELIM'.
Example:
  cat > app.js <<'JSEOF'
  const msg = \`Hello \${name}\`;
  console.log(msg);
  JSEOF

7. **Modifying package.json**:
   - **CRITICAL**: To initialize a new project, ALWAYS create the file first: \`echo '{}' > package.json\`.
   - NEVER run \`npm init -y\` in an empty directory, as it may modify a parent \`package.json\` in monorepose.
   - Use \`npm pkg set\` to modify fields safely: \`npm pkg set name="my-app" version="1.0.0"\`

8. **File Consistency**:
   - ERROR PREVENTION: Ensure that the filenames you use in \`package.json\` scripts MATCH the files you create.
   - If you set \`"start": "node src/server.js"\`, you MUST create \`src/server.js\`. Do not create \`src/index.js\` instead.
   - CRITICAL: If you define a "test" script (e.g. "node test/app.test.js"), you MUST create the test file in the SAME step (or verify it exists) before the test script is run.
   - Always verify the entry point file exists before trying to run it.

9. CRITICAL: NEVER ask the user for clarification about a missing repository. If no repository is provided, you MUST proceed assuming a new project creation in an empty workspace.
10. COMPATIBILITY: Do NOT use flags like 'set -o pipefail' as the environment may be a minimal sh shell. Use standard POSIX sh syntax unless you are certain usage of bash features is safe.
`

export interface StepCommandContext {
  missionGoal: string
  stepDescription: string
  stepIndex: number
  totalSteps: number
  /** Descriptions of all plan steps, for global context. */
  allStepDescriptions: string[]
  /** Stdout/stderr from the previous steps (truncated). */
  previousStepsOutput?: string
  fileTree?: string
  packageJson?: string
  background?: boolean
  readyPattern?: string
  /** Feedback from the security guard when the previous command was blocked. */
  guardFeedback?: string
  /** User feedback/hint for how to fix the command. */
  userHint?: string
  /** Analysis from the Troubleshooter persona regarding the previous failure. */
  errorAnalysis?: string
}

/**
 * Ask the coder AI to generate a concrete shell command for a plan step.
 * Called once per step, AFTER the plan has been approved by the user.
 */
export const generateStepCommand = async (
  provider: AIProvider,
  context: StepCommandContext
): Promise<{ command: string; reasoning: string; background: boolean; readyPattern: string; tokenUsage: { prompt: number; completion: number; total: number } }> => {
  const parts: string[] = []

  parts.push(`## Mission Goal\n${context.missionGoal}`)
  parts.push(`## Current Step (${context.stepIndex + 1} of ${context.totalSteps})\n${context.stepDescription}`)

  if (context.allStepDescriptions.length > 1) {
    const planOverview = context.allStepDescriptions
      .map((d, i) => `${i + 1}. ${d}${i === context.stepIndex ? ' ← (current)' : ''}`)
      .join('\n')
    parts.push(`## Full Plan Overview\n${planOverview}`)
  }

  if (context.previousStepsOutput) {
    parts.push(`## Output from Previous Steps\n\`\`\`\n${context.previousStepsOutput}\n\`\`\``)
  }

  if (context.fileTree) {
    parts.push(`## File Tree\n\`\`\`\n${context.fileTree}\n\`\`\``)
  }

  if (context.packageJson) {
    parts.push(`## package.json\n\`\`\`json\n${context.packageJson}\n\`\`\``)
  }

  if (context.background) {
    parts.push(`## Note\nThis step starts a BACKGROUND service. The command will be detached and monitored for the ready pattern: "${context.readyPattern || 'listening on'}".`)
  }

  if (context.guardFeedback) {
    parts.push(`## ⚠️ PREVIOUS COMMAND WAS BLOCKED BY SECURITY GUARD\nThe previous command for this step was rejected:\n${context.guardFeedback}\n\nYou MUST generate a DIFFERENT command that avoids the issue described above. Do NOT repeat the same pattern.`)
  }

  if (context.userHint) {
    parts.push(`## 💡 User Hint\nThe user provided this guidance for fixing the command:\n${context.userHint}`)
  }

  if (context.errorAnalysis) {
    parts.push(`## 🛠️ TROUBLESHOOTER ANALYSIS\nThe previous attempt failed. The Troubleshooter analyzed the error and suggests:\n${context.errorAnalysis}\n\nYou MUST incorporate this advice into your corrected command.`)
  }

  // Determine if there is a custom coder prompt override.
  // Note: We don't currently fetch custom prompts for the coder role in mission-runner.ts passing them here,
  // but if we did, we would merge them. For now, we enforce the system prompt.
  // Ideally, mission-runner should fetch the prompt and pass it in context, but for now we'll stick to the system prompt
  // as the base, because the DB "content": "You are a coder agent" override is destructive.

  // TODO: Refactor generateStepCommand to accept an optional customPrompt in context, similar to generatePlan.

  const result = await provider.chat(
    [
      { role: 'system', content: CODER_SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') + '\n\nREMINDER: Output JSON only. Command must be shell code. Do not ask questions.' }
    ],
    { jsonMode: true, temperature: 0.1, maxTokens: 2048 }
  )

  let parsed: { command?: string; reasoning?: string; background?: boolean; readyPattern?: string } = {}
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  } catch {
    /* fallback below */
  }

  return {
    command: parsed.command || `echo "Coder could not generate command for: ${context.stepDescription}"`,
    reasoning: parsed.reasoning || '',
    background: parsed.background ?? context.background ?? false,
    readyPattern: parsed.readyPattern || context.readyPattern || '',
    tokenUsage: {
      prompt: result.promptTokens,
      completion: result.completionTokens,
      total: result.totalTokens
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Troubleshooter prompt — analyzes failures and suggests fixes              */
/* -------------------------------------------------------------------------- */

const TROUBLESHOOTER_SYSTEM_PROMPT = `You are an expert technical troubleshooter for the OpenJules autonomous coding platform.
Your task is to analyze a failed shell command execution and provide a SPECIFIC, ACTIONABLE suggestion to fix the error.
Your output will be fed back to a "Coder" agent as a hint for the next attempt.

Rules:
1. Analyze the "Failed Command", "Exit Code", and "Output" (stdout/stderr).
2. Identify the likely root cause (e.g., syntax error, missing file, missing dependency, network issue, permission denied).
3. Provide a clear, concise instruction on how to fix it.
   - Example 1: "The module 'express' is missing. Run 'npm install express' before starting the server."
   - Example 2: "Port 3000 is already in use. Find the PID using lsof users and kill it, or use a different port."
   - Example 3: "The file 'src/server.js' does not exist. Create the file before trying to run it."
4. Do NOT generate the full corrected command or JSON. Just provide the specific fix strategy in plain text.
5. Keep it short (max 3 sentences).
`

export interface ErrorAnalysisContext {
  missionGoal: string
  stepDescription: string
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

export const analyzeStepError = async (
  provider: AIProvider,
  context: ErrorAnalysisContext
): Promise<{ analysis: string; tokenUsage: { prompt: number; completion: number; total: number } }> => {
  const parts: string[] = []
  parts.push(`## Mission Goal\n${context.missionGoal}`)
  parts.push(`## Step Description\n${context.stepDescription}`)
  parts.push(`## Failed Command\n\`\`\`bash\n${context.command}\n\`\`\``)
  parts.push(`## Exit Code\n${context.exitCode}`)

  const output = (context.stderr + '\n' + context.stdout).trim().slice(-4000) // Last 4k chars
  parts.push(`## Command Output (stderr/stdout)\n\`\`\`\n${output}\n\`\`\``)

  const result = await provider.chat(
    [
      { role: 'system', content: TROUBLESHOOTER_SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') }
    ],
    { temperature: 0.1, maxTokens: 1024 }
  )

  return {
    analysis: result.content,
    tokenUsage: {
      prompt: result.promptTokens,
      completion: result.completionTokens,
      total: result.totalTokens
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Factory                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5.2',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile'
}

/**
 * Build a concrete AIProvider from a provider name and the global settings.
 * If modelOverride is given it takes precedence over the provider's default model.
 */
const buildProvider = (
  providerName: string,
  settings: AISettings,
  modelOverride?: string
): AIProvider | null => {
  const name = providerName.toLowerCase()

  const resolve = (
    cfg?: { apiKey?: string; model?: string },
    defaultModel?: string
  ): { apiKey: string; model: string } | null => {
    const key = cfg?.apiKey?.trim()
    if (!key) return null
    return { apiKey: key, model: modelOverride?.trim() || cfg?.model?.trim() || defaultModel || '' }
  }

  if (name === 'openai') {
    const cfg = resolve(settings.openai, DEFAULT_MODELS.openai)
    if (cfg) return new OpenAIProvider(cfg.apiKey, cfg.model)
  }

  if (name === 'anthropic') {
    const cfg = resolve(settings.anthropic, DEFAULT_MODELS.anthropic)
    if (cfg) return new AnthropicProvider(cfg.apiKey, cfg.model)
  }

  if (name === 'google') {
    const cfg = resolve(settings.google, DEFAULT_MODELS.google)
    if (cfg) return new GoogleProvider(cfg.apiKey, cfg.model)
  }

  if (name === 'groq') {
    const cfg = resolve(settings.groq, DEFAULT_MODELS.groq)
    if (cfg) return new GroqProvider(cfg.apiKey, cfg.model)
  }

  return null
}

export const getAIProvider = async (app: Application, projectId: number): Promise<AIProvider> => {
  const settings = await readAISettings(app, projectId)
  const provider = String(settings.provider || 'openai').toLowerCase()

  const result = buildProvider(provider, settings)
  if (result) return result

  // No valid provider → fall back to static planner
  return new StaticFallbackProvider()
}

/**
 * Get the AI provider for a specific role.
 *
 * Resolution order:
 * 1. Role-specific override (settings.ai.roles[role].provider + .model)
 * 2. Global default (settings.ai.provider + provider-specific model)
 * 3. Static fallback
 */
export const getAIProviderForRole = async (
  app: Application,
  projectId: number,
  role: AIRole
): Promise<AIProvider> => {
  const settings = await readAISettings(app, projectId)
  const roleOverride = settings.roles?.[role]

  // If a role-specific provider is set, try to build it
  if (roleOverride?.provider) {
    const roleProvider = buildProvider(roleOverride.provider, settings, roleOverride.model)
    if (roleProvider) return roleProvider
  }

  // If only a model override is set (same provider), apply it
  if (roleOverride?.model) {
    const globalProvider = String(settings.provider || 'openai').toLowerCase()
    const result = buildProvider(globalProvider, settings, roleOverride.model)
    if (result) return result
  }

  // Fall back to global provider
  return getAIProvider(app, projectId)
}

export const getPlannerPrompt = async (app: Application, projectId: number): Promise<string | undefined> => {
  const prompts = await readPromptSettings(app, projectId)
  return prompts.planner?.content?.trim() || undefined
}
