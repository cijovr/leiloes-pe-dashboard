module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no Vercel.' });

  const { pdfBase64, mode } = req.body || {};
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 obrigatório' });

  const prompt = mode === 'bulk'
    ? `Você é um especialista em leilões de imóveis no Brasil. Analise este trecho do edital e extraia TODOS os imóveis listados neste trecho. Responda APENAS com um array JSON válido, sem texto antes ou depois, sem markdown, sem blocos de código. Se não houver imóveis neste trecho, responda com []. Formato: [{"lote":"180","titulo":"Casa 67,5m²","endereco":"Rua X, bairro, cidade/PE","tipo":"Casa","lance1":155000,"lance2":147325,"avaliacao":155000,"data1":"2026-07-06","data2":"2026-07-10","leiloeiro":"Fernando C. Moreira Filho — mgl.com.br","link":"https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp","matricula":"5530","obs":"débitos, riscos, gravames","modalidade":"Leilão SFI — Edital Único"}]`
    : `Analise este edital de leilão. Extraia: 1) Imóvel: tipo, endereço, área 2) Valores: lance 1ª e 2ª praça, avaliação 3) Datas das sessões 4) Pagamento 5) Débitos 6) Situação 7) Leiloeiro 8) Riscos. Use bullet points.`;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function splitPdf(b64, startPage, endPage) {
    const { PDFDocument } = await import('pdf-lib');
    const pdfBytes = Buffer.from(b64, 'base64');
    const srcDoc = await PDFDocument.load(pdfBytes);
    const newDoc = await PDFDocument.create();
    const total = srcDoc.getPageCount();
    const end = Math.min(endPage, total - 1);
    const indices = Array.from({length: end - startPage + 1}, (_, i) => startPage + i);
    const pages = await newDoc.copyPages(srcDoc, indices);
    pages.forEach(p => newDoc.addPage(p));
    const bytes = await newDoc.save();
    return Buffer.from(bytes).toString('base64');
  }

  async function callClaude(b64) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });
    const d = await r.json();
    return { ok: r.ok, status: r.status, data: d };
  }

  try {
    if (mode === 'bulk') {
      // Split into 3 parts sequentially to avoid rate limits
      let imoveis = [];

      const parts = [
        { start: 0, end: 46 },
        { start: 47, end: 93 },
        { start: 94, end: 141 }
      ];

      for (let i = 0; i < parts.length; i++) {
        const { start, end } = parts[i];
        const partB64 = await splitPdf(pdfBase64, start, end);
        
        // Wait 3 seconds between requests to respect rate limit
        if (i > 0) await sleep(3000);
        
        const r = await callClaude(partB64);
        if (!r.ok) return res.status(r.status).json({ error: `Erro na parte ${i+1}: ${r.data.error?.message || 'Erro na API'}` });

        const text = r.data.content?.map(c => c.text || '').join('\n') || '';
        try {
          const clean = text.replace(/```json|```/g, '').trim();
          const arr = JSON.parse(clean);
          if (Array.isArray(arr)) imoveis = imoveis.concat(arr);
        } catch(e) { /* no imoveis in this part */ }
      }

      return res.status(200).json({ imoveis, count: imoveis.length });

    } else {
      const r = await callClaude(pdfBase64);
      if (!r.ok) return res.status(r.status).json({ error: r.data.error?.message || 'Erro na API' });
      const text = r.data.content?.map(c => c.text || '').join('\n') || '';
      return res.status(200).json({ analysis: text });
    }

  } catch(err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
};
