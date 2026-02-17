# AutoCodeRover (Inspiração Técnica)

**Foco:** Resolução Autônoma de Bugs e Issues do GitHub.
**Repositório:** `https://github.com/nus-apr/auto-code-rover`

## O Que Resolve?
O problema da **Localização de Falhas**. A maioria dos agentes falha porque não sabe *onde* editar. O AutoCodeRover foca em encontrar o local exato do bug antes de tentar consertá-lo.

## Componentes Técnicos Reutilizáveis

### 1. Busca Estruturada (AST-Aware Search)
Em vez de buscar texto (`grep`), o AutoCodeRover busca **símbolos**.
- **Como funciona:** Usa Tree-sitter para entender a sintaxe.
- **Queries:** Permite ao agente perguntar "Onde está a definição da classe `UserAuth`?" ou "Quem chama o método `login`?".
- **Benefício:** Reduz alucinações e garante que o contexto passado ao LLM contém o código relevante, não apenas arquivos aleatórios com nomes parecidos.

### 2. Localização de Falhas Baseada em Espectro (SBFL)
- **Técnica:** Se houver testes, o agente roda a suite.
- **Análise:** Observa quais linhas de código foram executadas durante os testes que falharam.
- **Resultado:** Cria um "mapa de calor" apontando os arquivos mais prováveis de conter o bug.

### 3. Workflow Iterativo (Patch & Validate)
O ciclo não termina na geração do código.
1.  **Gera Patch:** O LLM cria um arquivo diff.
2.  **Aplica:** O sistema aplica o patch no sandbox.
3.  **Valida:** Roda os testes de reprodução.
4.  **Loop:** Se falhar, o output do teste volta para o LLM tentar de novo.

## Lições para o OpenJules
- **Implementar Busca Semântica/AST:** Não confiar apenas em RAG vetorial. A estrutura do código é vital.
- **Testes como Critério de Sucesso:** O agente deve ser capaz de detectar e rodar testes automaticamente.
