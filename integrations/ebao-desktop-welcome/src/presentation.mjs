/** Brand the native welcome copy without changing any preload operation or account state. */
export function createEbaoWelcomeApi(api) {
  const chinese = api.id === 'zh-CN'
  const copy = chinese ? {
    welcomeTaglineBefore: '欢迎使用 ',
    welcomeDescription: '连接 CQAI 账号，开启智能创作',
    welcomeSignIn: '使用 e宝账号登录',
    welcomeApiKey: '配置 DeepSeek API Key',
    welcomeKeyTitle: '配置 DeepSeek API Key',
    welcomeKeyDescription: '仅用于 DeepSeek 官方模型，不用于 CQAI 登录。',
    welcomeKeyPlaceholder: '输入 DeepSeek API Key',
  } : {
    welcomeTaglineBefore: 'Welcome to ',
    welcomeDescription: 'Connect your CQAI account and start creating with AI',
    welcomeSignIn: 'Sign in with your e宝 account',
    welcomeApiKey: 'Add a DeepSeek API key',
    welcomeKeyTitle: 'Add a DeepSeek API key',
    welcomeKeyDescription: 'This option configures official DeepSeek models separately from CQAI sign-in.',
    welcomeKeyPlaceholder: 'Enter a DeepSeek API key',
  }
  return {
    ...api,
    messages: {
      ...api.messages,
      ...copy,
      welcomeTitle: 'e宝工坊',
      welcomeBrand: 'e宝工坊',
      welcomeTaglineBrand: 'e宝工坊',
      welcomeTaglineAfter: '',
    },
  }
}
