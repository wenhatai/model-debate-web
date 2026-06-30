// 纯前端运行配置（浏览器直连 DMXAPI，无服务端）。
// 不再内置默认 Key：Key 由用户在「设置」中自行填写，缓存在浏览器 localStorage。
export const coreConfig = {
  dmxApiBaseUrl: 'https://www.dmxapi.cn/v1',
  historyBudgetChars: 24000,
};
