# Atlas com IA local

Este repositório contém o Atlas e o modelo Qwen3-0.6B quantizado `Q3_K_S`. O GGUF está versionado por Git LFS porque tem cerca de 390 MB. Durante o `npm install`, o `postinstall` em Node verifica o modelo, completa o download caso o host tenha recebido apenas o pointer do LFS, e obtém do GitHub o runtime CPU correto para Linux x64 ou ARM64. Não é necessário executar o instalador Bash.

## Instalar pelo GitHub

No painel do servidor, configure o repositório Git como `https://github.com/gabexf6/atlas2.0.0-manus-ai.git` e mantenha a opção **Instalar Módulos** ativada. O repositório é privado, então o painel precisa estar autorizado a clonar repositórios privados da conta `gabexf6`. Quando o painel executar `npm install`, a etapa `postinstall` prepara automaticamente o GGUF e o `llama-server`; depois o comando normal de inicialização do Atlas continua sendo `npm start`.

Se estiver usando um clone manual, instale Git LFS antes de clonar para receber diretamente o modelo:

```sh
git lfs install
git clone https://github.com/gabexf6/atlas2.0.0-manus-ai.git
cd atlas2.0.0-manus-ai
npm install
npm start
```

A rotina `postinstall` é Node.js, não Bash. Se o clone não tiver suporte a Git LFS, ela reconhece o arquivo pointer e baixa o mesmo modelo público do Hugging Face como fallback. O runtime CPU é baixado da release oficial do llama.cpp no GitHub de acordo com `process.arch`.

## Armazenamento

O GGUF é servido por Git LFS, não como blob Git comum. O GitHub bloqueia arquivos Git comuns acima de 100 MiB; o limite individual do Git LFS no plano Free é 2 GiB. O GitHub informa 10 GiB de armazenamento e banda LFS incluídos no plano Free. Cada clone que baixa o modelo consome cerca de 390 MB de banda e pode, temporariamente, manter uma cópia no cache LFS e outra no diretório de trabalho. O `postinstall` tenta remover somente o objeto de cache duplicado depois de validar o GGUF para recuperar espaço; o espaço temporário durante o clone ainda pode ser apertado num servidor de 1 GB [1] [2] [3].

O projeto não versiona `node_modules`, sessão/autenticação do WhatsApp, bancos locais, logs nem `.env`. Preserve esses dados no painel e configure segredos somente nas variáveis de ambiente do servidor.

## Modelo e uso

- Modelo: Qwen3-0.6B Instruct, GGUF `Q3_K_S` convertido pela comunidade Bartowski.
- Origem do GGUF: [bartowski/Qwen_Qwen3-0.6B-GGUF](https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF).
- Licença do modelo base: Apache-2.0; consulte os cartões do modelo e da conversão antes de redistribuir fora deste uso [4] [5].
- O modelo é pequeno e não equivale ao ChatGPT. O Atlas pesquisa fontes atuais antes de sintetizar respostas.
- Em repouso, o runtime local é descarregado após dois minutos sem pedidos. O GGUF permanece no disco, mas não fica residente na RAM.

## Referências

[1]: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github "Limites oficiais de arquivos e repositórios GitHub"
[2]: https://docs.github.com/repositories/working-with-files/managing-large-files/about-git-large-file-storage "Limites do Git LFS no GitHub"
[3]: https://docs.github.com/billing/managing-billing-for-git-large-file-storage/about-billing-for-git-large-file-storage "Cota gratuita e medição de Git LFS"
[4]: https://huggingface.co/Qwen/Qwen3-0.6B "Cartão oficial do Qwen3-0.6B"
[5]: https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF "Cartão da conversão GGUF"
