import MarkdownRenderer from './MarkdownRenderer'

interface UserMessageProps {
  content: string
}

export default function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <div className="cel-bubble-user max-w-3/4 min-w-0 overflow-hidden sm:max-w-2/3 rounded-2xl rounded-tr-sm px-4 py-2.5 text-white">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
