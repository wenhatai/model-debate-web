import { useMemo, useState } from 'react';
import { Row, Col, Card, Spin, Alert, Tag, Divider, Button, Select, Space } from 'antd';
import AnswerCard from './AnswerCard';
import CostPanel from './CostPanel';
import FinalAnswer from './FinalAnswer';
import type { ExpertConfig } from '../types';
import type { TurnState } from '../store/debateStore';

interface Props {
  index: number;
  turn: TurnState;
  experts: ExpertConfig[];
  maxRounds: number;
  canContinue?: boolean;
  running?: boolean;
  onContinue?: (extraRounds: number) => void;
}

export default function TurnView({
  index,
  turn,
  experts,
  maxRounds,
  canContinue,
  running,
  onContinue,
}: Props) {
  // 本 turn 已出现的最大轮次（流式中以 currentRound 为准）
  const maxRound = useMemo(() => {
    const fromAnswers = Object.values(turn.answers).reduce((m, a) => Math.max(m, a.round), 0);
    return Math.max(turn.currentRound, fromAnswers);
  }, [turn.answers, turn.currentRound]);

  const lastVerdict = turn.verdicts[turn.verdicts.length - 1];
  const converged = lastVerdict?.converged ?? false;
  const [extraRounds, setExtraRounds] = useState(maxRounds);

  const rounds = Array.from({ length: maxRound }, (_, i) => i + 1);
  const colSpan = Math.max(6, Math.floor(24 / Math.max(1, experts.length)));

  return (
    <div style={{ marginBottom: 24 }}>
      <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
        <Tag color={index === 0 ? 'blue' : 'purple'}>{index === 0 ? '提问' : `追问 ${index}`}</Tag>
        <span style={{ fontWeight: 600 }}>{turn.question}</span>
        {turn.status === 'running' && (
          <Tag color="processing" style={{ marginLeft: 8 }}>
            第 {turn.currentRound} 轮进行中
          </Tag>
        )}
      </Card>

      {turn.status === 'error' && turn.errorMessage && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={turn.errorMessage} />
      )}

      {/* 按轮次组织：每一轮横排展示各模型该轮输出，其后是该轮裁判结论 */}
      {rounds.map((r) => {
        const verdict = turn.verdicts.find((v) => v.round === r);
        return (
          <div key={r} style={{ marginBottom: 8 }}>
            <Divider orientation="left" style={{ borderColor: '#d9d9d9' }}>
              <Tag color="geekblue">第 {r} 轮</Tag>
            </Divider>
            <Row gutter={[16, 16]} wrap>
              {experts.map((e) => (
                <Col key={e.id} xs={24} md={colSpan} style={{ minWidth: 280 }}>
                  <AnswerCard expert={e} round={r} answer={turn.answers[`${e.id}-${r}`]} />
                </Col>
              ))}
            </Row>
            {verdict && (
              <Alert
                style={{ marginTop: 8 }}
                type={verdict.converged ? 'success' : 'warning'}
                showIcon
                message={`裁判判定（第 ${r} 轮）：${verdict.converged ? '已收敛' : '未收敛'}`}
                description={verdict.reason}
              />
            )}
          </div>
        );
      })}

      {turn.status === 'running' && !turn.finalAnswer && (
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <Spin tip="辩论进行中…" />
        </div>
      )}

      {turn.finalAnswer && (
        <div style={{ margin: '12px 0' }}>
          <FinalAnswer markdown={turn.finalAnswer} converged={converged} />
        </div>
      )}

      {canContinue && turn.status === 'done' && !converged && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="本轮讨论尚未收敛"
          description={
            <Space wrap style={{ marginTop: 8 }}>
              <span>各模型结论仍有分歧，可让它们继续讨论：</span>
              <Select
                size="small"
                value={extraRounds}
                style={{ width: 120 }}
                onChange={setExtraRounds}
                options={Array.from({ length: maxRounds }, (_, i) => ({
                  value: i + 1,
                  label: `最多 ${i + 1} 轮`,
                }))}
              />
              <Button
                size="small"
                type="primary"
                loading={running}
                onClick={() => onContinue?.(extraRounds)}
              >
                继续讨论
              </Button>
            </Space>
          }
        />
      )}

      <CostPanel total={turn.totalCost} breakdown={turn.costBreakdown} />
      <Divider />
    </div>
  );
}
