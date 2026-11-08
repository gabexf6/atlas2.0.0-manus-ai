# Atlas com SmolLM3 e navegador de pesquisa

Este branch, `smollm3-3gb`, é a versão do Atlas preparada para o servidor Bronxy de **3 GB RAM, 4 cores e 4 GB de disco**. Ele usa o modelo **SmolLM3-3B Instruct Q4_K_M**, em GGUF de **1.915.305.312 bytes** (cerca de 1,92 GB), armazenado via Git LFS. **Não mude para este branch no servidor atual de 1 GB/1 GB de disco**: o peso não cabe nesse disco e a inferência pode ultrapassar a RAM disponível.

## Instalar depois do upgrade

1. Faça primeiro o upgrade do servidor para o plano de 3 GB RAM/4 GB de disco.
2. No painel Bronxy, mantenha o repositório público `https://github.com/gabexf6/atlas2.0.0-manus-ai.git` e selecione o branch `smollm3-3gb`.
3. Deixe **Instalar Módulos** ativado. O `npm install` executará `scripts/prepare-local-ai.mjs`, que valida o modelo, mostra progresso do download e obtém o runtime CPU oficial do llama.cpp para Linux ARM64 ou x64.
4. Depois da instalação, use o comando normal do painel para iniciar o Atlas (`npm start`). Em um grupo, um administrador ativa com `/ia ativar`.

Não é necessário rodar o Bash manualmente. O script `scripts/install-local-ai.sh` é apenas um atalho para o mesmo preparador Node. Se faltar espaço, o preparador não inicia/retoma o download e não interrompe o `npm install`; ele registra que a IA local não está pronta. Um arquivo parcial já existente fica preservado para possível retomada. Após liberar espaço, rode `npm install` novamente.

Para um clone manual no disco de 4 GB, evite manter duas cópias grandes no cache LFS e na pasta de trabalho. Clone sem baixar o objeto LFS e deixe o `postinstall` baixar o GGUF uma vez para a pasta de modelos:

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --branch smollm3-3gb https://github.com/gabexf6/atlas2.0.0-manus-ai.git
cd atlas2.0.0-manus-ai
npm install
npm start
```

## Modelo e RAM

- Modelo: [SmolLM3-3B Instruct](https://huggingface.co/HuggingFaceTB/SmolLM3-3B), quantização GGUF Q4_K_M do [ggml-org](https://huggingface.co/ggml-org/SmolLM3-3B-GGUF).
- O cartão do modelo lista português entre os idiomas nativos e documenta o modo `/no_think`. O Atlas o usa para respostas comuns, reduzindo o raciocínio estendido desnecessário em CPU.
- O llama-server carrega somente quando há uma pergunta, usa um slot, contexto inicial de 2.048 tokens e até três threads, e descarrega após dois minutos ocioso. O consumo durante a geração é maior que o uso em repouso; precisa ser medido no contêiner Bronxy.
- O Chromium fecha depois da coleta das evidências e antes da inferência, para não somar seu pico de RAM ao do GGUF.

## Internet, Wikipédia e navegador universal

Para perguntas factuais, o Atlas pesquisa resultados web e a Wikipédia em português. Além dos snippets, o navegador universal central do Atlas abre e lê até uma página pública encontrada para enriquecer a evidência. O texto da página é tratado como dado não confiável e o SmolLM3 só deve resumir evidências recebidas; se elas não bastarem, deve dizer que não conseguiu confirmar.

O browser está liberado para **pesquisa e leitura de páginas públicas**: navegação HTTPS/GET, sem JavaScript, downloads, cliques, preenchimento de formulários, login ou ações externas. Endereços locais/privados são bloqueados. Isso permite que a IA consulte a web sem dar ao modelo autoridade para publicar, comprar, alterar contas ou baixar/executar arquivos. O Chromium é compartilhado com os subsistemas Atlas e limitado a um contexto de cada vez.

A Wikipédia é consultada pela API sob demanda; não é baixado um dump local, que não cabe no disco junto do modelo. Os subsistemas de jogos, livros, mangá, receitas e KissRush continuam fazendo buscas pelos adaptadores existentes. Para pedidos de jogos, a IA pesquisa primeiro GetMods, LiteAPKs, AN1 e AndroidTunado; ela não baixa nem instala APKs.

## Git LFS e armazenamento

O modelo está abaixo do limite individual de 2 GB por objeto do Git LFS Free, mas perto do teto. O GitHub informa 10 GiB de armazenamento e 10 GiB de banda gratuitos; cada instalação que transfere o GGUF consome aproximadamente 1,92 GB da banda do dono do repositório. O tamanho nominal de 4 GB do servidor também precisa comportar o Atlas, `node_modules`, runtime, logs, cache e temporários, portanto mantenha apenas um GGUF instalado. [1] [2]

O repositório não versiona sessões do WhatsApp, autenticação, banco local, logs, `.env` ou `node_modules`. Preserve os dados existentes no painel e configure segredos apenas nas variáveis de ambiente do servidor.

## Referências

[1]: https://docs.github.com/repositories/working-with-files/managing-large-files/about-git-large-file-storage "Limites por arquivo do Git LFS"
[2]: https://docs.github.com/billing/managing-billing-for-git-large-file-storage/about-billing-for-git-large-file-storage "Franquias gratuitas e cobrança do Git LFS"
[3]: https://github.com/ggml-org/llama.cpp/releases/tag/b12199 "Runtime CPU llama.cpp b12199"
[4]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md "Configuração do servidor llama.cpp"
[5]: https://www.mediawiki.org/wiki/API:Search "API oficial MediaWiki Search"
