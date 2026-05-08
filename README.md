# Jarvis Site — Escala Danilo

Dashboard privado para visualizar a escala de voo do Danilo de forma clara para Danilo e Bruna.

## Stack

- Next.js
- React
- TypeScript
- Vercel
- GitHub Actions

## Funcionalidades

- Login básico por email e senha.
- Sessão HTTP-only assinada.
- Dashboard da escala importada do CAE/Azul.
- Resumo do próximo compromisso, estatísticas e linha do tempo por dia.

## Dados

A escala atual está embutida em `app/data/roster-latest.json`, gerada a partir de:

`projects/azul-escala/data/normalized/roster-latest.json`

## Segurança

- Senhas não ficam no código.
- Usuários e hashes ficam em `SCHEDULE_USERS_JSON`.
- Assinatura de sessão usa `AUTH_SECRET`.
- Secrets são configurados no Vercel/GitHub Actions.
