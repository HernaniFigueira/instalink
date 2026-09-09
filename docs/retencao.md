# Retenção de dados (LGPD)

Política aplicada pelo script `npm run retention` (dry-run por padrão; `--apply` para executar).

| Dado | Regra | Motivo |
|---|---|---|
| Eventos brutos de analytics (`page_view`, cliques etc.) | apagar após **180 dias** | Minimização — agregados do painel não precisam do rastro bruto |
| Orçamentos sem resposta (`leads` origem `quote`, status `new`) | apagar após **24 meses** | Dado de contato parado vira passivo |
| Pedidos, agendamentos, leads convertidos | **permanentes** | Histórico comercial e fiscal do lojista |
| Contas (lojista/consumidor) | sob demanda | Exclusão via suporte; senha sempre com hash |

Recomendação operacional: agendar `node scripts/retention.mjs --apply` mensalmente
(cron do servidor ou GitHub Action com `DATABASE_URL`).
