import { useRef, useCallback, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check } from 'lucide-react'

interface MarkdownRendererProps {
  content: string
  className?: string
}

function getTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getTextContent).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return getTextContent((node as { props?: { children?: React.ReactNode } }).props?.children)
  }
  return ''
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const codeRef = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = codeRef.current?.innerText ?? getTextContent(children)
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [children])

  return (
    <div className="relative my-2">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md bg-dionysus-text-secondary/20 p-1.5 text-dionysus-text-secondary hover:bg-dionysus-text-secondary/30"
        aria-label="复制代码"
      >
        {copied ? (
          <Check className="h-4 w-4 text-dionysus-success" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
      <pre className="markdown-body overflow-x-auto whitespace-pre-wrap break-all">
        <code ref={codeRef}>{children}</code>
      </pre>
    </div>
  )
}

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={`markdown-body break-words ${className}`}
      components={{
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        code: ({ className, children, ...props }) => {
          const isInline = !className
          return isInline ? (
            <code className={className} {...props}>
              {children}
            </code>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
