import { Card, Tag } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ExpertConfig, ExpertRoundState } from '../types';

interface Props {
  expert: ExpertConfig;
  round: number;
  answer?: ExpertRoundState;
}

/** 单个专家在单个轮次的回答卡片 */
export default function AnswerCard({ expert, round, answer }: Props) {
  const status = answer?.status;
  return (
    <Card
      size="small"
      title={
        <div>
          <Tag color="blue" style={{ fontWeight: 600, fontSize: 13 }}>
            {expert.model}
          </Tag>
          {status === 'streaming' && <Tag color="processing">生成中</Tag>}
          {status === 'error' && <Tag color="error">失败</Tag>}
          {status === 'done' && answer?.completionTokens != null && (
            <Tag color="default">{(answer.promptTokens ?? 0) + (answer.completionTokens ?? 0)} tokens</Tag>
          )}
        </div>
      }
      style={{ height: '100%' }}
      styles={{ body: { maxHeight: '50vh', overflowY: 'auto' } }}
    >
      {!answer ? (
        <span style={{ color: '#999' }}>等待第 {round} 轮发言…</span>
      ) : answer.status === 'error' ? (
        <div style={{ color: '#cf1322' }}>{answer.errorMessage}</div>
      ) : answer.status === 'streaming' ? (
        // 流式中渲染纯文本，避免逐 token 重新解析 Markdown 造成卡顿
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.7 }}>
          {answer.content}
          <span className="cursor">▋</span>
        </div>
      ) : (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.content}</ReactMarkdown>
        </div>
      )}
    </Card>
  );
}
