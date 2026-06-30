import { Card, Table, Statistic } from 'antd';
import type { CostBreakdownItem } from '../types';

interface Props {
  total: number;
  breakdown: CostBreakdownItem[];
}

export default function CostPanel({ total, breakdown }: Props) {
  return (
    <Card size="small" title="成本统计">
      <Statistic
        title="预估总费用 (USD)"
        value={total}
        precision={6}
        prefix="$"
        style={{ marginBottom: 16 }}
      />
      <Table<CostBreakdownItem>
        size="small"
        rowKey="model"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={breakdown}
        columns={[
          { title: '模型', dataIndex: 'model' },
          { title: '调用', dataIndex: 'calls', width: 60 },
          { title: '输入', dataIndex: 'promptTokens', width: 80 },
          { title: '输出', dataIndex: 'completionTokens', width: 80 },
          {
            title: '费用',
            dataIndex: 'cost',
            width: 100,
            render: (v: number) => `$${v.toFixed(6)}`,
          },
        ]}
      />
    </Card>
  );
}
