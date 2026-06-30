import { useMemo, useState } from 'react';
import { Card, Button, Space, Empty, Dropdown, Input, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { DownloadOutlined, SendOutlined } from '@ant-design/icons';
import { useDebateStore } from '../store/debateStore';
import TurnView from '../components/TurnView';
import { getApiKey } from '../utils/storage';
import { buildTranscript } from '../utils/transcript';
import { exportJson, exportMarkdown, type ExportData } from '../utils/exporter';

const { TextArea } = Input;

export default function DebatePage() {
  const navigate = useNavigate();
  const { status, experts, turns, maxRounds, conversationId, stopDebate, askFollowUp, continueDebate } =
    useDebateStore();
  const [followUp, setFollowUp] = useState('');

  const exportData = useMemo<ExportData>(
    () => ({
      title: turns[0]?.question ?? '',
      experts,
      turns: turns.map((t) => ({
        question: t.question,
        transcript: buildTranscript(t.answers, t.verdicts, experts),
        finalAnswer: t.finalAnswer,
        costBreakdown: t.costBreakdown,
        totalCost: t.totalCost,
      })),
      totalCost: turns.reduce((s, t) => s + t.totalCost, 0),
    }),
    [turns, experts],
  );

  if (turns.length === 0) {
    return (
      <Empty description="还没有进行中的对话">
        <Button type="primary" onClick={() => navigate('/')}>
          去发起辩论
        </Button>
      </Empty>
    );
  }

  const onSend = () => {
    if (!followUp.trim() || status === 'running') return;
    askFollowUp(followUp.trim(), getApiKey());
    setFollowUp('');
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <strong>对话主题：</strong>
            <span>{turns[0]?.question}</span>
            {conversationId && <Tag>会话 #{conversationId}</Tag>}
          </Space>
          <Space wrap>
            {status === 'running' && (
              <Button danger size="small" onClick={stopDebate}>
                停止
              </Button>
            )}
            <Button size="small" onClick={() => navigate('/')}>
              新对话
            </Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'md', label: '导出 Markdown', onClick: () => exportMarkdown(exportData) },
                  { key: 'json', label: '导出 JSON', onClick: () => exportJson(exportData) },
                ],
              }}
              disabled={status === 'running'}
            >
              <Button size="small" icon={<DownloadOutlined />}>
                导出
              </Button>
            </Dropdown>
          </Space>
        </Space>
      </Card>

      {turns.map((turn, i) => (
        <TurnView
          key={i}
          index={i}
          turn={turn}
          experts={experts}
          maxRounds={maxRounds}
          canContinue={i === turns.length - 1 && conversationId != null}
          running={status === 'running'}
          onContinue={(extraRounds) => continueDebate(extraRounds, getApiKey())}
        />
      ))}

      <Card style={{ position: 'sticky', bottom: 0 }}>
        <Space.Compact style={{ width: '100%' }}>
          <TextArea
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            placeholder={status === 'running' ? '辩论进行中，请等待本轮结束…' : '继续追问（专家将带着此前上下文继续辩论）'}
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={status === 'running'}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={onSend}
            loading={status === 'running'}
            disabled={!followUp.trim()}
          >
            追问
          </Button>
        </Space.Compact>
      </Card>
    </div>
  );
}
