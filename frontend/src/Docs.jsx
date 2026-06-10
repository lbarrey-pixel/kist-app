export default function Docs() {
  const sections = [
    { id: "novidades", label: "Novidades v2.0" },
    { id: "matching", label: "Matching por IA" },
    { id: "entrada", label: "Formas de entrada" },
    { id: "resultados", label: "Entendendo resultados" },
    { id: "passos", label: "Passo a passo" },
    { id: "faq", label: "Perguntas frequentes" },
    { id: "patchnotes", label: "Patch Notes" },
  ];

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 font-sans">

      {/* Header da doc */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold text-slate-800">Documentação</h1>
          <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-0.5 rounded">v2.0</span>
        </div>
        <p className="text-slate-500 text-sm">Manual do usuário e notas de versão do Gerador de Propostas Kist</p>
      </div>

      {/* Índice rápido */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-8">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Neste documento</div>
        <div className="flex flex-wrap gap-2">
          {sections.map(s => (
            <a key={s.id} href={`#${s.id}`}
              className="text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors">
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* ── NOVIDADES ──────────────────────────────────────── */}
      <section id="novidades" className="mb-10">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Novidades v2.0</h2>
        <div className="space-y-3">
          {[
            { tag: "NOVO", color: "bg-blue-100 text-blue-700", title: "Matching por Inteligência Artificial", desc: "O Claude analisa cada item e decide qual produto do banco é o mesmo — eliminando falsos positivos. Fabricante diferente, dimensão diferente ou categoria diferente = sem match." },
            { tag: "NOVO", color: "bg-blue-100 text-blue-700", title: "Indicador de confiança por item", desc: "Cada item recebe um badge: ✓ exato / ~ similar / ⚠ incerto / sem match. Itens incertos mostram o candidato do banco para o operador decidir." },
            { tag: "NOVO", color: "bg-blue-100 text-blue-700", title: "Prints e imagens (Ctrl+V)", desc: "Cole prints de tela, fotos de WhatsApp ou capturas de tela. Até 6 imagens por requisição, combinável com texto ou .msg." },
            { tag: "NOVO", color: "bg-blue-100 text-blue-700", title: "Normalização de descrição", desc: "Especificações em tabela (RAM: 4GB | Tela: 6.5\"...) são convertidas em descrição comercial curta. Specs originais ficam disponíveis para consulta." },
            { tag: "NOVO", color: "bg-blue-100 text-blue-700", title: "Sugestão de PN / modelo", desc: "Para equipamentos de alto valor sem modelo definido, o botão ✦ Sugerir PN sugere 3 opções com fabricante, specs e preço estimado." },
            { tag: "NOVO", color: "bg-blue-100 text-blue-700", title: "Login com Google", desc: "Acesso restrito à equipe Kist via conta Google pessoal. Sem senha para lembrar." },
            { tag: "BANCO", color: "bg-emerald-100 text-emerald-700", title: "Banco enriquecido", desc: "Banco expandido para 4.800+ produtos com histórico de abr/2025 a jun/2026, cobrindo materiais elétricos, telecom, TI e equipamentos industriais." },
          ].map((item, i) => (
            <div key={i} className="flex gap-3 bg-white border border-slate-200 rounded-lg p-3">
              <span className={`text-xs font-bold px-2 py-0.5 rounded h-fit mt-0.5 whitespace-nowrap ${item.color}`}>{item.tag}</span>
              <div>
                <div className="text-sm font-semibold text-slate-800 mb-0.5">{item.title}</div>
                <div className="text-xs text-slate-500">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── MATCHING ──────────────────────────────────────── */}
      <section id="matching" className="mb-10">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Matching por Inteligência Artificial</h2>
        <p className="text-sm text-slate-600 mb-4">O sistema usa dois modelos de IA em sequência: primeiro extrai os itens do e-mail, depois identifica cada item no banco de preços.</p>

        <h3 className="text-sm font-semibold text-slate-700 mb-2">Regras aplicadas pelo modelo</h3>
        <div className="space-y-2 mb-4">
          {[
            "Fabricante diferente → sem match (ex: pedido \"Wetzel\", banco \"Tramontina\" → sem match)",
            "Categoria diferente → sem match (ex: pedido \"canaleta\", banco \"tampa para canaleta\" → sem match)",
            "Dimensão ou bitola diferente → sem match (ex: pedido \"6mm²\", banco \"4mm²\" → sem match)",
            "Cor de cabo não diferencia preço (\"cabo 6mm amarelo\" = \"cabo 6mm azul\" → match exato)",
            "Prefere falso negativo a falso positivo — melhor sem preço do que preço errado",
          ].map((r, i) => (
            <div key={i} className="flex gap-2 text-xs text-slate-600">
              <span className="text-emerald-600 mt-0.5 flex-shrink-0">✓</span>
              <span>{r}</span>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-slate-700 mb-2">Indicadores de confiança</h3>
        <div className="space-y-2">
          {[
            { badge: "✓ exato", bg: "bg-emerald-100 text-emerald-700", desc: "Mesmo produto, mesma spec, mesmo fabricante quando mencionado. Use sem hesitar." },
            { badge: "~ similar", bg: "bg-blue-100 text-blue-700", desc: "Mesmo produto e spec, fabricante não especificado no pedido. Vale uma verificação rápida." },
            { badge: "⚠ incerto", bg: "bg-amber-100 text-amber-700", desc: "Candidato encontrado mas com dúvida. Descrição original preservada, preço do candidato preenchido, candidato exibido para conferência." },
            { badge: "sem match", bg: "bg-red-100 text-red-700", desc: "Produto não encontrado ou fabricante conflitante. Preço zerado — cotar manualmente." },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg p-3">
              <span className={`text-xs font-bold px-2 py-0.5 rounded whitespace-nowrap ${item.bg}`}>{item.badge}</span>
              <span className="text-xs text-slate-600">{item.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── ENTRADA ──────────────────────────────────────── */}
      <section id="entrada" className="mb-10">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Formas de entrada aceitas</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: "📧", title: "Arquivo .msg", desc: "Arraste do Outlook ou clique para selecionar. PDFs e planilhas Excel anexos são lidos automaticamente." },
            { icon: "📋", title: "Texto colado", desc: "Cole o conteúdo do e-mail no campo de texto. Funciona com qualquer formato." },
            { icon: "🖼", title: "Prints (Ctrl+V)", desc: "Pressione Ctrl+V para colar imagens. Funciona com prints de tela, fotos de WhatsApp e capturas. Até 6 imagens." },
            { icon: "📎", title: "Anexos automáticos", desc: "PDFs, Excel e CSV anexados ao .msg são extraídos e analisados automaticamente sem ação do usuário." },
          ].map((item, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-3">
              <div className="text-2xl mb-2">{item.icon}</div>
              <div className="text-sm font-semibold text-slate-800 mb-1">{item.title}</div>
              <p className="text-xs text-slate-500 m-0">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── RESULTADOS ──────────────────────────────────── */}
      <section id="resultados" className="mb-10">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Entendendo os resultados</h2>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left p-2 border border-slate-200 text-slate-500 font-semibold">Badge</th>
              <th className="text-left p-2 border border-slate-200 text-slate-500 font-semibold">Significa</th>
              <th className="text-left p-2 border border-slate-200 text-slate-500 font-semibold">O que fazer</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["✓ exato", "bg-emerald-100 text-emerald-700", "Produto identificado com alta confiança", "Nada — pode baixar direto"],
              ["~ similar", "bg-blue-100 text-blue-700", "Mesmo produto, fabricante não especificado", "Verificar se o fabricante do banco é aceitável"],
              ["⚠ incerto", "bg-amber-100 text-amber-700", "Candidato encontrado com dúvida. Descrição original preservada, preço preenchido", "Ler o candidato exibido e confirmar se é o mesmo produto"],
              ["sem match", "bg-red-100 text-red-700", "Produto não encontrado ou fabricante conflitante", "Cotar com fornecedor e preencher o preço manualmente"],
            ].map(([badge, cls, sig, acao], i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                <td className="p-2 border border-slate-200"><span className={`px-2 py-0.5 rounded font-bold text-xs ${cls}`}>{badge}</span></td>
                <td className="p-2 border border-slate-200 text-slate-600">{sig}</td>
                <td className="p-2 border border-slate-200 text-slate-600">{acao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── PASSO A PASSO ──────────────────────────────── */}
      <section id="passos" className="mb-10">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Passo a passo</h2>
        <div className="space-y-4">
          {[
            ["Faça login", "Acesse a URL e clique em \"Entrar com Google\". Use sua conta Gmail pessoal cadastrada pela Kist."],
            ["Verifique o número da proposta", "O sistema sugere o próximo número automaticamente. Confirme no Tiny antes — especialmente se outra pessoa da equipe estiver usando ao mesmo tempo."],
            ["Envie o e-mail ou prints", "Arraste o .msg do Outlook, pressione Ctrl+V para colar prints, ou cole o texto no campo abaixo. Prints e texto podem ser combinados na mesma requisição."],
            ["Clique em \"Processar e-mail\"", "O sistema extrai os itens e faz o matching com o banco. Aguarde ~8-12 segundos."],
            ["Revise os alertas no topo", "Se houver itens sem match ou incertos, um aviso aparece. Para os incertos, verifique o candidato sugerido. Para os sem match, preencha o preço após cotar."],
            ["Confirmar e baixar CSV", "O CSV é baixado e o banco de preços é atualizado automaticamente. Nunca abra o CSV no Excel antes de importar no Tiny."],
            ["Importe no Tiny OList", "Vendas → Propostas Comerciais → Importar → selecione o CSV → confirme."],
          ].map(([titulo, desc], i) => (
            <div key={i} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</div>
              <div>
                <div className="text-sm font-semibold text-slate-800 mb-0.5">{titulo}</div>
                <p className="text-xs text-slate-500 m-0">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <section id="faq" className="mb-10">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Perguntas frequentes</h2>
        <div className="space-y-3">
          {[
            ["O matching por IA é mais lento que antes?", "Sim, ~8-12s ao invés de ~5s. O ganho em precisão compensa — antes retornava produtos errados com confiança, agora é rigoroso e transparente."],
            ["O Ctrl+V não está colando a imagem.", "Para prints do WhatsApp Web, clique com botão direito na imagem → \"Copiar imagem\" e depois Ctrl+V. Para capturas de tela, use Print Screen ou Win+Shift+S antes de colar."],
            ["O sistema sugeriu um PN mas o preço estimado está errado.", "O preço de sugestão é estimativa de mercado — sempre confirme com o fornecedor. Edite o campo de preço diretamente na tabela."],
            ["Um item ficou como incerto mas sei que é o mesmo produto.", "O preço já está preenchido com o valor do banco. Verifique se está correto e baixe normalmente. A descrição preservada é a do cliente."],
            ["Fui deslogado no meio do trabalho.", "O token do Google dura 1 hora. Faça login novamente. Se estava no meio de uma proposta, precisará reprocessar o e-mail."],
            ["Posso usar em celular?", "Sim, mas Ctrl+V de imagens e drag & drop não funcionam em celular. Use a opção de colar texto ou faça upload do arquivo."],
            ["Posso combinar prints com texto na mesma requisição?", "Sim. Cole os prints com Ctrl+V e depois cole ou escreva o texto complementar no campo de texto. O sistema analisa tudo junto."],
          ].map(([q, a], i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-3">
              <div className="text-sm font-semibold text-slate-800 mb-1">{q}</div>
              <p className="text-xs text-slate-500 m-0">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PATCH NOTES ──────────────────────────────────── */}
      <section id="patchnotes" className="mb-10">
        <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Patch Notes v2.0</h2>
        <div className="space-y-6">
          {[
            {
              titulo: "Matching por Inteligência Artificial",
              problema: "O sistema buscava produtos por palavras em comum. \"Tampa cega Wetzel\" podia retornar \"Tampa para canaleta Tramontina\" porque ambos tinham a palavra \"Tampa\". Resultado: preços errados entravam nas propostas sem que o operador percebesse.",
              solucao: "O Claude analisa semanticamente se os itens são o mesmo produto. As regras são rígidas: fabricante diferente = sem match. Categoria diferente = sem match. Dimensão diferente = sem match.",
              racional: "O custo de um falso positivo (preço errado entregue ao cliente) é muito maior que o de um falso negativo (item zerado que o operador vai cotar).",
            },
            {
              titulo: "Descrição original preservada nos matches incertos",
              problema: "Quando havia match incerto, o sistema substituía a descrição do cliente pela do banco.",
              solucao: "A descrição que vai para o CSV é sempre a que o cliente enviou — exatamente como veio. O candidato do banco aparece apenas como referência.",
              racional: "O cliente escreveu o que quer comprar. Substituir silenciosamente por outra descrição cria risco de entregar uma proposta com item diferente do solicitado.",
            },
            {
              titulo: "Suporte a prints e imagens",
              problema: "Cotações que chegavam por WhatsApp como print ou foto precisavam ser transcritas manualmente.",
              solucao: "Ctrl+V em qualquer momento cola imagens. Prints de WhatsApp Web, capturas de tela e fotos funcionam. Até 6 imagens por requisição, combinável com texto.",
              racional: "Eliminar a transcrição manual reduz erros e tempo de processamento.",
            },
            {
              titulo: "Normalização de descrição",
              problema: "Especificações em formato de tabela (RAM: 4GB | Tela: 6.5\" | ...) eram copiadas inteiras como descrição — longas e incompatíveis com o Tiny.",
              solucao: "O sistema gera uma descrição comercial curta a partir das specs. As specs originais ficam no campo \"Descrição complementar\" do CSV.",
              racional: "O Tiny tem limite de caracteres no campo descrição. Uma tabela de specs não é legível em uma proposta comercial.",
            },
            {
              titulo: "Sugestão de PN/modelo",
              problema: "Itens como \"Desktop Core i5 16GB 512GB\" sem marca exigiam pesquisa manual para definir qual modelo cotar.",
              solucao: "O botão ✦ Sugerir PN aparece apenas em itens de alto valor sem modelo definido. Sugere 3 opções com specs e preço estimado.",
              racional: "A sugestão de modelo é uma decisão comercial. O sistema informa, o operador decide — por isso não é automático.",
            },
            {
              titulo: "Login com Google",
              problema: "Sem autenticação, qualquer pessoa com a URL poderia consultar preços praticados ou inserir dados incorretos no banco.",
              solucao: "Login via Google restrito à lista de e-mails cadastrados pela Kist.",
              racional: "Senhas são esquecidas e compartilhadas. O Google gerencia a autenticação de forma segura e o operador já usa a conta no dia a dia.",
            },
          ].map((item, i) => (
            <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                <span className="text-sm font-semibold text-slate-800">{item.titulo}</span>
              </div>
              <div className="p-4 space-y-2">
                <div>
                  <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Antes</span>
                  <p className="text-xs text-slate-600 mt-1 m-0">{item.problema}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Agora</span>
                  <p className="text-xs text-slate-600 mt-1 m-0">{item.solucao}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Por quê</span>
                  <p className="text-xs text-slate-600 mt-1 m-0">{item.racional}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="text-center text-xs text-slate-400 pt-4 border-t border-slate-200">
        Kist Soluções em Telecom e Energia &nbsp;·&nbsp; v2.0 Jun/2026
      </div>
    </div>
  );
}
