# Code Map Service (Contexto e Navegação)

Responsável por fornecer ao LLM uma visão "Raio-X" do repositório, permitindo navegar sem ler todos os arquivos.

## Componentes

### 1. Indexador Tree-sitter
- **Função:** Ler arquivos do repo e extrair AST.
- **Extração:** Identifica definições de Classes, Métodos, Funções Exportadas e Interfaces.
- **Output:** Gera um JSON leve ou insere no banco relacional.

### 2. Dependency Graph
- Mapeia relações: "Arquivo A importa Arquivo B".
- Permite que o agente, ao editar o arquivo B, saiba que precisa verificar o arquivo A.

### 3. Interface de Busca (Tools para o LLM)

O agente terá acesso a ferramentas que chamam este serviço:

- `list_files(directory)`: Lista arquivos (não conteúdo).
- `get_symbol_definition(symbol_name)`: Retorna o código da definição da função/classe.
- `find_references(symbol_name)`: Encontra quem usa este símbolo.
- `read_file_snippet(path, start_line, end_line)`: Lê pedaço específico.

## Estratégia de Cache
Como analisar o repo inteiro é custoso, o Code Map deve ser incremental:
- Calcular hash de cada arquivo.
- Re-indexar apenas arquivos modificados desde a última missão.
