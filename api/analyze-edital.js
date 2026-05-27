export default async function handler(req, res) {
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
    ? `Você é um especialista em leilões de imóveis no Brasil. Analise este edital completo e extraia TODOS os imóveis listados.

Para cada imóvel retorne um objeto JSON. Responda APENAS com um array JSON válido, sem texto antes ou depois, sem markdown, sem blocos de código.

Formato obrigatório:
[
  {
    "lote": "180",
    "titulo": "Casa 67,5m² — 2 qts, garagem",
    "endereco": "Rua José de Arimatéia Simplicio, SN, Lt 25 — Nova Altinho, Altinho/PE",
    "tipo": "Casa",
    "lance1": 155000,
    "lance2": 147325,
    "avaliacao": 155000,
    "data1": "2026-07-06",
    "data2": "2026-07-10",
    "leiloeiro": "Fernando C. Moreira Filho — mgl.com.br",
    "link": "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp",
    "matricula": "5530",
    "obs": "Observações relevantes, débitos, riscos jurídicos",
    "modalidade": "Leilão SFI — Edital Único"
  }
]

Extraia TODOS os imóveis do edital. Não resuma, não pule nenhum. Inclua todas as observações importantes como gravames, penhoras, imóvel ocupado, débitos de IPTU/condomínio.`
    : `Analise este edital de leilão. Extraia: 1) Imóvel: tipo, endereço, área 2) Valores: lance 1ª e 2ª praça, avaliação 3) Datas das sessões 4) Pagamento: à vista/FGTS/financiamento 5) Débitos: IPTU, condomínio 6) Situação: ocupado/desocupado 7) Leiloeiro: nome, site, comissão 8) Riscos jurídicos. Use bullet points.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erro na API Anthropic' });

    const text = data.content?.map(c => c.text || '').join('\n') || '';

    if (mode === 'bulk') {
      try {
        const clean = text.replace(/```json|```/g, '').trim();
        const imoveis = JSON.parse(clean);
        return res.status(200).json({ imoveis, count: imoveis.length });
      } catch (e) {
        return res.status(200).json({ error: 'Não foi possível parsear os imóveis. Resposta bruta:', raw: text });
      }
    }

    return res.status(200).json({ analysis: text });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
