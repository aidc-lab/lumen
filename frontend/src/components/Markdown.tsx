import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** 轻量 Markdown 渲染（GFM：表格/删除线/任务列表）。 */
export default function Markdown({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
