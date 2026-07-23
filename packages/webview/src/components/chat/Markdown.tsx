/**
 * Markdown — agent 消息正文渲染（react-markdown + remark-gfm）。
 * 代码块高亮从简：样式经 .dn-md（index.css），颜色走 --dn-code-bg token。
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ text }: { text: string }) {
  return (
    <div className="dn-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
