# Fase 3 — Empresa, serviços e equipe

Requisitos aplicados: **RF06, RF12, RF13**, e a base para **RF19** e **RF54**
(o campo de permissão de horário e a comissão padrão já existem no funcionário).
Segurança: **9.2** (permissões e mass assignment) e **9.7** (auditoria de preço).

## O que entrou

- **Empresa (RF06):** uma linha só no banco (`id = 1`). CPF ou CNPJ é validado pelos
  dígitos verificadores, incluindo o CNPJ alfanumérico que a Receita emite desde jul/2026.
  A rota pública mostra o CNPJ (que é público), mas **nunca o CPF**.
- **Serviços (RF12):** nome, categoria, descrição, duração, preço, intervalo de limpeza,
  ativo/inativo e ordem. Excluir é lógico (`deletedAt`): o serviço some das telas, mas
  agendamentos antigos continuam apontando para ele.
- **Equipe do serviço (RF13):** define quem executa cada serviço, com preço e duração
  próprios opcionais. Se ficar vazio, vale o do serviço.
- **Perfil de atendimento:** a tabela `funcionarios` é separada de `usuarios`. Assim, o admin
  também pode atender (é só criar o perfil para ele). Funcionário convidado já ganha o perfil.
- **Catálogo público:** só mostra serviço ativo com pelo menos um profissional ativo e
  visível no site. Não expõe e-mail, comissão nem nada interno.

## Passo a passo

```powershell
npm install
cd apps/api
npx prisma migrate dev --name servicos-equipe
cd ../..
npm run dev:api
```

Se você ainda não rodou a migration da Fase 2, esse comando cria tudo de uma vez.
Depois teste pelo `apps/api/requests/fase3.http`.

## Rotas criadas

| Rota | Permissão | Requisito |
| --- | --- | --- |
| GET/PUT /admin/empresa | `empresa:gerenciar` | RF06 |
| GET /public/empresa | Público | RF06 |
| GET/POST /admin/servicos | `servicos:gerenciar` | RF12 |
| GET/PATCH/DELETE /admin/servicos/:id | `servicos:gerenciar` | RF12 |
| PUT /admin/servicos/:id/equipe | `servicos:gerenciar` | RF13 |
| GET/POST/PATCH/DELETE /admin/servicos/categorias | `servicos:gerenciar` | RF12 |
| GET/POST /admin/funcionarios, PATCH /admin/funcionarios/:id | `equipe:gerenciar` | — |
| GET /public/servicos | Público | RF12, RF13 |

## Decisões tomadas

- **Dinheiro em centavos inteiros** (`precoCentavos`): R$ 49,90 vira `4990`. Número
  decimal com vírgula flutuante erra centavos em somas (0,1 + 0,2 ≠ 0,3). O front formata.
- **Durações em múltiplos de 5 minutos:** a agenda da Fase 4 vai trabalhar em blocos de 5 min.
- **Fotos e logo:** os campos já existem, mas o upload (com verificação do arquivo e
  armazenamento fora do servidor, seção 9.4) entra na Fase 9, junto com a personalização.
- **Ficha técnica (RF14) e custo/margem (RF15):** dependem do estoque, entram na Fase 7.
