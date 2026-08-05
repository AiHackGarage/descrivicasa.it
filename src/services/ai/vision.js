const fs = require('fs');
const path = require('path');
const { OPENROUTER_API_KEY, VISION_MODEL, OPENROUTER_BASE, PLAN_CONFIG } = require('../../config');
const { SYSTEM_PROMPT, USER_PROMPT, buildPropertyPrompt } = require('./prompts');

function encodeImage(filepath) {
  return fs.readFileSync(filepath, { encoding: 'base64' });
}

function getMime(ext) {
  const mimeMap = { png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return mimeMap[ext] || 'image/jpeg';
}

async function callVisionAPI(imagePaths, systemContent, userText, options = {}) {
  const content = [{ type: 'text', text: userText }];

  for (const fp of imagePaths) {
    if (!fs.existsSync(fp)) continue;
    const b64 = encodeImage(fp);
    const ext = path.extname(fp).toLowerCase().replace('.', '');
    content.push({
      type: 'image_url',
      image_url: { url: `data:${getMime(ext)};base64,${b64}` },
    });
  }

  const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://descrivicasa.it',
      'X-Title': 'DescriviCasa',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content },
      ],
      max_tokens: options.maxTokens || 2048,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    return { error: `API error ${resp.status}: ${await resp.text()}` };
  }

  const data = await resp.json();
  try {
    return {
      description: data.choices[0].message.content,
      model: data.model || VISION_MODEL,
      tokens: data.usage || {},
    };
  } catch (e) {
    return { error: 'Unexpected API response', raw: data };
  }
}

async function describeProperty(imagePaths, lang = 'it', plan = 'free') {
  const cfg = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const wordLimit = cfg.wordLimit;
  const systemContent = (lang === 'it' ? SYSTEM_PROMPT : SYSTEM_PROMPT.replace(/italiano/g, 'English').replace(/italiane/g, 'Italian'))
    .replace(/Non superare le \d+ parole in totale/, `Non superare le ${wordLimit} parole in totale`);
  const userText = lang === 'it' ? USER_PROMPT : USER_PROMPT.replace(/italiano/g, 'English');
  return callVisionAPI(imagePaths, systemContent, userText, { maxTokens: cfg.maxTokens });
}

async function describePropertyWithData(imagePaths, propertyData, plan = 'free') {
  const cfg = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const systemContent = SYSTEM_PROMPT.replace(/Non superare le \d+ parole in totale/, `Non superare le ${cfg.wordLimit} parole in totale`);
  return callVisionAPI(imagePaths, systemContent, buildPropertyPrompt(propertyData), { maxTokens: cfg.maxTokens });
}

module.exports = { encodeImage, getMime, callVisionAPI, describeProperty, describePropertyWithData };
