# Agentes e Prompts

Definição das "Personas" de IA e como elas interagem.

## 1. O Agente Planner (O Arquiteto)
- **Objetivo:** Entender o pedido e quebrar em passos executáveis.
- **Input:** Descrição da Issue + Code Map (estrutura do repo).
- **Prompt Strategy:** Chain-of-Thought (CoT). "Pense passo a passo como resolver e liste os arquivos envolvidos".
- **Saída:** Um objeto JSON `MissionPlan`.

## 2. O Agente Coder (O Operário)
- **Objetivo:** Executar UM passo do plano.
- **Loop ReAct:**
    1.  *Thought:* "Preciso ler o arquivo X para entender a função Y".
    2.  *Action:* `read_file(X)`.
    3.  *Observation:* (Conteúdo do arquivo).
    4.  *Thought:* "Agora vou criar o teste".
    5.  *Action:* `write_file(test_X.ts, content)`.
    6.  *Action:* `exec("npm test")`.
- **Diferencial:** Possui acesso ao feedback do terminal (stderrr). Se falhar, ele deve tentar corrigir sozinho até N tentativas.

## 3. O Agente Reviewer (O Auditor)
- **Objetivo:** Garantir qualidade antes do humano.
- **Checklist:**
    - Existem `console.log` de debug esquecidos?
    - Existem segredos/chaves hardcoded?
    - O código segue o estilo do projeto (lint)?
- **Ação:** Pode aprovar ou rejeitar (devolvendo para o Coder consertar).

## LLM Gateway
Camada de abstração para usar múltiplos modelos.
- **Planner/Reviewer:** Modelos "Inteligentes" (GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro).
- **Coder:** Modelos "Rápidos/Code" (DeepSeek-Coder-V2, Llama-3-70b, GPT-3.5) para tarefas simples, ou modelos grandes para complexas.
