const productName = 'e宝工坊'

const accountCopy = {
  'zh-CN': {
    welcomeTaglineBefore: '欢迎使用 ',
    welcomeDescription: '登录 e宝工坊账号，即可开始创作。',
    welcomeSignIn: '使用 e宝工坊账号登录',
    welcomeAuthWaiting: '请在浏览器中登录 e宝工坊',
    welcomeAuthWaitingDescription: '如果浏览器没有自动打开，请复制登录链接后手动打开。',
    welcomeApiKey: '配置 DeepSeek API Key',
    welcomeKeyTitle: '配置 DeepSeek API Key',
    welcomeKeyDescription: '使用 DeepSeek API Key 调用 DeepSeek 官方模型。',
    welcomeKeyPlaceholder: '输入 DeepSeek API Key',
  },
  en: {
    welcomeTaglineBefore: 'Welcome to ',
    welcomeDescription: 'Sign in with your e宝工坊 account to start creating.',
    welcomeSignIn: 'Sign in with e宝工坊',
    welcomeAuthWaiting: 'Sign in to e宝工坊 in your browser',
    welcomeAuthWaitingDescription: 'If your browser didn’t open, copy the sign-in link and open it manually.',
    welcomeApiKey: 'Add a DeepSeek API key',
    welcomeKeyTitle: 'Add a DeepSeek API key',
    welcomeKeyDescription: 'Use a DeepSeek API key to access official DeepSeek models.',
    welcomeKeyPlaceholder: 'Enter a DeepSeek API key',
  },
  ja: {
    welcomeDescription: 'e宝工坊アカウントにログインして作業を始めましょう。',
    welcomeSignIn: 'e宝工坊でログイン',
    welcomeAuthWaiting: 'ブラウザーでe宝工坊にログイン',
  },
  es: {
    welcomeDescription: 'Inicia sesión con tu cuenta de e宝工坊 para empezar a crear.',
    welcomeSignIn: 'Iniciar sesión con e宝工坊',
    welcomeAuthWaiting: 'Inicia sesión en e宝工坊 desde tu navegador',
  },
  fr: {
    welcomeDescription: 'Connectez-vous à votre compte e宝工坊 pour commencer à créer.',
    welcomeSignIn: 'Se connecter avec e宝工坊',
    welcomeAuthWaiting: 'Connectez-vous à e宝工坊 dans votre navigateur',
  },
  de: {
    welcomeDescription: 'Melde dich mit deinem e宝工坊-Konto an, um loszulegen.',
    welcomeSignIn: 'Mit e宝工坊 anmelden',
    welcomeAuthWaiting: 'Melde dich im Browser bei e宝工坊 an',
  },
  ru: {
    welcomeDescription: 'Войдите в свой аккаунт e宝工坊, чтобы начать работу.',
    welcomeSignIn: 'Войти через e宝工坊',
    welcomeAuthWaiting: 'Войдите в e宝工坊 в браузере',
  },
  pt: {
    welcomeDescription: 'Entre na sua conta do e宝工坊 para começar a criar.',
    welcomeSignIn: 'Entrar com e宝工坊',
    welcomeAuthWaiting: 'Entre no e宝工坊 no navegador',
  },
}

/** Brand the native welcome copy without changing any preload operation or account state. */
export function createEbaoWelcomeApi(api) {
  const copy = Object.hasOwn(accountCopy, api.id) ? accountCopy[api.id] : accountCopy.en
  const originalKeyDescription = api.messages.welcomeKeyDescription
  const localizedKeyCopy = originalKeyDescription?.replaceAll('Harness', productName)
  return {
    ...api,
    messages: {
      ...api.messages,
      welcomeKeyDescription: localizedKeyCopy,
      ...copy,
      welcomeTitle: productName,
      welcomeBrand: productName,
      welcomeTaglineBrand: productName,
    },
  }
}
