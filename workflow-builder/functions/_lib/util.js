function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

// Replaces {{input}} in a template string with the previous step's output,
// so step config can chain outputs into the next step's prompt/url/body.
function renderTemplate(str, previousOutput) {
  const inputStr =
    previousOutput && typeof previousOutput === 'object' && 'text' in previousOutput
      ? String(previousOutput.text)
      : previousOutput !== undefined && previousOutput !== null
      ? JSON.stringify(previousOutput)
      : '';
  return String(str).replace(/\{\{\s*input\s*\}\}/g, inputStr);
}

function getByPath(obj, path) {
  if (!path) return obj;
  return path
    .split('.')
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
}

// Evaluates a conditional_branch step's config against the previous step's output.
// config: { field?: string, operator?: 'contains'|'not_contains'|'equals'|'truthy', value?: any, skip_if_false?: number }
function evaluateCondition(config, previousOutput) {
  const { field, operator = 'contains', value } = config || {};
  const subject = field
    ? getByPath(previousOutput, field)
    : previousOutput?.text ?? previousOutput?.body ?? previousOutput;

  if (operator === 'truthy') return Boolean(subject);

  const subjectStr = typeof subject === 'string' ? subject : JSON.stringify(subject ?? '');
  const valueStr = String(value ?? '');

  switch (operator) {
    case 'contains':
      return subjectStr.toLowerCase().includes(valueStr.toLowerCase());
    case 'not_contains':
      return !subjectStr.toLowerCase().includes(valueStr.toLowerCase());
    case 'equals':
      return subjectStr.trim().toLowerCase() === valueStr.trim().toLowerCase();
    default:
      return Boolean(subject);
  }
}

module.exports = { sleep, nowIso, renderTemplate, getByPath, evaluateCondition };
