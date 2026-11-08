# IA local do Atlas — SmolLM3 para o servidor de 3 GB

## Escolha e função

O branch `smollm3-3gb` usa **SmolLM3-3B Instruct, GGUF Q4_K_M**, com arquivo de 1.915.305.312 bytes (cerca de 1,92 GB). O cartão do modelo lista seis idiomas nativos, incluindo português, e documenta uma chave `/no_think` para desativar raciocínio estendido. O GGUF preserva o template do modelo; o Atlas inicia `llama-server` com `--jinja` e envia `enable_thinking: false` junto da instrução `/no_think`. [1] [2]

O modelo localiza-se no servidor e gera a resposta; não é equivalente ao ChatGPT. Para fatos, o Atlas primeiro reúne evidências externas e dos próprios subsistemas. O modelo deve conversar naturalmente, resumir o material recebido e admitir quando a pesquisa não confirmar a resposta — não preencher lacunas com memória do treinamento. O conteúdo das páginas é dado não confiável, nunca instrução para a IA.

## Internet e navegador universal do Atlas

Cada busca geral continua consultando a pesquisa web e a API da Wikipédia em português. A busca web agora também passa pelo BrowserManager central: abre e lê até uma página pública dos resultados, seleciona trechos relacionados à consulta e acrescenta esse material às evidências para o modelo. Se Chromium ou a página falharem, os snippets do buscador continuam disponíveis.

O navegador está autorizado para pesquisar e ler páginas públicas, não para agir em contas ou sites: a integração só permite navegação HTTPS com GET/HEAD para endereços públicos, bloqueia endereços locais/privados, scripts, recursos secundários e outros métodos HTTP; não clica em links ou botões, não preenche formulários, não autentica, não baixa arquivos e não publica conteúdo. Essa separação deixa a IA aproveitar o navegador sem transformar o texto de uma página em autorização para executar ações. As consultas são enviadas aos serviços de pesquisa e sites consultados.

Os adaptadores já existentes continuam disponíveis: GetMods, LiteAPKs, AN1, AndroidTunado, livros, mangá, receitas e KissRush. A IA só roteia para eles quando o assunto corresponde. Pedidos explícitos de jogo consultam os quatro catálogos de jogos e não buscam links de terceiros por conta própria. O catálogo não anexa nem instala APKs.

A Wikipédia usa a API MediaWiki sob demanda. Não baixe um dump local: o dump atual de artigos em português tem cerca de 2,79 GB comprimidos e não cabe junto do GGUF em um disco nominal de 4 GB. A API mantém acesso online ao índice de artigos sem gastar esse espaço local. [6] [7]

## RAM, CPU e armazenamento

Esta configuração destina-se ao plano de **3 GB RAM, 4 cores, 4 GB de disco**. Não selecione o branch no servidor antigo de 1 GB/1 GB de disco. O instalador Node verifica espaço disponível: se não houver espaço suficiente, ele registra a limitação, deixa o Atlas iniciar sem modelo e não deixa um download parcial consumir o restante do disco. Depois do upgrade/liberação de espaço, execute novamente `npm install`.

Antes de baixar, o instalador compara espaço livre com o tamanho restante esperado do GGUF e uma reserva para o runtime. Se faltar espaço, não inicia nem retoma a transferência e o `npm install` pode terminar sem IA local; um arquivo parcial existente é preservado para possível retomada. Após liberar espaço, execute novamente `npm install`.

A configuração de partida usa um único slot, contexto de 2.048 tokens, até três threads e cache KV de 8 bits. O GGUF permanece no disco; `llama-server` só inicia quando chega uma solicitação e descarrega após dois minutos ocioso. A primeira resposta depois do descarregamento demora mais enquanto o modelo é carregado. O Chromium é fechado depois da pesquisa e antes da inferência para reduzir a sobreposição de RAM. O uso real de pico — Atlas, Chromium durante a busca, runtime e contexto — precisa ser observado no painel; 3 GB é um limite do contêiner, não uma promessa de que todos os pedidos terão a mesma latência.

Na validação ponta a ponta deste branch, uma pergunta sobre Dom Pedro II levou aproximadamente **52 segundos** no sandbox ARM64, incluindo pesquisa web/Wikipédia, leitura pelo navegador e primeira carga fria do modelo. É uma medição isolada fora da Bronxy, não uma garantia de tempo no servidor. Enquanto o modelo permanecer carregado dentro da janela de dois minutos, perguntas seguintes evitam a etapa de recarga; a coleta de evidências externas ainda acrescenta latência.

O modelo de 1,92 GB deixa nominalmente cerca de 2,08 GB de disco para código, dependências, runtime e temporários. Instale somente este GGUF no branch e verifique o espaço livre após o `npm install`. Pelo Git LFS, o arquivo fica abaixo do limite Free de 2 GB por objeto, com pouca folga; cada transferência consome cerca de 1,92 GB da cota de banda LFS do proprietário do repositório. GitHub Free lista franquias de 10 GiB de banda e armazenamento. [4] [5]

## Instalação no painel

1. Atualize primeiro a Bronxy para 3 GB RAM/4 GB de disco.
2. Configure o repositório público `https://github.com/gabexf6/atlas2.0.0-manus-ai.git` e selecione branch `smollm3-3gb`.
3. Mantenha **Instalar Módulos** ativado. O `npm install` chama `scripts/prepare-local-ai.mjs` automaticamente. O instalador mostra progresso a cada 10%, retoma um `.part` compatível e obtém o runtime CPU oficial `b12199` para Linux ARM64 ou x64. Se o painel não tiver Git LFS, o pointer é completado pelo download do mesmo arquivo no Hugging Face. Evite smudge LFS manual neste disco de 4 GB, para não manter ao mesmo tempo o cache completo e o arquivo de trabalho.
4. Use o comando normal do painel (`npm start`). Não precisa rodar `bash scripts/install-local-ai.sh`; o script Bash é apenas um atalho para o mesmo preparador Node.
5. Em um grupo, um administrador ativa com `/ia ativar`; use `/ia desativar` para desligar e `/ia status` para conferir.

Termux/Android não é o alvo deste branch: o runtime baixado é um binário Linux, e o instalador rejeita plataformas não suportadas antes de iniciar o download grande. O servidor Linux ARM64 da Bronxy é o destino esperado.

## Parâmetros usados

- Caminho do GGUF: `models/SmolLM3-Q4_K_M.gguf`.
- Servidor: `bin/llama-server`, loopback `127.0.0.1:8080`; não o exponha publicamente.
- `ATLAS_LLM_CTX_SIZE`: padrão 2048; o gerenciador limita a 512–2048 neste branch.
- `ATLAS_LLM_THREADS`: padrão 3; limitado a 1–3.
- `ATLAS_LLM_IDLE_UNLOAD_MS`: padrão 120000 ms (2 min).
- Um único slot (`--parallel 1`); no máximo uma inferência local ao mesmo tempo.
- Evidências externas: trechos curtos de até duas fontes para manter o prompt e a resposta focados.

## Referências

[1]: https://huggingface.co/HuggingFaceTB/SmolLM3-3B "Cartão SmolLM3-3B: idiomas e modo de raciocínio"
[2]: https://huggingface.co/ggml-org/SmolLM3-3B-GGUF "Cartão GGUF e template de conversa"
[3]: https://github.com/ggml-org/llama.cpp/releases/tag/b12199 "Runtime oficial llama.cpp b12199"
[4]: https://docs.github.com/repositories/working-with-files/managing-large-files/about-git-large-file-storage "Limites de tamanho por arquivo Git LFS"
[5]: https://docs.github.com/billing/managing-billing-for-git-large-file-storage/about-billing-for-git-large-file-storage "Cotas gratuitas Git LFS"
[6]: https://dumps.wikimedia.org/ptwiki/latest/ "Índice dos dumps ptwiki"
[7]: https://www.mediawiki.org/wiki/API:Search "API oficial de busca MediaWiki"
[8]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md "Opções do llama-server"
