import { useEffect, useState } from 'react';
import { Drawer, Input, Button, Typography, message, Space } from 'antd';
import { getApiKey, setApiKey, maskKey } from '../utils/storage';

const { Paragraph, Text, Link } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDrawer({ open, onClose }: Props) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue(getApiKey());
  }, [open]);

  const save = () => {
    setApiKey(value.trim());
    message.success('已保存');
    onClose();
  };

  const existing = getApiKey();

  return (
    <Drawer title="设置" open={open} onClose={onClose} width={420}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text strong>DMXAPI API Key（必填）</Text>
          <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 8 }}>
            请填写你自己的 DMXAPI Key。仅保存在本浏览器 localStorage，调用时由浏览器直接发送给 DMXAPI，不经过任何服务器。首次填写后会缓存，后续无需再次输入。
          </Paragraph>
          {existing && (
            <Paragraph type="secondary">当前已保存：{maskKey(existing)}</Paragraph>
          )}
          <Input.Password
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-..."
          />
        </div>
        <Paragraph type="secondary">
          没有 Key？前往 <Link href="https://www.dmxapi.cn" target="_blank">DMXAPI</Link> 获取。
        </Paragraph>
        <Button type="primary" block onClick={save}>
          保存
        </Button>
      </Space>
    </Drawer>
  );
}
