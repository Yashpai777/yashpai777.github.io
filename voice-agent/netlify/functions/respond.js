const OpenAI = require('openai');
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const kugel = new ElevenLabsClient({
  apiKey: process.env.KUGEL_API_KEY,
  baseUrl: 'https://api.kugelaudio.com/11labs',
});

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { audioBase64, mimeType, systemPrompt, history } = JSON.parse(event.body || '{}');
    if (!audioBase64 || !systemPrompt) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing audioBase64 or systemPrompt' }) };
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const audioFile = await OpenAI.toFile(audioBuffer, `speech.${(mimeType || 'audio/webm').split('/')[1] || 'webm'}`);
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });
    const userText = transcription.text.trim();

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(Array.isArray(history) ? history : []),
      { role: 'user', content: userText },
    ];
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages,
    });
    const assistantText = completion.choices[0].message.content.trim();

    const ttsStream = await kugel.textToSpeech.convert(process.env.KUGEL_VOICE_ID || '480', {
      text: assistantText,
      modelId: 'kugel-3',
      outputFormat: 'mp3_44100_128',
    });
    const audioOut = await streamToBuffer(ttsStream);

    return {
      statusCode: 200,
      body: JSON.stringify({
        userText,
        assistantText,
        audioBase64: audioOut.toString('base64'),
        audioMimeType: 'audio/mpeg',
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
