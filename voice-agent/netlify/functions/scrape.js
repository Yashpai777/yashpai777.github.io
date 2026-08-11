const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { url } = JSON.parse(event.body || '{}');
    if (!url) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing url' }) };
    }

    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items?token=${process.env.APIFY_API_KEY}&timeout=60`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [{ url }], maxCrawlPages: 5, crawlerType: 'cheerio', maxCrawlDepth: 1 }),
      }
    );
    if (!apifyRes.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not read the website. Check the URL and try again.' }) };
    }
    const items = await apifyRes.json();
    const content = items.map(i => i.text || i.markdown || '').filter(Boolean).join('\n\n').slice(0, 12000);
    if (!content || content.length < 50) {
      return { statusCode: 422, body: JSON.stringify({ error: 'Not enough content found on this website.' }) };
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [
        { role: 'system', content: 'Create a voice AI agent system prompt from website content. Keep responses 1-3 sentences. Sound natural and conversational. Be knowledgeable, friendly, and professional. Return ONLY the system prompt.' },
        { role: 'user', content: `Website: ${url}\n\nContent:\n${content}` },
      ],
    });
    const systemPrompt = completion.choices[0].message.content.trim();

    let host = url;
    try { host = new URL(url).hostname; } catch {}

    return { statusCode: 200, body: JSON.stringify({ systemPrompt, host }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
