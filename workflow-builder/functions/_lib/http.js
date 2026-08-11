const { renderTemplate } = require('./util');

// http_request step. config: { url: string, method?: string, headers?: object, body?: object|string }
// {{input}} inside url/body is replaced with the previous step's output.
async function callHttp(config, previousOutput) {
  const url = renderTemplate(config?.url || 'https://jsonplaceholder.typicode.com/todos/1', previousOutput);
  const method = (config?.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(config?.headers || {}) };

  let body;
  if (method !== 'GET' && method !== 'HEAD' && config?.body !== undefined) {
    const raw = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
    body = renderTemplate(raw, previousOutput);
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();

  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 400)}`);
  }

  return { status: res.status, body: parsed };
}

module.exports = { callHttp };
