interface SystemStatusProps {
  content: string
}

export default function SystemStatus({ content }: SystemStatusProps) {
  return (
    <div className="flex justify-center">
      <p className="max-w-4/5 rounded-full bg-dionysus-glass-highlight px-3 py-1 text-center text-xs text-dionysus-text-secondary sm:text-sm">
        {content}
      </p>
    </div>
  )
}
