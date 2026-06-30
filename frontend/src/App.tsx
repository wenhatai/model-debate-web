import { useState } from 'react';
import { Layout, Menu, Button, Grid } from 'antd';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { SettingOutlined } from '@ant-design/icons';
import HomePage from './pages/HomePage';
import DebatePage from './pages/DebatePage';
import HistoryPage from './pages/HistoryPage';
import SettingsDrawer from './components/SettingsDrawer';

const { Header, Content } = Layout;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const selectedKey = location.pathname.startsWith('/history') ? 'history' : 'home';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', padding: isMobile ? '0 12px' : '0 24px' }}>
        <div
          style={{
            color: '#fff',
            fontWeight: 600,
            fontSize: isMobile ? 15 : 18,
            marginRight: isMobile ? 12 : 32,
            whiteSpace: 'nowrap',
          }}
        >
          多模型辩论
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          style={{ flex: 1, minWidth: 0 }}
          onClick={(e) => navigate(e.key === 'home' ? '/' : '/history')}
          items={[
            { key: 'home', label: isMobile ? '辩论' : '发起辩论' },
            { key: 'history', label: isMobile ? '历史' : '历史记录' },
          ]}
        />
        <Button
          icon={<SettingOutlined />}
          onClick={() => setSettingsOpen(true)}
        >
          {isMobile ? '' : '设置'}
        </Button>
      </Header>
      <Content style={{ padding: isMobile ? 12 : 24, maxWidth: 1400, width: '100%', margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/debate" element={<DebatePage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </Content>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Layout>
  );
}
