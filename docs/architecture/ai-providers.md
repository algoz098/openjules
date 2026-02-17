# AI Providers Configuration

This document explains how to configure and extend the LLM (Large Language Model) providers in OpenJules. The system is designed to be agnostic to the underlying model, supporting major providers like OpenAI, Anthropic, Google Vertiex AI, and Groq via a standardized interface.

## 1. Supported Providers

OpenJules currently supports the following providers out-of-the-box:

-   **OpenAI**: GPT-4, GPT-3.5 Turbo.
-   **Anthropic**: Claude 3 (Opus, Sonnet, Haiku).
-   **Google**: Gemini 1.5 Pro, Flash.
-   **Groq**: LLaMA 3, Mixtral (High-speed inference).

## 2. Configuration Strategy

Configuration is managed via the **Settings Service** (`/settings` endpoint), allowing runtime updates without restarting the backend.

### Database Settings
The `settings` table stores the following keys:
-   `llm_provider`: The active provider ID (e.g., `openai`, `anthropic`).
-   `llm_model`: The specific model ID to use (e.g., `gpt-4-turbo`).
-   `llm_api_key`: The API key for the selected provider (Encrypted at rest).
-   `llm_base_url`: (Optional) Custom API endpoint for local LLMs or proxies.

### Environment Variables (Defaults)
You can set default values using `.env`:
```bash
LLM_PROVIDER=openai
LLM_MODEL=gpt-4-turbo
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
GROQ_API_KEY=gsk_...
```

## 3. System Prompts & Personas

The agent's behavior is controlled by System Prompts defined in the codebase. OpenJules uses a multi-agent architecture where different prompts are used for different stages of a mission.

### Planner Agent
Responsible for breaking down high-level user instructions into a step-by-step execution plan.
-   **Inputs**: User instruction, Repository structure (if applicable).
-   **Output**: JSON list of steps.
-   **Location**: `apps/backend/src/lib/agents/planner.ts`

### Coder Agent
Responsible for writing and modifying code based on the current step of the plan.
-   **Inputs**: Current step instruction, File context, Previous errors.
-   **Output**: Code blocks (Python/Node/Bash) or diff instructions.
-   **Location**: `apps/backend/src/lib/agents/coder.ts`

## 4. Extending Providers

To add a new provider (e.g., Mistral, LocalAI):

1.  Create a new file in `apps/backend/src/lib/llm/providers/<provider>.ts`.
2.  Implement the `LLMProvider` interface:
    ```typescript
    export class MyNewProvider implements LLMProvider {
      async generate(prompt: string, options: LLMOptions): Promise<string> {
        // Implementation
      }
    }
    ```
3.  Register the provider in `apps/backend/src/lib/llm/factory.ts`.
