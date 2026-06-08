'use strict';
// OpenAI (ChatGPT) chat adapter — uniform chat({system,user,model}) -> text.
async function chat(opts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set in .env');
  const model = opts.model || process.env.OPENAI_MODEL;
  if (!model) throw new Error('OPENAI_MODEL is not set in .env (or pass --model)');
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: model, temperature: 0,
      messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }]
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error('OpenAI error: ' + ((data.error && data.error.message) || resp.status));
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}
module.exports = { id: 'openai', chat: chat, default_model: function () { return process.env.OPENAI_MODEL; } };
