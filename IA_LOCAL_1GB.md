# IA local do Atlas para servidor de 1 GB

## Modelo e desenho

O modelo escolhido é Qwen3-0.6B, GGUF `Q3_K_S`, com arquivo de aproximadamente 389,9 MB. O cartão oficial declara 0,6B de parâmetros, contexto de 32.768 tokens e suporte multilíngue; o relatório técnico inclui português (`por_Latn`). A licença do modelo base é Apache-2.0. A quantização `Q3_K_S` é uma conversão comunitária do checkpoint Qwen, escolhida para reduzir o arquivo sem cair para uma quantização de 2 bits [1] [2] [3].

Esse modelo não é equivalente ao ChatGPT. Ele é pequeno e ainda tem limites de raciocínio, precisão e seguimento de instruções. Por isso, o Atlas o usa como redator/sintetizador: pesquisa primeiro, passa trechos curtos e tenta responder em poucas frases naturais, sem despejar listas de resultados ou URLs no grupo. O prompt manda ignorar instruções dentro de páginas, usar apenas as evidências recebidas e admitir quando elas não bastarem; a pesquisa fica nos bastidores, sem bibliografia automática na conversa. Não é preciso alterar os pesos: recuperação de informação externa (RAG) ajuda mais e cabe melhor em 1 GB do que fine-tuning no próprio host.

A Wikipédia é consultada sob demanda pela API MediaWiki em português. Isso busca páginas da edição ptwiki sem baixar o dump local. O Atlas usa extratos curtos — não o texto completo de cada artigo — para responder. A consulta alcança o índice de artigos disponível na API, mas precisa de Internet e não funciona offline [9] [10].

## RAM e armazenamento

O `llama-server` é iniciado somente quando chega uma pergunta que exige geração. Depois de 2 minutos sem consultas, o Atlas o encerra para liberar RAM. Assim, em repouso, os pesos do modelo não ficam carregados. Durante uma conversa ativa, a memória sobe: o GGUF ocupa cerca de 390 MB no disco e o runtime acrescenta o processo e o contexto de inferência.

O runtime CPU pré-compilado consultado ocupa aproximadamente 23 MB compactado para x86_64 ou 19 MB para ARM64 [7] [8]. Somando esses arquivos aos 151,95 MB de armazenamento que você mediu para o Atlas, a estimativa inicial fica perto de 565 MB antes de considerar bibliotecas descompactadas, logs, outros dados e caches. O instalador verifica espaço disponível; não remove nem sobrescreve a sessão de WhatsApp.

A configuração inicial é conservadora: contexto de 1.024 tokens, uma thread, um slot e cache KV de 8 bits. Quando há busca por catálogo via Chromium, o navegador é fechado antes de a inferência carregar os pesos. O limite de heap Node não é um limite de RSS total: buffers, SQLite e subprocessos também usam memória. O perfil de inicialização `npm start` limita a heap V8 a 192 MB; `npm run start:normal` mantém a opção sem limite lean.

Os 150–180 MB são a meta do Atlas em repouso, sem o modelo residente; não são a meta do conjunto durante geração. A otimização de código já aplicada procura reduzir a RAM ociosa, mas não medi o processo vivo do servidor depois da atualização. A meta exata precisa ser conferida no host com `ps`/RSS e durante conversa real. Se o total encostar em 1 GB, o primeiro ajuste será reduzir o contexto para 512; se ainda faltar folga, trocar para uma quantização menor, com perda de qualidade.

## Instalar e ativar

Extraia o pacote de atualização ao lado do diretório atual do Atlas e mescle os arquivos. O pacote não contém autenticação, logs, banco de dados nem `node_modules`; não apague esses dados do servidor.

O repositório GitHub contém o GGUF via Git LFS. Depois de conectar o repositório privado no painel, mantenha **Instalar Módulos** ativado. O painel executa `npm install`, que chama automaticamente `scripts/prepare-local-ai.mjs`: ele valida o GGUF, completa a cópia se o host recebeu apenas o pointer do LFS e obtém o runtime CPU do GitHub para Linux x86_64 ou ARM64. Não é necessário executar o instalador Bash, nem compilar no host de 1 GB. Em um clone manual, use `git lfs install`, `git clone`, `npm install` e `npm start`.

O clone com Git LFS pode usar espaço temporário adicional porque o objeto baixado pode existir no cache e na pasta de trabalho ao mesmo tempo; o `postinstall` remove o cache duplicado depois de validar o modelo. Ainda assim, o servidor com disco de 1 GB pode ficar apertado durante a primeira instalação. Termux nativo é Android/Bionic e não usa o pacote Ubuntu/Linux; o teste em Termux não determina a compatibilidade do host Linux [11] [12].

Em um grupo, um administrador do grupo ou proprietário do bot ativa a conversa com `/ia ativar`. A IA responderá automaticamente a mensagens de texto que não começam com o prefixo de comando. Use `/ia desativar` para parar; `/ia status` consulta o estado.

Para reduzir spam e proteger CPU/RAM, há no máximo uma mensagem enfileirada para resposta por grupo a cada 12 segundos, quatro por minuto por grupo, cooldown de 25 segundos por remetente e fila pendente de duas mensagens. Mensagens de comando e ruído (por exemplo, risadas isoladas) são ignorados. O modelo descarrega após dois minutos sem perguntas; a primeira resposta depois disso terá uma pausa para carregar o GGUF.

O estado persistente contém somente o JID do grupo habilitado. As mensagens anteriores usadas para compreender respostas curtas, como “e onde foi isso?”, ficam por até uma hora somente em memória; não são gravadas em arquivo.

## Fontes integradas e limites

Para conversa factual, o Atlas busca na web e na Wikipédia em português. Quando o tema indica um subsistema, também consulta resultados de metadados: GetMods, LiteAPKs, AN1, AndroidTunado, livros, mangá, receitas e KissRush. Um pedido explícito de jogo é roteado somente para GetMods, LiteAPKs, AN1 e AndroidTunado, pesquisados um por vez em modo rápido; não usa a busca geral. O Atlas só devolve a URL de uma página de catálogo quando o usuário pede esse link explicitamente; não envia URLs espontaneamente. O navegador universal compartilhado continua atendendo os subsistemas que o usam; para a busca geral, a IA prefere HTTP e resultados DuckDuckGo a abrir Chromium em cada mensagem.

A IA não baixa nem instala APKs, não baixa livros e não executa ações nos sites. Se um jogo aparecer no catálogo, a IA informa o resultado, mas avisa que o subsistema atual só fornece metadados da página e não consegue anexar o APK; se não aparecer, diz que não encontrou. No catálogo de livros, licença ou autorização de distribuição não é verificada; os resultados são somente metadados. As consultas são enviadas às fontes externas apropriadas, como DuckDuckGo, Wikimedia e os sites dos subsistemas. O texto encontrado é dado não confiável, não uma instrução. DuckDuckGo HTML é uma página pública de busca, não uma API contratual; seu formato, disponibilidade e limites podem mudar. Se a pesquisa não retornar evidência suficiente, a IA responde que não conseguiu verificar, em vez de completar com conhecimento memorizado.

## Configurações opcionais

- `ATLAS_LLM_IDLE_UNLOAD_MS=120000`: tempo ocioso antes de descarregar o servidor, limitado a 30 segundos–10 minutos.
- `ATLAS_LLM_CTX_SIZE=1024`: contexto do modelo, limitado pelo gerenciador a 256–2.048 tokens; não elevar sem medir RAM.
- `ATLAS_LLM_THREADS=1`, `ATLAS_LLM_BATCH_SIZE=32` e `ATLAS_LLM_UBATCH_SIZE=16`: controles de CPU e lote.
- `ATLAS_LLM_AUTOSTART=0`: não iniciar o servidor automaticamente; um servidor local já precisa estar ativo.
- `ATLAS_LLM_MODEL_PATH` e `ATLAS_LLAMA_SERVER_BIN`: caminhos alternativos para GGUF e executável.
- `ATLAS_LLM_PORT` e `ATLAS_LLM_BASE_URL`: use juntos se mudar a porta local padrão `8080`.
- Mantenha no painel do host `ATLAS_OWNER_LID`, `ATLAS_OWNER_PHONE` e `ATLAS_BRONXYS_API_KEY` se os comandos de proprietário ou a integração Bronxy forem usados. A cópia do código não armazena esses valores.

O serviço escuta em `127.0.0.1:8080`; não o exponha publicamente. As consultas da IA passam pela Internet, mas a geração do texto ocorre no servidor local.

## Referências

[1]: https://huggingface.co/Qwen/Qwen3-0.6B "Cartão oficial do Qwen3-0.6B"
[2]: https://arxiv.org/html/2505.09388v1 "Relatório técnico Qwen3"
[3]: https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF "Quantizações GGUF do Qwen3-0.6B"
[4]: https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct "Cartão do SmolLM2-360M-Instruct"
[5]: https://huggingface.co/google/gemma-3-270m-it "Cartão do Gemma 3 270M instruction-tuned"
[6]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md "Documentação oficial do servidor llama.cpp"
[7]: https://github.com/ggml-org/llama.cpp/releases/latest "Release do llama.cpp"
[8]: https://github.com/ggml-org/llama.cpp/releases/tag/b12110 "Assets CPU do build b12110"
[9]: https://www.mediawiki.org/wiki/API:Search "API MediaWiki Search"
[10]: https://www.mediawiki.org/wiki/Extension:TextExtracts "API MediaWiki TextExtracts"
[11]: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md "Instruções oficiais de build Android e Termux do llama.cpp"
[12]: https://github.com/termux/termux-packages/wiki/Termux-execution-environment "Ambiente de execução do Termux e bibliotecas Bionic"
