import { Leaf, User } from 'lucide-react';
import { ChatMessage as ChatMessageType } from '../types';

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isAI = message.role === 'assistant' || message.role === 'ai';

  return (
    <div className={`flex ${isAI ? 'justify-start' : 'justify-end'} mb-4`}>
      <div className={`flex gap-3 ${isAI ? '' : 'flex-row-reverse'}`}>
        {/* avatar */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            isAI
              ? 'bg-gradient-to-br from-[#4CAF50] to-[#2EB872]'
              : 'bg-gray-200'
          }`}
        >
          {isAI ? (
            <Leaf size={16} className="text-white" />
          ) : (
            <User size={16} className="text-gray-600" />
          )}
        </div>

        {/* bubble */}
        <div className="max-w-[75%]">
          <div
            className={`text-[11px] mb-1 ${
              isAI ? 'text-[#2EB872]' : 'text-gray-500 text-right'
            }`}
          >
            {isAI ? 'DyikanAI' : 'You'}
          </div>

          <div
            className={`rounded-2xl px-4 py-3 ${
              isAI
                ? 'bg-[#4CAF50] text-white'
                : 'bg-white border border-gray-200 text-gray-800'
            }`}
          >
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {message.content}
            </p>

            <p className={`text-xs mt-2 ${isAI ? 'text-green-100' : 'text-gray-400'}`}>
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
