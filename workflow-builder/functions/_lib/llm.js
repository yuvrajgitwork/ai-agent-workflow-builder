const { renderTemplate, sleep } = require('./util');

// llm_call step. config: { prompt: string, system?: string, model?: string, temperature?: number }
// Uses Groq's free-tier, OpenAI-compatible chat completions API when GROQ_API_KEY is set.
// Falls back to a stubbed response with a disclosed artificial delay otherwise, per the
// assignment's explicit allowance ("a stubbed call with a disclosed artificial delay is fine").
async function callLLM(config, previousOutput) {
  const prompt = renderTemplate(config?.prompt || 'Say hello in one short sentence.', previousOutput);
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    await sleep(800); // disclosed artificial delay standing in for network latency
    return {
      text: `[stubbed LLM response — set GROQ_API_KEY to call a real model] Echo: ${prompt.slice(0, 300)}`,
      stub: true,
    };
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config?.model || 'llama-3.1-8b-instant',
      temperature: config?.temperature ?? 0.3,
      messages: [
        ...(config?.system ? [{ role: 'system', content: config.system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq API error ${res.status}: ${body.slice(0, 400)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return { text, model: data?.model, usage: data?.usage, stub: false };
}

module.exports = { callLLM };
