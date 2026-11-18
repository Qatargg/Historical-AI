import express from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { generateChatResponse } from './conversationEngine.js';

const app = express();
const port = process.env.PORT || 3001;
const dataPath = fileURLToPath(new URL('./data/conversations.json', import.meta.url));

app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: '16kb' }));

async function getArchive() {
  const file = await readFile(dataPath, 'utf8');
  return JSON.parse(file);
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'echoes-archive' });
});

app.get('/api/figures', async (_request, response) => {
  try {
    const archive = await getArchive();
    response.json({ figures: archive.figures });
  } catch (err) {
    console.error('[Error reading archive]', err);
    response.status(500).json({ error: 'The archive could not be read.' });
  }
});

app.post('/api/chat', async (request, response) => {
  const { figureId, message, history } = request.body ?? {};
  if (typeof figureId !== 'string' || typeof message !== 'string' || !message.trim()) {
    response.status(400).json({ error: 'A figure and question are required.' });
    return;
  }

  try {
    const archive = await getArchive();
    const figure = archive.figures.find((item) => item.id === figureId);
    if (!figure) {
      response.status(404).json({ error: 'That figure is not in the archive.' });
      return;
    }

    const { reply, suggestions, matchedCategory } = generateChatResponse(
      figure,
      message,
      Array.isArray(history) ? history : [],
    );

    response.json({
      reply,
      suggestions,
      category: matchedCategory,
    });
  } catch (err) {
    console.error('[Error in /api/chat]', err);
    response.status(500).json({ error: 'The archive is temporarily unavailable.' });
  }
});

// Real-time streaming response using Server-Sent Events (SSE)
app.post('/api/chat/stream', async (request, response) => {
  const { figureId, message, history } = request.body ?? {};
  if (typeof figureId !== 'string' || typeof message !== 'string' || !message.trim()) {
    response.status(400).json({ error: 'A figure and question are required.' });
    return;
  }

  try {
    const archive = await getArchive();
    const figure = archive.figures.find((item) => item.id === figureId);
    if (!figure) {
      response.status(404).json({ error: 'That figure is not in the archive.' });
      return;
    }

    const { reply: fullReply, suggestions } = generateChatResponse(
      figure,
      message,
      Array.isArray(history) ? history : [],
    );

    // Set SSE headers for live streaming to the browser
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    if (typeof response.flushHeaders === 'function') {
      response.flushHeaders();
    }

    // Stream word-by-word with a short delay to produce a smooth real-time typing effect
    const words = fullReply.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? '' : ' ') + words[i];
      response.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    // Send final completion event with suggestions
    response.write(`data: ${JSON.stringify({ done: true, suggestions })}\n\n`);
    response.end();
  } catch (err) {
    console.error('[Error in /api/chat/stream]', err);
    if (!response.headersSent) {
      response.status(500).json({ error: 'The archive is temporarily unavailable.' });
    } else {
      response.write(`data: ${JSON.stringify({ error: 'The archive is temporarily unavailable.' })}\n\n`);
      response.end();
    }
  }
});

// Webhook endpoint: allows external services (e.g. n8n, Flowise, Make, Botpress, AI agents)
// to trigger or inject messages into the backend
app.post('/api/webhook', async (request, response) => {
  const payload = request.body ?? {};
  console.log('[Webhook Received]', payload);

  response.status(200).json({
    status: 'received',
    timestamp: new Date().toISOString(),
    event: payload.event || 'message.received',
    data: payload,
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: 'That archive route does not exist.' });
});

app.listen(port, () => {
  console.log(`Echoes backend listening on port ${port}`);
});
