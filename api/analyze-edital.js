module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no Vercel.' });

  const { pdfBase64, mode, part } = req.body || {};
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 obrigatório' });

  const prompt = mode === 'bulk'
    ? `Você é um especialista em leilões de imóveis no Brasil. Analise este trecho do edital e extraia TODOS os imóveis listados neste trecho. Responda APENAS com um array JSON válido, sem texto antes ou depois, sem markdown, sem blocos de código. Se não houver imóveis neste trecho, responda com array vazio []. Formato: [{"lote":"180","titulo":"Casa 67,5m² — 2 qts, garagem","endereco":"Rua X, bairro, cidade/PE","tipo":"Casa","lance1":155000,"lance2":147325,"avaliacao":155000,"data1":"2026-07-06","data2":"2026-07-10","leiloeiro":"Fernando C. Moreira Filho — mgl.com.br","link":"https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp","matricula":"5530","obs":"débitos, riscos, gravames","modalidade":"Leilão SFI — Edital Único"}]`
    : `Analise este edital de leilão. Extraia: 1) Imóvel: tipo, endereço, área 2) Valores: lance 1ª e 2ª praça, avaliação 3) Datas das sessões 4) Pagamento: à vista/FGTS/financiamento 5) Débitos 6) Situação: ocupado/desocupado 7) Leiloeiro 8) Riscos. Use bullet points.`;

  async function callClaude(b64) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });
    return r;
  }

  async function splitPdf(b64, startPage, endPage) {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdfBytes = Buffer.from(b64, 'base64');
      const srcDoc = await PDFDocument.load(pdfBytes);
      const newDoc = await PDFDocument.create();
      const total = srcDoc.getPageCount();
      const end = Math.min(endPage, total - 1);
      const pages = await newDoc.copyPages(srcDoc, Array.from({length: end - startPage + 1}, (_, i) => startPage + i));
      pages.forEach(p => newDoc.addPage(p));
      const newBytes = await newDoc.save();
      return Buffer.from(newBytes).toString('base64');
    } catch(e) {
      throw new Error('Erro ao dividir PDF: ' + e.message);
    }
  }

  try {
    if (mode === 'bulk') {
      // Split PDF into two parts: pages 0-79 and 80-141
      let part1b64, part2b64;
      try {
        part1b64 = await splitPdf(pdfBase64, 0, 79);
        part2b64 = await splitPdf(pdfBase64, 80, 141);
      } catch(e) {
        return res.status(500).json({ error: 'Erro ao dividir PDF: ' + e.message });
      }

      // Process both parts
      const [r1, r2] = await Promise.all([callClaude(part1b64), callClaude(part2b64)]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);

      if (!r1.ok) return res.status(r1.status).json({ error: d1.error?.message || 'Erro parte 1' });
      if (!r2.ok) return res.status(r2.status).json({ error: d2.error?.message || 'Erro parte 2' });

      const t1 = d1.content?.map(c => c.text || '').join('\n') || '';
      const t2 = d2.content?.map(c => c.text || '').join('\n') || '';

      let imoveis = [];
      for (const t of [t1, t2]) {
        try {
          const clean = t.replace(/```json|```/g, '').trim();
          const arr = JSON.parse(clean);
          if (Array.isArray(arr)) imoveis = imoveis.concat(arr);
        } catch(e) { /* skip if no imoveis in this part */ }
      }

      return res.status(200).json({ imoveis, count: imoveis.length });

    } else {
      // Single page analysis - try direct first
      const r = await callClaude(pdfBase64);
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.error?.message || 'Erro na API' });
      const text = d.content?.map(c => c.text || '').join('\n') || '';
      return res.status(200).json({ analysis: text });
    }

  } catch(err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
};
