import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Clock3,
  Feather,
  Menu,
  Moon,
  Send,
  Shield,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';

type Figure = {
  id: string;
  name: string;
  era: string;
  role: string;
  country: string;
  accent: string;
  portrait: string;
  intro: string;
  prompts: string[];
};

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  time: string;
};

type ChatResponse = {
  reply: string;
  suggestions: string[];
};

const API_URL = import.meta.env.VITE_API_URL || '/api';

const fallbackFigures: Figure[] = [
  {
    id: 'cleopatra',
    name: 'Cleopatra VII',
    era: '69–30 BCE',
    role: 'Queen of Egypt',
    country: 'Ptolemaic Egypt',
    accent: '#c58b4b',
    portrait: 'https://images.pexels.com/photos/532826/pexels-photo-532826.jpeg?auto=compress&cs=tinysrgb&w=900',
    intro: 'A gifted ruler, linguist and strategist who made Egypt a force to be reckoned with.',
    prompts: [
      'Did you really hide inside a carpet?',
      'Did a snake really bite you?',
      'Were you Greek or Egyptian?',
      'What options and topics can I ask about?',
    ],
  },
];

const initialMessages: ChatMessage[] = [
  {
    id: 1,
    role: 'assistant',
    content: 'Welcome to the archive. I am Cleopatra VII, last active ruler of the Ptolemaic Kingdom of Egypt. Ask me about power, diplomacy, Alexandria, or the world I knew.',
    time: 'Now',
  },
];

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function App() {
  const [figures, setFigures] = useState<Figure[]>(fallbackFigures);
  const [selectedFigureId, setSelectedFigureId] = useState('cleopatra');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [suggestions, setSuggestions] = useState(fallbackFigures[0].prompts);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const endOfMessages = useRef<HTMLDivElement>(null);

  const selectedFigure = useMemo(
    () => figures.find((figure) => figure.id === selectedFigureId) ?? figures[0],
    [figures, selectedFigureId],
  );

  useEffect(() => {
    fetch(`${API_URL}/figures`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Unable to load figures'))))
      .then((data: { figures: Figure[] }) => {
        if (data.figures.length > 0) {
          setFigures(data.figures);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  function chooseFigure(figure: Figure): void {
    setSelectedFigureId(figure.id);
    setMessages([
      {
        id: Date.now(),
        role: 'assistant',
        content: `Welcome. I am ${figure.name}. ${figure.intro} What would you like to ask me?`,
        time: 'Now',
      },
    ]);
    setSuggestions(figure.prompts);
    setInput('');
    setIsLibraryOpen(false);
  }

  async function sendMessage(messageText: string): Promise<void> {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage || isSending) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: trimmedMessage,
      time: formatTime(new Date()),
    };
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setIsSending(true);

    try {
      // 1. Try real-time streaming response (Server-Sent Events)
      const streamResponse = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figureId: selectedFigure.id, message: trimmedMessage, history }),
      });

      if (streamResponse.ok && streamResponse.body) {
        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        const assistantId = Date.now() + 1;
        let assistantContent = '';
        let hasAppended = false;
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed.startsWith('data:')) continue;
            try {
              const payload = JSON.parse(trimmed.slice(5).trim());
              if (payload.chunk) {
                assistantContent += payload.chunk;
                if (!hasAppended) {
                  hasAppended = true;
                  setMessages((current) => [
                    ...current,
                    {
                      id: assistantId,
                      role: 'assistant',
                      content: assistantContent,
                      time: formatTime(new Date()),
                    },
                  ]);
                } else {
                  setMessages((current) =>
                    current.map((msg) =>
                      msg.id === assistantId ? { ...msg, content: assistantContent } : msg,
                    ),
                  );
                }
              }
              if (payload.suggestions) {
                setSuggestions(payload.suggestions);
              }
            } catch {
              // Ignore unparseable SSE chunks
            }
          }
        }

        if (hasAppended) {
          return;
        }
      }

      // 2. Fallback to standard request if stream wasn't handled
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figureId: selectedFigure.id, message: trimmedMessage, history }),
      });
      if (!response.ok) throw new Error('Chat service unavailable');
      const data = (await response.json()) as ChatResponse;
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, role: 'assistant', content: data.reply, time: formatTime(new Date()) },
      ]);
      setSuggestions(data.suggestions);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: 'assistant',
          content: 'The archive connection is resting for a moment. Please make sure the backend service is running on port 3001, then try your question again.',
          time: formatTime(new Date()),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <div className={isDark ? 'app-shell dark-mode' : 'app-shell'}>
      <aside className={isLibraryOpen ? 'library-panel library-panel-open' : 'library-panel'}>
        <div className="brand-lockup">
          <div className="brand-mark"><Feather size={20} strokeWidth={1.8} /></div>
          <div>
            <p className="eyebrow">The Living Archive</p>
            <h1>Echoes</h1>
          </div>
          <button className="icon-button close-library" aria-label="Close archive menu" onClick={() => setIsLibraryOpen(false)}><X size={19} /></button>
        </div>

        <div className="library-copy">
          <span className="section-kicker">Curated encounters</span>
          <h2>Meet the mind<br />behind the <em>moment.</em></h2>
          <p>Step into a conversation with one of history&apos;s most fascinating figures.</p>
        </div>

        <div className="figure-list" aria-label="Historical figures">
          {figures.map((figure) => (
            <button
              className={selectedFigure.id === figure.id ? 'figure-card figure-card-active' : 'figure-card'}
              key={figure.id}
              onClick={() => chooseFigure(figure)}
            >
              <span className="figure-avatar" style={{ backgroundImage: `url(${figure.portrait})` }} />
              <span className="figure-card-copy">
                <strong>{figure.name}</strong>
                <small>{figure.role}</small>
                <span className="figure-era">{figure.era}</span>
              </span>
              <ChevronRight className="figure-arrow" size={17} />
            </button>
          ))}
        </div>

        <div className="library-footer">
          <div className="archive-stat">
            <span><Users size={15} /> {figures.length}</span>
            <small>{figures.length === 1 ? 'featured figure' : 'featured figures'}</small>
          </div>
          <button className="text-button"><BookOpen size={15} /> Explore the archive <ArrowUpRight size={14} /></button>
        </div>
      </aside>

      <main className="chat-stage">
        <header className="topbar">
          <button className="menu-button" aria-label="Open archive menu" onClick={() => setIsLibraryOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Echoes</span><ChevronRight size={14} /><strong>{selectedFigure.name}</strong></div>
          <div className="topbar-actions">
            <span className="secure-label"><Shield size={14} /> Private session</span>
            <button className="theme-button" aria-label="Toggle colour theme" onClick={() => setIsDark((current) => !current)}>{isDark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button className="profile-button" aria-label="Profile">JD</button>
          </div>
        </header>

        <div className="chat-wrap">
          <section className="conversation-heading">
            <div className="online-status"><span className="status-dot" /> In character · historically grounded</div>
            <h2>A conversation with <span>{selectedFigure.name}</span></h2>
            <p>Ask anything. Follow your curiosity.</p>
          </section>

          <section className="message-stream" aria-live="polite">
            <div className="date-divider"><span /> Today <span /></div>
            {messages.map((message) => (
              <article className={message.role === 'assistant' ? 'message-row assistant-row' : 'message-row user-row'} key={message.id}>
                {message.role === 'assistant' && <div className="message-avatar" style={{ backgroundImage: `url(${selectedFigure.portrait})` }} aria-label={`${selectedFigure.name} portrait`} />}
                <div className="message-stack">
                  <div className={message.role === 'assistant' ? 'message-bubble assistant-bubble' : 'message-bubble user-bubble'}>
                    {message.role === 'assistant' && <span className="bubble-label">{selectedFigure.name}</span>}
                    <p>{message.content}</p>
                  </div>
                  <time>{message.time}</time>
                </div>
              </article>
            ))}
            {isSending && (
              <article className="message-row assistant-row">
                <div className="message-avatar" style={{ backgroundImage: `url(${selectedFigure.portrait})` }} />
                <div className="message-stack"><div className="message-bubble assistant-bubble typing-bubble"><span /><span /><span /></div></div>
              </article>
            )}
            <div ref={endOfMessages} />
          </section>

          <div className="conversation-tools">
            <span className="prompt-label"><Sparkles size={15} /> Try asking</span>
            <div className="prompt-list">
              {suggestions.map((suggestion) => <button key={suggestion} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}
            </div>
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={`Ask ${selectedFigure.name} a question...`} aria-label="Your question" disabled={isSending} />
            <button className="send-button" type="submit" aria-label="Send question" disabled={!input.trim() || isSending}><Send size={18} /></button>
          </form>
          <p className="disclaimer"><CircleHelp size={13} /> Responses are an imaginative interpretation informed by historical sources.</p>
        </div>

        <footer className="chat-footer"><span><Clock3 size={14} /> Sessions are not saved</span><span>Built for curious minds <span className="footer-dot">·</span> v1.0</span></footer>
      </main>
    </div>
  );
}

export default App;
