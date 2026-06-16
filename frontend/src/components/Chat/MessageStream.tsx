import type { ChatMessage } from '@/types/protocol'
import UserMessage from './UserMessage'
import AgentMessage from './AgentMessage'
import StreamingStatusBox from './StreamingStatusBox'
import SystemStatus from './SystemStatus'

interface MessageStreamProps {
  messages: ChatMessage[]
}

export default function MessageStream({ messages }: MessageStreamProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-4">
      {messages.map((message) => {
        if (message.role === 'user') {
          return <UserMessage key={message.id} content={message.content} />
        }
        if (message.role === 'system') {
          return <SystemStatus key={message.id} content={message.content} />
        }
        if (message.status === 'streaming') {
          return (
            <StreamingStatusBox
              key={message.id}
              content={message.content}
            />
          )
        }
        return (
          <AgentMessage
            key={message.id}
            content={message.content}
            status={message.status}
          />
        )
      })}
    </div>
  )
}
