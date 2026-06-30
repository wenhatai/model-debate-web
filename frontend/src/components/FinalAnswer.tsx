import { Card } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  markdown: string;
  converged?: boolean;
}

export default function FinalAnswer({ markdown, converged = true }: Props) {
  return (
    <Card
      title={converged ? '🏆 共识结论' : '📋 各方结论汇总（未达成共识）'}
      style={{ borderColor: converged ? '#52c41a' : '#faad14' }}
      styles={{ header: { background: converged ? '#f6ffed' : '#fffbe6' } }}
    >
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </Card>
  );
}
