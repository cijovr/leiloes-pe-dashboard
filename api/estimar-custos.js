module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada.' });

  const { tipo, area, bairro, cidade, uf, lance } = req.body || {};
  if (!bairro || !cidade) return res.status(400).json({ error: 'bairro e cidade obrigatórios' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Você é um especialista em mercado imobiliário brasileiro.

Estime os valores mensais de IPTU e condomínio para este imóvel:
- Tipo: ${tipo||'Apartamento'}
- Área aproximada: ${area||'60'}m²
- Bairro: ${bairro}
- Cidade: ${cidade}${uf?'/'+uf:''}
- Valor de avaliação: R$ ${lance ? Math.round(lance).toLocaleString('pt-BR') : 'não informado'}

Com base no seu conhecimento do mercado imobiliário deste bairro e cidade, forneça estimativas realistas.

Responda APENAS com JSON puro, sem texto, sem markdown:
{
  "iptu_mensal": 250,
  "condominio_mensal": 400,
  "iptu_anual": 3000,
  "condominio_nota": "Bairro popular, condomínios simples",
  "iptu_nota": "Alíquota municipal estimada sobre valor venal",
  "confianca": "media",
  "fonte": "Estimativa baseada em imóveis similares no bairro ${bairro}, ${cidade}"
}`
        }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.error?.message || 'Erro na API' });

    const text = data.content?.map(c => c.text || '').join('') || '';
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const result = JSON.parse(clean);
      return res.status(200).json(result);
    } catch(e) {
      return res.status(200).json({ error: 'Não foi possível parsear a estimativa', raw: text.substring(0, 200) });
    }
  } catch(err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
};
