# Kist — Gerador de Propostas

Sistema web para converter e-mails de cotação em CSVs prontos para importar no Tiny OList.

---

## Estrutura

```
kist-app/
├── backend/          ← API Python (FastAPI)
│   ├── main.py
│   ├── requirements.txt
│   └── render.yaml
└── frontend/         ← Interface React
    ├── src/
    ├── package.json
    └── render.yaml
```

---

## Deploy no Render.com (gratuito)

### Pré-requisitos
- Conta no GitHub (gratuita)
- Conta no Render.com (gratuita)
- Chave da API Anthropic (console.anthropic.com)
- Service Role Key do Supabase (Settings → API)

---

### Passo 1 — Subir o código no GitHub

1. Crie um repositório no GitHub chamado `kist-app`
2. Faça upload das pastas `backend/` e `frontend/`
   - Pode arrastar direto no site do GitHub

---

### Passo 2 — Deploy do Backend

1. Acesse render.com → **New** → **Web Service**
2. Conecte seu repositório GitHub
3. Configure:
   - **Name:** `kist-backend`
   - **Root Directory:** `backend`
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Em **Environment Variables**, adicione:
   - `ANTHROPIC_API_KEY` → sua chave da Anthropic
   - `SUPABASE_URL` → `https://owpmcoithvzdlhmfkvbe.supabase.co`
   - `SUPABASE_KEY` → service_role key do Supabase
5. Clique **Create Web Service**
6. Aguarde o deploy (~2 min). Anote a URL gerada (ex: `https://kist-backend.onrender.com`)

---

### Passo 3 — Deploy do Frontend

1. Render.com → **New** → **Static Site**
2. Conecte o mesmo repositório
3. Configure:
   - **Name:** `kist-frontend`
   - **Root Directory:** `frontend`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
4. Em **Environment Variables**, adicione:
   - `VITE_API_URL` → URL do backend (ex: `https://kist-backend.onrender.com`)
5. Clique **Create Static Site**
6. Aguarde o deploy (~3 min). Sua URL será algo como `https://kist-frontend.onrender.com`

---

### Passo 4 — Adicionar função de busca no Supabase

Execute este SQL no SQL Editor do Supabase:

```sql
CREATE OR REPLACE FUNCTION buscar_produto(termo TEXT)
RETURNS TABLE(
    id BIGINT,
    descricao TEXT,
    preco_un NUMERIC,
    un TEXT,
    proposta_tiny TEXT,
    data_ref DATE,
    cliente TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id, p.descricao, p.preco_un, p.un, p.proposta_tiny, p.data_ref, p.cliente
    FROM produtos p
    WHERE
        to_tsvector('portuguese', p.descricao) @@ plainto_tsquery('portuguese', termo)
    ORDER BY p.data_ref DESC NULLS LAST
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;
```

---

## Uso do sistema

1. Acesse a URL do frontend
2. Informe o **número da proposta** (verificar no Tiny qual é o próximo)
3. Cole o texto do e-mail **ou** faça upload do arquivo **.msg**
4. Clique **Processar e-mail**
5. Revise os itens e preços (editáveis na tabela)
6. Clique **Baixar CSV Tiny**
7. Importe o CSV no Tiny OList

---

## Custos estimados

| Item | Custo |
|---|---|
| Render backend (free tier) | R$ 0 |
| Render frontend (free tier) | R$ 0 |
| Supabase (free tier) | R$ 0 |
| Claude API por cotação (~3k tokens) | ~R$ 0,08 |
| **10 cotações/dia × 22 dias** | **~R$ 18/mês** |

---

## Variáveis de ambiente necessárias

| Variável | Onde usar | Valor |
|---|---|---|
| `ANTHROPIC_API_KEY` | Backend | Chave da Anthropic |
| `SUPABASE_URL` | Backend | `https://owpmcoithvzdlhmfkvbe.supabase.co` |
| `SUPABASE_KEY` | Backend | Service role key do Supabase |
| `VITE_API_URL` | Frontend | URL do backend no Render |
