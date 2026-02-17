# GritQL (Inspiração de Refatoração)

**Foco:** Refatoração Declarativa e Migrações em Massa.
**Repositório:** `https://github.com/getgrit/gritql` e `https://github.com/biomejs/biome`

## O Que Resolve?
Tarefas repetitivas e determinísticas onde LLMs costumam errar ou ser lentos (ex: renomear uma função em 500 arquivos, mudar sintaxe de imports).

## Tecnologia Core: Pattern Matching Estrutural

### 1. Engine Declarativa
Em vez de pedir para uma IA "mudar X para Y", você define um padrão GritQL:
```grit
// Exemplo conceitual
`console.log($msg)` => `logger.info($msg)`
where {
    $msg <: not within try_statement
}
```
Isso garante precisão absoluta.

### 2. Workflow Híbrido (IA + Determinístico)
O GritQL permite misturar IA. Você pode usar a engine para *encontrar* os pontos de interesse (ex: "todas as funções sem tipagem") e delegar apenas o *recheio* para o LLM.

## Lições para o OpenJules
- **Não usar LLM para tudo:** Para refatorações globais, usar ferramentas de busca e substituição estruturada (como `sed` inteligente ou o próprio motor do Grit se possível).
- **Consistência:** Um agente que precisa editar muitos arquivos deve tentar gerar um script de migração em vez de editar um a um.
