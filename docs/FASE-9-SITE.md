# Fase 9: personalização e landing page

Requisitos: **RF07–RF11** (e as fotos do RF12), seção **9.4** (upload e textos seguros) e **RNF07** (contraste).

## Como usar

1. **Painel → Site (RF07, RF08, RF10).** À esquerda você edita; à direita aparece a **prévia ao vivo**, em versão computador ou celular. O que dá para mudar:
   - **Cores e fontes:** cor principal (8 prontas ou outra) e fonte dos títulos e do texto (5 opções).
   - **Logo e banner.**
   - **Textos:** título, subtítulo, texto do botão, "Sobre" e boas-vindas da tela de agendamento.
   - **Seções:** quais aparecem e em que ordem (Serviços, Sobre, Equipe, Galeria, Depoimentos, Contato e mapa).
   - **Ordem dos serviços:** salva na hora e vale também para a tela de agendamento.
   - **Galeria:** até 24 fotos com legenda.
   - **Depoimentos:** até 12.
   - **Perguntas no agendamento:** até 5 a mais (ex.: alergias), escritas ou de marcar, obrigatórias ou não. As respostas aparecem na Agenda.
2. **Salvar rascunho × Publicar (RF08).** O site só muda quando você clica em **Publicar**. "Descartar alterações" volta para o que está no ar.
3. **Landing page (RF09).** Em `/` ficam:
   - topo com logo, banner e botão de agendar;
   - serviços com foto, descrição, duração e preço;
   - equipe com foto, cargo e apresentação;
   - galeria, depoimentos e "Sobre";
   - contato: endereço com **"Ver no mapa"**, WhatsApp, Instagram e horário de funcionamento.
4. **Agendar direto (RF11).** O botão **Agendar** de cada serviço abre `/agendar?servico=…` já com o serviço escolhido. Se só um profissional faz, já cai na escolha de horário.
5. **Fotos (RF12, RF09).** Os formulários de Serviço e de Profissional (Equipe) ganharam o envio de foto.
6. A tela de agendamento, "Meu agendamento" e "Meus agendamentos" usam as mesmas cores, fontes e logo publicadas.

## Segurança (9.4)

- **Imagens:**
  - O tipo é conferido pelos **primeiros bytes**. Só JPEG, PNG e WebP; SVG (que pode ter script) e qualquer arquivo disfarçado são recusados.
  - Limite de **5 MB**, conferido no navegador e na API.
  - A imagem é **reprocessada com sharp**: gira pelo EXIF, reduz para o tamanho certo de cada uso, vira WebP e **perde todos os metadados**, como a localização do celular. Testado.
  - O nome vira aleatório (`uuid.webp`) e o nome original nem é guardado. Também há proteção contra "bomba de pixels".
  - **Onde ficam:** em produção use `ARMAZENAMENTO=s3` (AWS S3, Cloudflare R2, MinIO), fora do servidor da API. Em desenvolvimento ficam em `apps/api/uploads/`, servidas pela API com `nosniff` e CSP `default-src 'none'`.
  - Quem pode enviar: logo, banner e galeria só o admin; foto de serviço quem gerencia serviços; foto de profissional quem gerencia a equipe.
- **Só imagens nossas:** os campos de imagem aceitam só URLs de arquivos que a própria API guardou. Link externo ou `javascript:` são recusados.
- **Textos:** são guardados como **texto puro**. As tags HTML são removidas no servidor, e o site mostra tudo escapado pelo React; não existe HTML vindo do banco. Por isso não precisa de DOMPurify.
- **Cores e fontes:** cor só no formato `#RRGGBB` e **com contraste mínimo de 4,5:1** com o texto branco dos botões (WCAG AA, RNF07). Fonte só da lista. Não há como injetar CSS.
- **Mapa:** é um link para o Google Maps, sem iframe de terceiros dentro do site.
- **Respostas extras:** são conferidas contra as perguntas publicadas. Perguntas inventadas pelo navegador são descartadas (9.6: só guardamos o que pedimos).
- **Rascunho privado:** a rota pública só entrega o que está **publicado**.

### Produção

- Configure `ARMAZENAMENTO=s3` e as variáveis `S3_*` (veja `.env.example`).
- Na CSP do Nginx, inclua o domínio de `S3_PUBLIC_URL` em `img-src`.

## Rotas novas

| Rota | Acesso | Requisito |
| --- | --- | --- |
| POST /admin/arquivos?finalidade=LOGO\|BANNER\|GALERIA\|SERVICO\|EQUIPE | conforme a finalidade | 9.4, RF07, RF09, RF12 |
| GET /arquivos/:chave | Público (só com armazenamento local) | — |
| GET /admin/personalizacao, PUT .../rascunho, POST .../publicar, POST .../descartar | empresa:gerenciar | RF07, RF08, RF10 |
| PUT /admin/servicos/ordem | servicos:gerenciar | RF07 |
| GET /public/personalizacao, GET /public/equipe | Público | RF09 |

## Testes

`src/modules/personalizacao/fase9.int.test.ts`:
- WebP reduzido, metadados apagados;
- PHP disfarçado de PNG, SVG com script, arquivo de 6 MB, permissões, caminho com `../`;
- cor sem contraste, link externo, `javascript:`, fonte fora da lista;
- HTML removido dos textos, rascunho que não aparece antes de publicar, seções;
- perguntas extras, foto de serviço, ordem do catálogo, equipe pública sem contato.

## Ficou para depois

- **Apagar imagens que deixaram de ser usadas:** hoje ficam guardadas (a tabela `arquivos` registra tudo, então dá para fazer a limpeza depois).
- **Página com endereço próprio por empresa:** o sistema atende uma empresa por instalação, como diz a documentação.
