import { useState } from 'react';
import { Send } from 'lucide-react';
import ChatMessage from '../ChatMessage';
import { ChatMessage as ChatMessageType } from '../../types';

const SYSTEM_PROMPT = `Ты — DyikanAI, AI-ассистент для управления умной теплицей.

ЯЗЫК ОТВЕТА:
- Если пользователь пишет на русском — отвечай ТОЛЬКО на русском.
- Если пользователь пишет на кыргызском — отвечай ТОЛЬКО на кыргызском.
- Никогда не смешивай языки в одном ответе.

ТВОИ ЗАДАЧИ:
- Анализировать показатели теплицы: температура, влажность воздуха, влажность почвы, освещение, CO₂.
- Давать краткие, точные и технические ответы.
- Предлагать практические рекомендации по управлению устройствами: насос, вентилятор, обогреватель, лампа.
- Предупреждать о критических значениях датчиков.

СТИЛЬ:
- Краткость и конкретность.
- Используй цифры и единицы измерения.
- Если данных недостаточно — запроси уточнение.`;

export default function AIChatPage() {
  const [messages, setMessages] = useState<ChatMessageType[]>([
    {
      id: '1',
      role: 'assistant',
      content:
        'Привет! Я DyikanAI — ИИ-ассистент вашей умной теплицы.\n\nЯ помогу вам с анализом температуры, влажности, почвы, освещения и управлением устройствами.\n\nСаламатсызбы! Кыргызча да жазсаңыз болот — мен түшүнөм.',
      timestamp: new Date().toISOString(),
    },
  ]);

  const [inputValue, setInputValue] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  const handleSend = async () => {
    if (!inputValue.trim() || isThinking) return;

    const question = inputValue.trim();

    const userMessage: ChatMessageType = {
      id: Date.now().toString(),
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsThinking(true);

    try {
      const ollamaMessages = [...messages, userMessage].map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }));

      const response = await fetch('/ollama/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.1:8b',
          messages: [
            {
              role: 'system',
              content: SYSTEM_PROMPT,
            },
            ...ollamaMessages,
          ],
          stream: false,
          options: {
            temperature: 0.3,
            top_p: 0.9,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const answer =
        data?.message?.content ?? 'Модель не вернула ответ.';

      const aiMessage: ChatMessageType = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: answer,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 2).toString(),
          role: 'assistant',
          content:
            '⚠️ Ollama серверіне қосылу мүмкін болмады.\n\nOllama запущен ба? `ollama run llama3.1:8b` командасын текшериңиз.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)]">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#164A41] mb-2">
          AI Chat Assistant
        </h1>
        <p className="text-gray-600">
          Умная теплица · Акылдуу жылымкана · llama3.1:8b
        </p>
      </div>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {isThinking && (
            <div className="flex items-center gap-2 text-sm text-gray-400 italic">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce [animation-delay:0.15s]">●</span>
                <span className="animate-bounce [animation-delay:0.3s]">●</span>
              </span>
              DyikanAI думает/ойлонуп жатат…
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 p-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Спросите о температуре, влажности... / Температура, нымдуулук жөнүндө сураңыз..."
              className="flex-1 px-4 py-3 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#4CAF50] focus:border-transparent"
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || isThinking}
              className="px-6 py-3 bg-gradient-to-r from-[#4CAF50] to-[#2EB872] text-white rounded-2xl hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
            >
              <Send size={18} />
              {isThinking ? '…' : 'Отправить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}