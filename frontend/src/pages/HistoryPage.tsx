import { useEffect, useState } from 'react';
import { List, Button, Tag, Space, message, Popconfirm, Typography, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import { fetchHistory, fetchHistoryDetail, deleteHistory } from '../services/api';
import type { HistoryItem } from '../types';
import { useDebateStore } from '../store/debateStore';

const { Title, Text } = Typography;

export default function HistoryPage() {
  const navigate = useNavigate();
  const loadConversation = useDebateStore((s) => s.loadConversation);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await fetchHistory());
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const open = async (id: number) => {
    setOpeningId(id);
    try {
      const detail = await fetchHistoryDetail(id);
      loadConversation(detail);
      navigate('/debate');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setOpeningId(null);
    }
  };

  const onDelete = async (id: number) => {
    try {
      await deleteHistory(id);
      message.success('已删除');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <Title level={3}>历史记录</Title>
      {items.length === 0 && !loading ? (
        <Empty description="暂无历史会话" />
      ) : (
        <List
          loading={loading}
          dataSource={items}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  type="link"
                  loading={openingId === item.id}
                  onClick={() => open(item.id)}
                >
                  打开对话
                </Button>,
                <Popconfirm
                  key="del"
                  title="确认删除这条会话？"
                  onConfirm={() => onDelete(item.id)}
                >
                  <Button type="link" danger>
                    删除
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {item.title}
                  </span>
                }
                description={
                  <Space wrap>
                    <Text type="secondary">{new Date(item.updatedAt).toLocaleString()}</Text>
                    <Tag color="purple">{item.turnCount} 轮对话</Tag>
                    <Tag>{item.totalTokens} tokens</Tag>
                    <Tag color="gold">${item.totalCost.toFixed(6)}</Tag>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
