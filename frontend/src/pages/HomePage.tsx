import { useEffect, useState } from 'react';
import {
  Card,
  Input,
  Button,
  Select,
  InputNumber,
  Form,
  Collapse,
  Typography,
  Alert,
  message,
  Space,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { fetchModels } from '../services/api';
import { getApiKey, hasApiKey, getLastConfig, saveLastConfig } from '../utils/storage';
import { useDebateStore } from '../store/debateStore';
import type { ExpertConfig } from '../types';

const { TextArea } = Input;
const { Title, Paragraph } = Typography;

const EXPERT_NAMES = ['专家A', '专家B', '专家C', '专家D', '专家E', '专家F'];

// DMXAPI 账号当前已验证可用的模型，作为列表加载失败时的兜底与默认选项
const PRESET_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'qwen-plus', 'qwen-max', 'moonshot-v1-8k'];

export default function HomePage() {
  const navigate = useNavigate();
  const startDebate = useDebateStore((s) => s.startDebate);

  const [question, setQuestion] = useState('');
  const [models, setModels] = useState<string[]>(PRESET_MODELS);
  const [selectedModels, setSelectedModels] = useState<string[]>(['gpt-4o-mini', 'qwen-plus']);
  const [maxRounds, setMaxRounds] = useState(3);
  const [judgeModel, setJudgeModel] = useState<string>('gpt-4o-mini');
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');

  useEffect(() => {
    const last = getLastConfig();
    if (last) {
      if (last.experts?.length) setSelectedModels(last.experts.map((e) => e.model));
      if (last.maxRounds) setMaxRounds(last.maxRounds);
      if (last.judgeModel) setJudgeModel(last.judgeModel);
    }
    loadModels();
    // 保存 Key 后重新拉取在线模型列表
    const onKeyChange = () => loadModels();
    window.addEventListener('dmxapi-key-changed', onKeyChange);
    return () => window.removeEventListener('dmxapi-key-changed', onKeyChange);
  }, []);

  const loadModels = async () => {
    // 未填写 Key 时不请求 /models（必然 401），静默使用预置模型，不报错
    if (!hasApiKey()) {
      setModels(PRESET_MODELS);
      setModelError('');
      return;
    }
    setLoadingModels(true);
    setModelError('');
    try {
      const list = await fetchModels();
      // 合并接口返回与预置可用模型，去重
      setModels(Array.from(new Set([...PRESET_MODELS, ...list])));
    } catch {
      // 列表接口不可用时回退到预置模型，不阻塞使用
      setModels(PRESET_MODELS);
      setModelError('在线模型列表暂不可用，已使用预置可用模型；也可手动输入模型名。');
    } finally {
      setLoadingModels(false);
    }
  };

  const onStart = () => {
    if (!hasApiKey()) {
      message.error('请先点击右上角「设置」填写 DMXAPI Key');
      return;
    }
    if (!question.trim()) {
      message.error('请输入辩论问题');
      return;
    }
    if (selectedModels.length < 2) {
      message.error('请至少选择 2 个模型');
      return;
    }
    const experts: ExpertConfig[] = selectedModels.map((model, i) => ({
      id: `expert-${i + 1}`,
      name: EXPERT_NAMES[i] ?? `专家${i + 1}`,
      model,
    }));
    const judge = judgeModel || selectedModels[0];
    const config = { question: question.trim(), experts, maxRounds, judgeModel: judge };
    saveLastConfig(config);
    // Key 留空时后端会使用内置默认 Key
    startDebate(config, getApiKey());
    navigate('/debate');
  };

  const modelOptions = models.map((m) => ({ label: m, value: m }));

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={3}>发起一场多模型辩论</Title>
      <Paragraph type="secondary">
        多个大模型作为平等专家，针对你的问题多轮辩论、互相参考并收敛，最终汇聚出最佳答案。
      </Paragraph>

      {!hasApiKey() && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="使用前请先填写 API Key"
          description="点击右上角「设置」填写你的 DMXAPI Key，仅保存在本浏览器，调用时由浏览器直连 DMXAPI。填一次即可，后续自动缓存。"
        />
      )}

      <Card>
        <Form layout="vertical">
          <Form.Item label="你的问题" required>
            <TextArea
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="例如：在中小型团队中，单体架构和微服务架构应如何取舍？"
            />
          </Form.Item>

          <Form.Item label="参与辩论的模型（至少 2 个）" required>
            <Select
              mode="tags"
              loading={loadingModels}
              value={selectedModels}
              onChange={setSelectedModels}
              options={modelOptions}
              placeholder="选择或输入模型名，如 deepseek-chat、qwen-plus"
              style={{ width: '100%' }}
            />
          </Form.Item>

          {modelError && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={modelError} />
          )}

          <Collapse
            ghost
            items={[
              {
                key: 'adv',
                label: '高级配置',
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Form.Item label="辩论轮次上限" style={{ marginBottom: 0 }}>
                      <InputNumber
                        min={1}
                        max={6}
                        value={maxRounds}
                        onChange={(v) => setMaxRounds(v ?? 3)}
                      />
                      <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
                        轮次越多成本越高（约 模型数 × 轮次 次调用）
                      </Typography.Text>
                    </Form.Item>
                    <Form.Item label="裁判模型（用于收敛判定与综合，建议选较小模型）" style={{ marginBottom: 0 }}>
                      <Select
                        showSearch
                        allowClear
                        value={judgeModel || undefined}
                        onChange={(v) => setJudgeModel(v ?? '')}
                        options={modelOptions}
                        placeholder="默认使用第 1 个专家模型"
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Space>
                ),
              },
            ]}
          />

          <Button type="primary" size="large" block onClick={onStart} style={{ marginTop: 16 }}>
            开始辩论
          </Button>
        </Form>
      </Card>
    </div>
  );
}
